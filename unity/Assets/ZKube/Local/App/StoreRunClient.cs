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
        { now = utcNow ?? throw new ArgumentNullException(nameof(utcNow)); }
        public LocalDaily Today()
        {
            long time = now();
            uint day = checked((uint)Math.Max(0, time / 86400));
            var pair = NativeEngine.DailyPair(day);
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
                var rules = Rules(Realm(today.Realm)); rules.TierPolicy = 1; rules.MaxMoves = checked((ushort)Protocol.DailyMaxMoves);
                rules.ObjectiveKind = today.ObjectiveKind; rules.ObjectiveValue = today.ObjectiveValue;
                var result = Start("daily", today.Realm, 1, rules, NativeEngine.LocalRowRandomness(Encoding.UTF8.GetBytes("zkube-local-daily-row-seed-v1"), today.DayId), today.DayId);
                // Persist the attempt before returning its opening to the player.
                store.Write(current => {
                    var next = Copy(current); next.Streak = current.DailyAttempt != null && (long)current.DailyAttempt.DayId == (long)today.DayId - 1 ? checked(current.Streak + 1) : 1;
                    next.DailyAttempt = new LocalDailyAttempt { DayId = today.DayId };
                    return next;
                });
                return result;
            }
        }
        protected override void RecordTerminal(Record record, RunSummary summary)
        {
            if (!record.Recorded)
            {
                record.Recorded = true;
                store.Write(current => {
                    var next = Copy(current);
                    next.BestDailyScore = Math.Max(current.BestDailyScore, summary.DailyScore);
                    if (next.DailyAttempt != null && next.DailyAttempt.DayId == record.Day) { next.DailyAttempt.DailyScore = summary.DailyScore; next.DailyAttempt.ObjectiveTotal = summary.ObjectiveTotal; next.DailyAttempt.Finished = true; }
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
