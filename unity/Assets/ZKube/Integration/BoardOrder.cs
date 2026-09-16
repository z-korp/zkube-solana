namespace ZKube.Integration
{
    public static class BoardOrder
    {
        public static int Compare(ulong leftMetric, long leftTime, string leftOwner,
            ulong rightMetric, long rightTime, string rightOwner)
            => ZKube.Core.NativeEngine.CompareBoardEntries(leftMetric, leftTime, SolanaAddress.Bytes(leftOwner),
                rightMetric, rightTime, SolanaAddress.Bytes(rightOwner));
    }
}
