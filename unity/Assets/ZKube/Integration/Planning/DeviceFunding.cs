using ZKube.Core.Generated;

namespace ZKube.Integration.Planning
{
    // The one owner of what the owner's wallet puts on a device. Each part is a
    // cost of a paid run: the generated figures are the cluster's, as the
    // program states them from its account sizes and the delegation program's
    // charges, and the fee comes from this client's own compute budget.
    public static class DeviceFunding
    {
        // One signature plus the priority fee every plan requests.
        public const ulong TransactionFeeLamports =
            5000UL + (ulong)PlanningConstants.ComputeUnitLimit * PlanningConstants.ComputeUnitPrice / 1000000UL;
        // The delegation program's fee for one session, kept when the run
        // undelegates out of what the entry put into its two accounts.
        public const ulong DelegationChargeLamports = Protocol.DelegationChargeLamports;
        // What a run leaves the device short of: that fee, and the fees of
        // the entry and the consume it sends on Base.
        public const ulong RunCostLamports = 2UL * TransactionFeeLamports + DelegationChargeLamports;

        // The balance a device needs to enter now: its own rent floor, what
        // the entry transaction takes (the run, the delegation accounts and,
        // once a day, the daily player) and its fee. The charge is already in
        // that: it is taken from the delegation accounts, whose rest returns.
        public static ulong EntryBalanceLamports(bool dailyPlayerExists) =>
            Protocol.SystemAccountRentLamports + Protocol.FirstEntryPeakRentLamports -
            (dailyPlayerExists ? Protocol.ArenaPlayerRentLamports : 0UL) + TransactionFeeLamports;

        // What a run costs, as the figure a player reads: the nearest 0.0001 SOL.
        public const ulong RunCostShownLamports = (RunCostLamports + 50000UL) / 100000UL * 100000UL;

        // The deposit: a first entry of the day, then the run costs of the
        // further runs it pays for without a top-up (Protocol.DeviceDepositRuns,
        // the owner's choice). Rounded up to the protocol's 0.001 SOL unit, the
        // figure a player reads. What a device has left of it returns to the
        // wallet when the device is disabled.
        public static readonly ulong DepositLamports = Protocol.PayoutUnitLamports * (
            (EntryBalanceLamports(false) + Protocol.DeviceDepositRuns * RunCostLamports +
             Protocol.PayoutUnitLamports - 1UL) / Protocol.PayoutUnitLamports);
    }
}
