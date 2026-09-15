using System;

namespace ZKube.Local.App
{
    public static class StoreCampaignPolicy
    {
        public static Func<byte, bool> PurchaseGate(LocalProductStore product) =>
            realm => realm >= 4 && !product.Read.CampaignOwned;
    }

    public sealed class LocalDaily
    {
        public uint DayId { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        public long OpensAt => (long)DayId * 86400;
        public long FreezesAt => ((long)DayId + 1) * 86400;
        internal LocalDaily(uint day, byte realm, byte kind, byte value)
        { DayId = day; Realm = realm; ObjectiveKind = kind; ObjectiveValue = value; }
    }
}
