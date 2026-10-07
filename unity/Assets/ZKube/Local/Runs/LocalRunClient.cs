using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Local
{
    public sealed class LocalRunPersistenceException : Exception
    {
        internal LocalRunPersistenceException(Exception inner)
            : base("The local action was accepted, but progress could not be saved", inner) { }
    }
    // NativeEngine owns configurations,
    // legal actions, metrics, star latches and terminal decisions. A run is
    // recovered after a restart by replaying the accepted log stored with the
    // local product over its saved or derived seed; an action is published
    // only once that log is saved.
    public class LocalRunClient
    {
        protected sealed class Record
        {
            public string Id, Mode;
            public byte Realm, Level;
            public uint? Day;
            public byte[] Seed;
            public CoreRunToken Token;
            public BuildConfigRequest Rules;
            public uint Counter;
            public bool Recorded;
            public List<LocalCampaignAction> Actions = new List<LocalCampaignAction>();
            public Record Copy()
            {
                var copy = (Record)MemberwiseClone();
                copy.Actions = new List<LocalCampaignAction>(Actions);
                return copy;
            }
            public LocalRunView View() => new LocalRunView(Id, Mode, Realm, Level, Token, Rules);
        }
        protected readonly object gate = new object();
        protected readonly LocalProductStore store;
        private readonly Dictionary<string, Record> records = new Dictionary<string, Record>();
        private readonly Dictionary<string, Record> active = new Dictionary<string, Record>();
        private ulong nextId = 1;
        private readonly Func<byte, bool> purchaseGate;
        private readonly Func<byte[]> campaignSeed;
        private bool restoring;
        public LocalRunClient(LocalProductStore store, Func<byte, bool> purchaseGate = null, Func<byte[]> campaignSeed = null)
        {
            this.store = store ?? throw new ArgumentNullException(nameof(store));
            this.purchaseGate = purchaseGate;
            this.campaignSeed = campaignSeed ?? FreshCampaignSeed;
            RestoreCampaign();
        }
        public string CampaignLock(byte realm)
        {
            lock (gate)
            {
                if (realm < 1 || realm > Protocol.Realms.Length) throw new ArgumentOutOfRangeException(nameof(realm));
                if (purchaseGate?.Invoke(realm) == true) return "purchase";
                if (Progress().RealmUnlocked[realm - 1] == 0) return "stars";
                return null;
            }
        }
        public LocalRunUpdate StartCampaign(byte realm, byte level)
        {
            lock (gate)
            {
                if (purchaseGate?.Invoke(realm) == true) throw new InvalidOperationException("Unlock the full Campaign first");
                if (active.TryGetValue("campaign", out var existing))
                    throw new InvalidOperationException("Resume the saved Campaign run first");
                var rules = CampaignRules(realm, level);
                if (Progress().LevelUnlocked[(realm - 1) * Protocol.CampaignTargets.Length + level - 1] == 0)
                    throw new InvalidOperationException("Clear the preceding trial first");
                return Start("campaign", realm, level, rules, campaignSeed(), null);
            }
        }
        public LocalRunView Active(string mode)
        { lock (gate) { if (mode != "campaign" && mode != "daily") throw new ArgumentException("Invalid local mode"); return active.TryGetValue(mode, out var record) ? record.View() : null; } }
        public LocalRunView Observe(string id)
        { lock (gate) return records.TryGetValue(id, out var record) ? record.View() : null; }
        // Board gestures are bound to the exact state shown to the player.
        // Check the slot and token under the same lock that accepts the action.
        public LocalRunUpdate Act(string id, CoreRunToken expected, LocalRunAction action)
        {
            lock (gate)
            {
                if (expected == null || !records.TryGetValue(id, out var record) ||
                    !active.TryGetValue(record.Mode, out var selected) || selected.Id != id ||
                    !record.Token.Config.SequenceEqual(expected.Config) || !record.Token.State.SequenceEqual(expected.State))
                    throw new InvalidOperationException("The bound local run changed; observe it before playing");
                bool recorded = record.Recorded;
                try { return Act(id, action); }
                catch (Exception error) when (!recorded && records[id].Recorded)
                {
                    // Terminal acceptance precedes the durable write; report
                    // an explicit unsaved-progress result if that write fails.
                    throw new LocalRunPersistenceException(error);
                }
            }
        }
        public LocalRunUpdate Act(string id, LocalRunAction action)
        {
            lock (gate)
            {
                if (!records.TryGetValue(id, out var record)) throw new InvalidOperationException($"Local run {id} was not found");
                record = record.Copy();
                var transitions = new List<(byte[], byte[])>();
                var before = NativeEngine.Summary(record.Token);
                switch (action.Kind)
                {
                    case LocalActionKind.Move: Accept(record, NativeOperation.PlayMove, NativeRequest.PlayMove(Config: record.Token.Config, State: record.Token.State, Action: before.ActionCounter, ExpectedMove: before.Moves, Row: action.Row, Start: action.Start, Destination: action.Destination), transitions); break;
                    case LocalActionKind.Bonus: Accept(record, NativeOperation.ApplyBonus, NativeRequest.ApplyBonus(Config: record.Token.Config, State: record.Token.State, Action: before.ActionCounter, Row: action.Row, Column: action.Start), transitions); break;
                    case LocalActionKind.Reroll: Accept(record, NativeOperation.RequestReroll, NativeRequest.RequestReroll(Config: record.Token.Config, State: record.Token.State, Action: before.ActionCounter), transitions); break;
                    case LocalActionKind.Finish: Accept(record, NativeOperation.Finish, NativeRequest.Finish(Config: record.Token.Config, State: record.Token.State, Reason: action.Reason), transitions); break;
                    default: throw new ArgumentOutOfRangeException(nameof(action));
                }
                if (NativeEngine.Summary(record.Token).Phase == (byte)CorePhase.AwaitingVrf) NextRow(record, transitions);
                var summary = NativeEngine.Summary(record.Token);
                bool terminal = summary.Phase == (byte)CorePhase.Finished || summary.Phase == (byte)CorePhase.LevelComplete;
                record.Actions.Add(new LocalCampaignAction { Kind = action.Kind.ToString(), Row = action.Row,
                    Start = action.Start, Destination = action.Destination, Reason = action.Reason });
                if (record.Mode == "campaign")
                {
                    SaveCampaign(record, terminal);
                    records[id] = record;
                    if (terminal) active.Remove("campaign"); else active["campaign"] = record;
                    return new LocalRunUpdate(record.View(), transitions);
                }
                // The log of a run still open is saved before its action is published;
                // the action that ends it records the result instead.
                if (!terminal && !restoring) SaveActions(record);
                records[id] = record;
                if (active.TryGetValue(record.Mode, out var selected) && selected.Id == record.Id)
                { if (terminal) active.Remove(record.Mode); else active[record.Mode] = record; }
                if (terminal) RecordTerminal(record, summary);
                return new LocalRunUpdate(record.View(), transitions);
            }
        }
        private static byte[] FreshCampaignSeed()
        {
            var seed = new byte[32];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(seed);
            return seed;
        }
        protected LocalRunUpdate Start(string mode, byte realm, byte level, BuildConfigRequest rules, byte[] seed, uint? day)
        {
            string id = (nextId++).ToString(CultureInfo.InvariantCulture);
            var record = new Record { Id = id, Mode = mode, Realm = realm, Level = level, Rules = rules, Seed = seed, Day = day, Token = NativeEngine.Initialize(rules) };
            var transitions = new List<(byte[], byte[])>(); NextRow(record, transitions);
            if (mode == "campaign") SaveCampaign(record, false);
            records.Add(id, record); active[mode] = record;
            return new LocalRunUpdate(record.View(), transitions);
        }
        private static BuildConfigRequest CampaignRules(byte realm, byte level)
        {
            var rules = NativeEngine.CampaignRules(realm, level);
            rules.RulesHash = Enumerable.Repeat((byte)0x33, 32).ToArray();
            rules.InitialReplay = Enumerable.Repeat((byte)0x42, 32).ToArray();
            return rules;
        }
        protected virtual void RecordTerminal(Record record, RunSummary summary) { }
        // Saves the accepted log of a run that is not the Campaign's.
        protected virtual void SaveActions(Record record) { }
        // A saved accepted log replayed over the run open opens: nothing is
        // written while it replays, and a log that cannot be replayed leaves no run.
        protected LocalRunView Replay(Func<LocalRunUpdate> open, IEnumerable<LocalCampaignAction> actions)
        {
            restoring = true; string id = null;
            try
            {
                id = open().View.RunId;
                foreach (var action in actions)
                    Act(id, new LocalRunAction((LocalActionKind)Enum.Parse(typeof(LocalActionKind), action.Kind),
                        action.Row, action.Start, action.Destination, action.Reason));
                return records[id].View();
            }
            catch
            {
                if (id != null && records.TryGetValue(id, out var failed))
                { records.Remove(id); if (active.TryGetValue(failed.Mode, out var selected) && selected.Id == id) active.Remove(failed.Mode); }
                throw;
            }
            finally { restoring = false; }
        }
        private CampaignProgressSummary Progress() => NativeEngine.CampaignProgress(store.Read.Stars);
        // A saved run resumes only as the run it was: under the rules it was started under, its whole
        // log replayed, and still in play at the end of it. A level's rules can change with the app, and
        // a log replayed under other rules is another run (it can end before its last move). Such a run,
        // one saved before runs recorded their rules, and one this build cannot replay are let go: the
        // level opens fresh, lifetime stars are untouched, and nothing here stops the app from starting.
        private void RestoreCampaign()
        {
            var saved = store.Read.CampaignRun;
            if (saved == null) return;
            bool resumed = false;
            try
            {
                var rules = CampaignRules(saved.Realm, saved.Level);
                if (saved.CatalogVersion == Protocol.CatalogVersion &&
                    saved.Rules == Convert.ToBase64String(NativeEngine.Initialize(rules).Config))
                {
                    ulong next = nextId; nextId = ulong.Parse(saved.Id, CultureInfo.InvariantCulture);
                    try
                    {
                        Replay(() => Start("campaign", saved.Realm, saved.Level, rules,
                            Array.ConvertAll(saved.Seed, value => checked((byte)value)), null), saved.Actions);
                        resumed = active.ContainsKey("campaign");
                    }
                    finally { if (!resumed) nextId = next; }
                }
            }
            catch (Exception) { }
            if (resumed) return;
            foreach (var record in records.Values.Where(record => record.Mode == "campaign").ToArray()) records.Remove(record.Id);
            active.Remove("campaign");
            store.WriteCampaign(current => { var next = Copy(current); next.CampaignRun = null; return next; });
        }
        private void SaveCampaign(Record record, bool terminal)
        {
            if (restoring) return;
            store.WriteCampaign(current => {
                var next = Copy(current);
                if (terminal)
                {
                    var before = current.Stars;
                    var merged = NativeEngine.RecordLocalCampaignResult(before, record.Realm, record.Level, record.Token);
                    next.Stars = merged.Stars;
                    if (!before.SequenceEqual(merged.Stars) && store.Owner != null) next.CampaignWritePending = true;
                    next.CampaignRun = null;
                }
                else next.CampaignRun = new LocalCampaignRun { Id = record.Id, CatalogVersion = Protocol.CatalogVersion,
                    Realm = record.Realm, Level = record.Level, Seed = Array.ConvertAll(record.Seed, value => (int)value),
                    Rules = Convert.ToBase64String(record.Token.Config),
                    Actions = new List<LocalCampaignAction>(record.Actions) };
                return next;
            });
        }
        private static void NextRow(Record record, List<(byte[], byte[])> transitions)
        {
            uint counter = checked(++record.Counter);
            Accept(record, NativeOperation.ApplyVrf, NativeRequest.ApplyVrf(Config: record.Token.Config, State: record.Token.State, Counter: counter, Output: NativeEngine.LocalRowRandomness(record.Seed, counter)), transitions);
        }
        private static void Accept(Record record, uint operation, byte[] request, List<(byte[], byte[])> transitions)
        {
            byte[] config = record.Token.Config, response = NativeEngine.Call(operation, request);
            record.Token = RunTransition.Decode(config, response).Token; transitions.Add((config, response));
        }
        protected static LocalProductState Copy(LocalProductState current) => LocalProductCodec.Decode(LocalProductCodec.Encode(current));

    }
}
