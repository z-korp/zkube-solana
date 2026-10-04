using ZKube.Core.Generated;

namespace ZKube.Integration.Planning
{
    // The one owner of what the owner's wallet puts on a device. Each part is a
    // cost of a paid run: the generated rents come from the program's account
    // sizes and the pinned delegation program, the fee from this client's own
    // compute budget.
    public static class DeviceFunding
    {
        // One signature plus the priority fee every plan requests.
        public const ulong TransactionFeeLamports =
            5000UL + (ulong)PlanningConstants.ComputeUnitLimit * PlanningConstants.ComputeUnitPrice / 1000000UL;
        // MagicBlock's published charge for one delegation session.
        public const ulong DelegationChargeLamports = 300000UL;
        // A run sends entry and consume on Base and is delegated once.
        public const ulong RunCostLamports = 2UL * TransactionFeeLamports + DelegationChargeLamports;

        // The balance a device needs to enter now: its own rent floor, the rent
        // the entry transaction holds at once, and the run's costs. The daily
        // player's rent is paid once a day and returns when that account closes.
        public static ulong EntryBalanceLamports(bool dailyPlayerExists) =>
            Protocol.SystemAccountRentLamports + Protocol.FirstEntryPeakRentLamports -
            (dailyPlayerExists ? Protocol.ArenaPlayerRentLamports : 0UL) + RunCostLamports;

        // What a run costs, as the figure a player reads: the nearest 0.0001 SOL.
        public const ulong RunCostShownLamports = (RunCostLamports + 50000UL) / 100000UL * 100000UL;

        // The deposit: a first entry of the day, then the run costs of the rest
        // of the largest Kredit pack, so one pack plays without a top-up. Rounded
        // up to the protocol's 0.001 SOL unit, the figure a player reads. What a
        // device has left of it returns to the wallet when the device is disabled.
        public static readonly ulong DepositLamports = Protocol.PayoutUnitLamports * (
            (EntryBalanceLamports(false) + (PlanningConstants.LargestKreditPack - 1UL) * RunCostLamports +
             Protocol.PayoutUnitLamports - 1UL) / Protocol.PayoutUnitLamports);
    }
}
