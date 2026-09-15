using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
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
    // legal actions, metrics, star latches and terminal decisions. Campaign
    // recovery replays the accepted log stored with the local product.
    public sealed class LocalRunClient
    {
        private sealed class Record
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
        private readonly object gate = new object();
        private readonly LocalProductStore store;
        private readonly Func<long> now;
        private readonly Dictionary<string, Record> records = new Dictionary<string, Record>();
        private readonly Dictionary<string, Record> active = new Dictionary<string, Record>();
        private ulong nextId = 1;
        private readonly Func<byte, bool> purchaseGate;
        private readonly Func<byte[]> campaignSeed;
        private bool restoring;
        public LocalRunClient(LocalProductStore store, Func<long> utcNow, Func<byte, bool> purchaseGate = null, Func<byte[]> campaignSeed = null)
        {
            this.store = store ?? throw new ArgumentNullException(nameof(store));
            now = utcNow ?? throw new ArgumentNullException(nameof(utcNow));
            this.purchaseGate = purchaseGate;
            this.campaignSeed = campaignSeed ?? FreshCampaignSeed;
            RestoreCampaign();
        }
        public LocalDaily Today()
        {
            long time = now();
            uint day = checked((uint)Math.Max(0, time / 86400));
            uint pair = NativeEngine.DailyPairIndex(day);
            byte realm = checked((byte)(pair / Protocol.DailyThemes.Length + 1));
            var theme = Protocol.DailyThemes[pair % Protocol.DailyThemes.Length];
            return new LocalDaily(day, realm, theme[0], theme[1]);
        }
        public string CampaignLock(byte realm)
        {
            lock (gate)
            {
                Realm(realm);
                if (purchaseGate?.Invoke(realm) == true) return "purchase";
                if (realm > 1 && store.Read.Stars[(realm - 1) * Protocol.CampaignTargets.Length - 1] == 0) return "stars";
                return null;
            }
        }
        // Call only with a successful native billing query. A failed query has
        // no answer and must not erase the last cached entitlement/price.
        public void ApplyCampaignEntitlement(bool owned, string price)
        {
            lock (gate) store.Write(current => { var next = Copy(current); next.CampaignOwned = owned; next.CampaignPrice = price; return next; });
        }
        public LocalRunUpdate StartCampaign(byte realm, byte level)
        {
            lock (gate)
            {
                string blocked = CampaignLock(realm);
                if (blocked != null) throw new InvalidOperationException(blocked == "purchase" ? "Unlock the full Campaign first" : "Defeat the previous guardian first");
                if (active.TryGetValue("campaign", out var existing))
                    throw new InvalidOperationException("Resume the saved Campaign run first");
                return Start("campaign", realm, level, CampaignRules(realm, level), campaignSeed(), null);
            }
        }
        public LocalRunUpdate StartDaily()
        {
            lock (gate)
            {
                var today = Today();
                if (store.Read.DailyAttempt?.DayId == today.DayId) throw new InvalidOperationException("Today's Daily challenge has already been played");
                var rules = Rules(Realm(today.Realm)); rules.TierPolicy = 1; rules.MaxMoves = checked((ushort)Protocol.DailyMaxMoves);
                rules.ObjectiveKind = today.ObjectiveKind; rules.ObjectiveValue = today.ObjectiveValue;
                var result = Start("arcade", today.Realm, 1, rules, NativeEngine.LocalRowRandomness(Encoding.UTF8.GetBytes("zkube-local-daily-row-seed-v1"), today.DayId), today.DayId);
                // Opening and active slot exist before reservation
                // write; write failure propagates after normalized memory changes.
                store.Write(current => {
                    var next = Copy(current); next.Streak = current.LastAttemptDayId.HasValue && (long)current.LastAttemptDayId.Value == (long)today.DayId - 1 ? checked(current.Streak + 1) : 1;
                    next.LastAttemptDayId = today.DayId;
                    next.DailyAttempt = new LocalDailyAttempt { DayId = today.DayId, Realm = today.Realm, ObjectiveKind = today.ObjectiveKind,
                        ObjectiveValue = today.ObjectiveValue, ObjectiveTotal = "0" };
                    return next;
                });
                return result;
            }
        }
        public LocalRunView Active(string mode)
        { lock (gate) { if (mode != "campaign" && mode != "arcade") throw new ArgumentException("Invalid local mode"); return active.TryGetValue(mode, out var record) ? record.View() : null; } }
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
                catch (Exception error) when (!recorded && record.Recorded)
                {
                    // The existing backend marks terminal acceptance immediately
                    // before its only durable write. Preserve its legacy API and
                    // give board callers an explicit unsaved-progress result.
                    throw new LocalRunPersistenceException(error);
                }
            }
        }
        public LocalRunUpdate Act(string id, LocalRunAction action)
        {
            lock (gate)
            {
                if (!records.TryGetValue(id, out var record)) throw new InvalidOperationException($"Local run {id} was not found");
                if (record.Mode == "campaign") record = record.Copy();
                var transitions = new List<(byte[], byte[])>();
                var before = NativeEngine.Summary(record.Token);
                switch (action.Kind)
                {
                    case LocalActionKind.Move: Accept(record, PlayMoveRequest.Operation, new PlayMoveRequest { Config = record.Token.Config, State = record.Token.State,
                        Trace = 1, Action = before.ActionCounter, ExpectedMove = before.Moves, Row = action.Row, Start = action.Start, Destination = action.Destination }.Encode(), transitions); break;
                    case LocalActionKind.Bonus: Accept(record, ApplyBonusRequest.Operation, new ApplyBonusRequest { Config = record.Token.Config, State = record.Token.State,
                        Trace = 1, Action = before.ActionCounter, Row = action.Row, Column = action.Start }.Encode(), transitions); break;
                    case LocalActionKind.Reroll: Accept(record, RequestRerollRequest.Operation, new RequestRerollRequest { Config = record.Token.Config, State = record.Token.State,
                        Trace = 1, Action = before.ActionCounter }.Encode(), transitions); break;
                    case LocalActionKind.Finish: Accept(record, FinishRequest.Operation, new FinishRequest { Config = record.Token.Config, State = record.Token.State,
                        Trace = 1, Reason = action.Reason }.Encode(), transitions); break;
                    default: throw new ArgumentOutOfRangeException(nameof(action));
                }
                if (NativeEngine.Summary(record.Token).Phase == (byte)CorePhase.AwaitingVrf) NextRow(record, transitions);
                var summary = NativeEngine.Summary(record.Token);
                bool terminal = summary.Phase == (byte)CorePhase.Finished || summary.Phase == (byte)CorePhase.LevelComplete;
                if (record.Mode == "campaign")
                {
                    record.Actions.Add(new LocalCampaignAction { Kind = action.Kind.ToString(), Row = action.Row,
                        Start = action.Start, Destination = action.Destination, Reason = action.Reason });
                    SaveCampaign(record, terminal);
                    records[id] = record;
                    if (terminal) active.Remove("campaign"); else active["campaign"] = record;
                    return new LocalRunUpdate(record.View(), transitions);
                }
                if (active.TryGetValue(record.Mode, out var selected) && selected.Id == record.Id)
                { if (terminal) active.Remove(record.Mode); else active[record.Mode] = record; }
                if (terminal && !record.Recorded)
                {
                    record.Recorded = true;
                    store.Write(current => {
                        var next = Copy(current);
                        next.BestDailyScore = Math.Max(current.BestDailyScore, summary.DailyScore);
                        if (next.DailyAttempt != null && next.DailyAttempt.DayId == record.Day) { next.DailyAttempt.DailyScore = summary.DailyScore; next.DailyAttempt.ObjectiveTotal = summary.ObjectiveTotal.ToString(CultureInfo.InvariantCulture); next.DailyAttempt.Finished = true; }
                        return next;
                    });
                }
                return new LocalRunUpdate(record.View(), transitions);
            }
        }
        private static byte[] FreshCampaignSeed()
        {
            var seed = new byte[32];
            using (var random = RandomNumberGenerator.Create()) random.GetBytes(seed);
            return seed;
        }
        private LocalRunUpdate Start(string mode, byte realm, byte level, BuildConfigRequest rules, byte[] seed, uint? day)
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
            var definition = Realm(realm);
            if (level == 0 || level > definition.Levels.Length) throw new ArgumentException($"Campaign level {realm}.{level} is not authored");
            var authored = definition.Levels[level - 1];
            var rules = Rules(definition); rules.TierPolicy = 0; rules.FixedTier = authored.Tier;
            rules.MaxMoves = NativeEngine.CampaignMoveBudget(level, authored.Tier); rules.PointsRequired = Protocol.CampaignTargets[level - 1];
            rules.PrimaryKind = authored.Primary[0]; rules.PrimaryValue = authored.Primary[1]; rules.PrimaryCount = authored.Primary[2];
            rules.SecondaryKind = authored.Secondary[0]; rules.SecondaryValue = authored.Secondary[1]; rules.SecondaryCount = authored.Secondary[2];
            return rules;
        }
        private void RestoreCampaign()
        {
            var saved = store.Read.CampaignRun;
            if (saved == null) return;
            if (saved.CatalogVersion != Protocol.CatalogVersion) throw new InvalidOperationException("Saved Campaign catalog version is unsupported");
            restoring = true;
            try
            {
                nextId = ulong.Parse(saved.Id, CultureInfo.InvariantCulture);
                var opened = Start("campaign", saved.Realm, saved.Level, CampaignRules(saved.Realm, saved.Level),
                    Array.ConvertAll(saved.Seed, value => checked((byte)value)), null);
                foreach (var action in saved.Actions)
                    Act(opened.View.RunId, new LocalRunAction((LocalActionKind)Enum.Parse(typeof(LocalActionKind), action.Kind),
                        action.Row, action.Start, action.Destination, action.Reason));
                if (!active.ContainsKey("campaign")) throw new InvalidOperationException("Saved Campaign log contains a terminal action");
            }
            finally { restoring = false; }
        }
        private void SaveCampaign(Record record, bool terminal)
        {
            if (restoring) return;
            store.WriteCampaign(current => {
                var next = Copy(current);
                if (terminal)
                {
                    byte mask = NativeEngine.Summary(record.Token).LatchedStarSources;
                    byte earned = (byte)((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1));
                    int index = (record.Realm - 1) * Protocol.CampaignTargets.Length + record.Level - 1;
                    if (earned > next.Stars[index])
                    {
                        next.Stars[index] = earned;
                        if (store.Owner != null) next.CampaignWritePending = true;
                    }
                    next.CampaignRun = null;
                }
                else next.CampaignRun = new LocalCampaignRun { Id = record.Id, CatalogVersion = Protocol.CatalogVersion,
                    Realm = record.Realm, Level = record.Level, Seed = Array.ConvertAll(record.Seed, value => (int)value),
                    Actions = new List<LocalCampaignAction>(record.Actions) };
                return next;
            });
        }
        public byte[] PackedCampaignStars()
        {
            lock (gate) return Pack(store.Read.Stars);
        }
        public void MergeCampaignRecord(byte[] chainStars)
        {
            lock (gate)
            {
                var merged = NativeEngine.MergeCampaignStars(Pack(store.Read.Stars), chainStars);
                store.WriteCampaign(current => {
                    var next = Copy(current); next.Stars = Unpack(merged);
                    next.CampaignWritePending = store.Owner != null && !merged.SequenceEqual(chainStars);
                    return next;
                });
            }
        }
        public void AcknowledgeCampaignRecord(byte[] submitted)
        {
            lock (gate)
            {
                store.WriteCampaign(current => {
                    var next = Copy(current);
                    next.CampaignWritePending = store.Owner != null && !Pack(next.Stars).SequenceEqual(submitted);
                    return next;
                });
            }
        }
        private static byte[] Pack(byte[] stars)
        {
            var packed = new byte[25];
            for (int i = 0; i < stars.Length; i++) packed[i / 4] |= (byte)(stars[i] << ((i % 4) * 2));
            return packed;
        }
        private static byte[] Unpack(byte[] packed)
        {
            var stars = new byte[100];
            for (int i = 0; i < stars.Length; i++) stars[i] = (byte)((packed[i / 4] >> ((i % 4) * 2)) & 3);
            return stars;
        }
        private static void NextRow(Record record, List<(byte[], byte[])> transitions)
        {
            uint counter = checked(++record.Counter);
            Accept(record, ApplyVrfRequest.Operation, new ApplyVrfRequest { Config = record.Token.Config, State = record.Token.State, Trace = 1,
                Counter = counter, Output = NativeEngine.LocalRowRandomness(record.Seed, counter) }.Encode(), transitions);
        }
        private static void Accept(Record record, uint operation, byte[] request, List<(byte[], byte[])> transitions)
        {
            byte[] config = record.Token.Config, response = NativeEngine.Call(operation, request);
            record.Token = RunTransition.Decode(config, response).Token; transitions.Add((config, response));
        }
        private static LocalProductState Copy(LocalProductState current) => LocalProductCodec.Decode(LocalProductCodec.Encode(current));
        private static RealmDefinition Realm(byte id) => Protocol.Realms.SingleOrDefault(realm => realm.MapId == id) ?? throw new ArgumentException($"Campaign realm {id} is not authored");
        private static BuildConfigRequest Rules(RealmDefinition realm) => new BuildConfigRequest {
            RulesHash = Enumerable.Repeat((byte)0x33, 32).ToArray(), InitialReplay = Enumerable.Repeat((byte)0x42, 32).ToArray(),
            BonusType = checked((byte)realm.GuardianAndHeight[0]), Trigger = checked((byte)realm.GuardianAndHeight[1]),
            TriggerThreshold = realm.GuardianAndHeight[2], StartingHeight = checked((byte)realm.GuardianAndHeight[3]),
        };
    }
}
