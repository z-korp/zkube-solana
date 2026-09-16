using System;
using System.Collections.Generic;
using System.Numerics;

namespace ZKube.Integration
{
    public sealed class ValidatedBoardRow
    {
        public uint Position { get; }
        public string Player { get; }
        public uint Score { get; }
        public ulong ObjectiveTotal { get; }
        public long FinalizedAt { get; }
        public bool Claimed { get; }
        internal ValidatedBoardRow(uint position, string player, uint score, ulong objective, long finalized,
            bool claimed)
        { Position = position; Player = player; Score = score; ObjectiveTotal = objective; FinalizedAt = finalized;
            Claimed = claimed; }
    }
    public sealed class ValidatedBoardAccount
    {
        public string Address { get; }
        public uint DayId { get; }
        public string Kind { get; }
        public uint PayoutCount { get; }
        public uint QualifiedCount { get; }
        public BigInteger Denominator { get; }
        public ulong PoolLamports { get; }
        public long SealedAt { get; }
        public bool Sealed { get; }
        public bool CapacityLimited { get; }
        public uint WidthCount { get; }
        public ulong PaidLamports { get; }
        public ulong RolloverLamports { get; }
        public ulong ClaimedLamports { get; }
        public IReadOnlyList<ValidatedBoardRow> Rows { get; }
        internal ValidatedBoardAccount(string address, uint day, string kind, uint count, uint qualified,
            BigInteger denominator, ulong pool, long sealedAt, bool sealedBoard, bool limited, ValidatedBoardRow[] rows,
            uint width, ulong paid, ulong rollover, ulong claimed)
        { Address = address; DayId = day; Kind = kind; PayoutCount = count; QualifiedCount = qualified;
            Denominator = denominator; PoolLamports = pool; SealedAt = sealedAt; Sealed = sealedBoard;
            CapacityLimited = limited; Rows = Array.AsReadOnly((ValidatedBoardRow[])rows.Clone());
            WidthCount = width; PaidLamports = paid; RolloverLamports = rollover; ClaimedLamports = claimed; }
    }
}
