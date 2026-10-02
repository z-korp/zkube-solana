namespace ZKube.Integration.Planning
{
    public static class PlanningConstants
    {
        public const uint ComputeUnitLimit = 400000U;
        public const uint ComputeUnitPrice = 1000U;
        // A transaction that carries a finalization asks for the most one
        // transaction may use: a day with full boards needs about 640,000 units
        // on top of the entry, and the next player must not be the one it fails for.
        public const uint CadenceComputeUnitLimit = 1400000U;
        public const uint LargestKreditPack = 25U;
        public const uint SettlementReserveLamports = 5000U;
        public const uint SessionLifetimeSeconds = 604500U;
        // How far back an entry looks for rewards to attach: the claim window,
        // plus the day a Daily takes to close and be finalized after it opens.
        public const uint ClaimLookbackDays = (uint)(ZKube.Core.Generated.Protocol.ClaimWindowSeconds / 86400UL) + 1U;
        public const int MaxAutoClaims = 2;
        public const string SystemProgram = "11111111111111111111111111111111";
        public const string ComputeBudgetProgram = "ComputeBudget111111111111111111111111111111";
        public const string DelegationProgram = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";
        public static readonly byte[] RevokeSessionDiscriminator = { 211, 59, 125, 188, 43, 155, 8, 102 };
    }
}
