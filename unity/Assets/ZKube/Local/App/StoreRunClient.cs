using System;
using System.Linq;
using System.Text;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Local.App
{
    public sealed class StoreRunClient : LocalRunClient
    {
        private readonly Func<long> now;
        public StoreRunClient(LocalProductStore store, Func<long> utcNow, Func<byte[]> campaignSeed = null)
            : base(store, StoreCampaignPolicy.PurchaseGate(store), campaignSeed)
        { now = utcNow ?? throw new ArgumentNullException(nameof(utcNow)); RestoreDaily(); }
        public long Now() => now();
        public LocalDaily Today()
        {
            long time = now();
            // A clock set before the first day still gets a Daily: day zero.
            uint day = time < (long)NativeEngine.Daily(0).OpensAt ? 0 : NativeEngine.DayAt(time);
            var pair = NativeEngine.Daily(day);
            return new LocalDaily(day, pair.Realm, pair.Kind, pair.Value);
        }
        // Call only with a successful native billing query. A failed query has
        // no answer and must not erase the last cached entitlement/price.
        public void ApplyCampaignEntitlement(bool owned, string price)
        {
            lock (gate) store.Write(current => { var next = Copy(current); next.CampaignOwned = owned; next.CampaignPrice = price; return next; });
        }
        public LocalRunUpdate StartDaily()
        {
            lock (gate)
            {
                var today = Today();
                if (store.Read.DailyAttempt?.DayId == today.DayId) throw new InvalidOperationException("Today's Daily challenge has already been played");
                var result = Open(today);
                // Persist the attempt before returning its opening to the player.
                store.Write(current => {
                    var next = Copy(current); next.Streak = current.DailyAttempt != null && (long)current.DailyAttempt.DayId == (long)today.DayId - 1 ? checked(current.Streak + 1) : 1;
                    next.DailyAttempt = new LocalDailyAttempt { DayId = today.DayId };
                    return next;
                });
                return result;
            }
        }
        // A day's run from its opening: its rules and its rows come from the day alone.
        private LocalRunUpdate Open(LocalDaily today)
        {
            var rules = Rules(Realm(today.Realm)); rules.TierPolicy = 1; rules.MaxMoves = checked((ushort)Protocol.DailyMaxMoves);
            rules.ObjectiveKind = today.ObjectiveKind; rules.ObjectiveValue = today.ObjectiveValue;
            return Start("daily", today.Realm, 1, rules, NativeEngine.LocalRowRandomness(Encoding.UTF8.GetBytes("zkube-local-daily-row-seed-v1"), today.DayId), today.DayId);
        }
        // Today's attempt, reserved and not finished, is the player's one try:
        // after a restart it is played on from its saved accepted log. An
        // earlier day's unfinished attempt stays used, and so does one whose log
        // this build cannot replay.
        private void RestoreDaily()
        {
            lock (gate)
            {
                var attempt = store.Read.DailyAttempt; var today = Today();
                if (attempt == null || attempt.Finished || attempt.DayId != today.DayId) return;
                try { Replay(() => Open(today), attempt.Actions); }
                // A log this build cannot replay must not keep the app from opening: the attempt stays used.
                catch (Exception) { }
            }
        }
        protected override void SaveActions(Record record)
        {
            if (record.Mode != "daily") return;
            store.Write(current => {
                var next = Copy(current);
                if (next.DailyAttempt != null && next.DailyAttempt.DayId == record.Day && !next.DailyAttempt.Finished)
                    next.DailyAttempt.Actions = new System.Collections.Generic.List<LocalCampaignAction>(record.Actions);
                return next;
            });
        }
        protected override void RecordTerminal(Record record, RunSummary summary)
        {
            if (!record.Recorded)
            {
                record.Recorded = true;
                store.Write(current => {
                    var next = Copy(current);
                    next.BestDailyScore = Math.Max(current.BestDailyScore, summary.DailyScore);
                    if (next.DailyAttempt != null && next.DailyAttempt.DayId == record.Day) { next.DailyAttempt.DailyScore = summary.DailyScore; next.DailyAttempt.ObjectiveTotal = summary.ObjectiveTotal; next.DailyAttempt.Tier = summary.CurrentTier; next.DailyAttempt.Finished = true; }
                    return next;
                });
            }
        }
        private static RealmDefinition Realm(byte id) => Protocol.Realms.SingleOrDefault(realm => realm.MapId == id) ?? throw new ArgumentException($"Campaign realm {id} is not authored");
        private static BuildConfigRequest Rules(RealmDefinition realm) => new BuildConfigRequest {
            RulesHash = Enumerable.Repeat((byte)0x33, 32).ToArray(), InitialReplay = Enumerable.Repeat((byte)0x42, 32).ToArray(),
            BonusType = checked((byte)realm.GuardianAndHeight[0]), Trigger = checked((byte)realm.GuardianAndHeight[1]),
            TriggerThreshold = realm.GuardianAndHeight[2], StartingHeight = checked((byte)realm.GuardianAndHeight[3]),
        };
    }
}
