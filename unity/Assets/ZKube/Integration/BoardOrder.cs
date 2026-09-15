using System;

namespace ZKube.Integration
{
    // compare_arena_entries / keeper compareBoardSources share this ordering.
    public static class BoardOrder
    {
        public static int Compare(ulong leftMetric, long leftTime, string leftOwner,
            ulong rightMetric, long rightTime, string rightOwner)
        {
            int metric = rightMetric.CompareTo(leftMetric); if (metric != 0) return metric;
            int time = leftTime.CompareTo(rightTime); if (time != 0) return time;
            byte[] a = SolanaAddress.Bytes(leftOwner), b = SolanaAddress.Bytes(rightOwner);
            for (int i = 0; i < a.Length; i++) if (a[i] != b[i]) return a[i].CompareTo(b[i]);
            return 0;
        }
    }
}
