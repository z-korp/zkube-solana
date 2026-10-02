using ZKube.Core;
using System;

namespace ZKube.Local.App
{
    public static class StoreCampaignPolicy
    {
        public const byte FirstPurchasedRealm = 4;
        public static Func<byte, bool> PurchaseGate(LocalProductStore product) =>
            realm => realm >= FirstPurchasedRealm && !product.Read.CampaignOwned;
    }

    public sealed class LocalDaily
    {
        public uint DayId { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        // The local Daily shares the core's day: it opens when the core's day
        // opens (07:00 UTC) and gives way when the next one does.
        public long OpensAt => (long)NativeEngine.Daily(DayId).OpensAt;
        public long FreezesAt => OpensAt + 86400;
        internal LocalDaily(uint day, byte realm, byte kind, byte value)
        { DayId = day; Realm = realm; ObjectiveKind = kind; ObjectiveValue = value; }
    }
}
