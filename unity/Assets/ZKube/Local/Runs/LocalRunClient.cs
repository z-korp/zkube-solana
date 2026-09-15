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
    // LocalBackendLive.ts orchestration only. NativeEngine owns configurations,
    // legal actions, metrics, star latches and terminal decisions. Records are
    // intentionally process-local; only product state survives restart.
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
            public LocalRunView View() => new LocalRunView(Id, Mode, Realm, Level, Token, Rules);
        }
        private readonly object gate = new object();
        private readonly LocalProductStore store;
        private readonly Func<long> now;
        private readonly Dictionary<string, Record> records = new Dictionary<string, Record>();
        private readonly Dictionary<string, Record> active = new Dictionary<string, Record>();
        private ulong nextId = 1;
        public LocalRunClient(LocalProductStore store, Func<long> utcNow)
        { this.store = store ?? throw new ArgumentNullException(nameof(store)); now = utcNow ?? throw new ArgumentNullException(nameof(utcNow)); }
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
                if (realm >= 4 && !store.Read.CampaignOwned) return "purchase";
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
                var definition = Realm(realm);
                if (level == 0 || level > definition.Levels.Length) throw new ArgumentException($"Campaign level {realm}.{level} is not authored");
                var authored = definition.Levels[level - 1];
                var rules = Rules(definition); rules.TierPolicy = 0; rules.FixedTier = authored.Tier;
                rules.MaxMoves = NativeEngine.CampaignMoveBudget(level, authored.Tier); rules.PointsRequired = Protocol.CampaignTargets[level - 1];
                rules.PrimaryKind = authored.Primary[0]; rules.PrimaryValue = authored.Primary[1]; rules.PrimaryCount = authored.Primary[2];
                rules.SecondaryKind = authored.Secondary[0]; rules.SecondaryValue = authored.Secondary[1]; rules.SecondaryCount = authored.Secondary[2];
                return Start("campaign", realm, level, rules, Enumerable.Repeat((byte)0x5a, 32).ToArray(), null);
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
                var result = Start("arcade", today.Realm, 1, rules, HashCounter(Encoding.UTF8.GetBytes("zkube-local-daily-row-seed-v1"), today.DayId), today.DayId);
                // Match TS order: opening and active slot exist before reservation
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
                if (active.TryGetValue(record.Mode, out var selected) && selected.Id == record.Id)
                { if (terminal) active.Remove(record.Mode); else active[record.Mode] = record; }
                if (terminal && !record.Recorded)
                {
                    record.Recorded = true;
                    store.Write(current => {
                        var next = Copy(current);
                        if (record.Mode == "arcade")
                        {
                            next.BestDailyScore = Math.Max(current.BestDailyScore, summary.DailyScore);
                            if (next.DailyAttempt != null && next.DailyAttempt.DayId == record.Day) { next.DailyAttempt.DailyScore = summary.DailyScore; next.DailyAttempt.ObjectiveTotal = summary.ObjectiveTotal.ToString(CultureInfo.InvariantCulture); next.DailyAttempt.Finished = true; }
                        }
                        else
                        {
                            byte mask = summary.LatchedStarSources;
                            byte earned = (byte)((mask & 1) + ((mask >> 1) & 1) + ((mask >> 2) & 1));
                            int index = (record.Realm - 1) * Protocol.CampaignTargets.Length + record.Level - 1;
                            next.Stars[index] = Math.Max(next.Stars[index], earned);
                        }
                        return next;
                    });
                }
                return new LocalRunUpdate(record.View(), transitions);
            }
        }
        private LocalRunUpdate Start(string mode, byte realm, byte level, BuildConfigRequest rules, byte[] seed, uint? day)
        {
            string id = (nextId++).ToString(CultureInfo.InvariantCulture);
            var record = new Record { Id = id, Mode = mode, Realm = realm, Level = level, Rules = rules, Seed = seed, Day = day, Token = NativeEngine.Initialize(rules) };
            records.Add(id, record);
            var transitions = new List<(byte[], byte[])>(); NextRow(record, transitions); active[mode] = record;
            return new LocalRunUpdate(record.View(), transitions);
        }
        private static void NextRow(Record record, List<(byte[], byte[])> transitions)
        {
            uint counter = checked(++record.Counter);
            Accept(record, ApplyVrfRequest.Operation, new ApplyVrfRequest { Config = record.Token.Config, State = record.Token.State, Trace = 1,
                Counter = counter, Output = HashCounter(record.Seed, counter) }.Encode(), transitions);
        }
        private static void Accept(Record record, uint operation, byte[] request, List<(byte[], byte[])> transitions)
        {
            byte[] config = record.Token.Config, response = NativeEngine.Call(operation, request);
            record.Token = RunTransition.Decode(config, response).Token; transitions.Add((config, response));
        }
        private static byte[] HashCounter(byte[] seed, uint value)
        {
            var input = new byte[seed.Length + 4]; seed.CopyTo(input, 0);
            for (int i = 0; i < 4; i++) input[seed.Length + i] = (byte)(value >> (8 * i));
            using var sha = SHA256.Create(); return sha.ComputeHash(input);
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
