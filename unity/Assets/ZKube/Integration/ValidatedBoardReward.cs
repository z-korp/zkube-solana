namespace ZKube.Integration
{
    public sealed class ValidatedBoardReward
    {
        public uint DayId { get; }
        public string Kind { get; }
        public uint Position { get; }
        public long SealedAt { get; }
        public bool Claimed { get; }
        public string Owner { get; }
        public string BoardAddress { get; }
        internal ValidatedBoardReward(uint dayId, string kind, uint position, long sealedAt, bool claimed, string owner, string boardAddress)
        {
            DayId = dayId; Kind = kind; Position = position; SealedAt = sealedAt;
            Claimed = claimed; Owner = owner; BoardAddress = boardAddress;
        }
    }
}
