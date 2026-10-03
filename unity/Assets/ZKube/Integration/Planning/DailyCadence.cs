using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration.Planning
{
    // One finalization a transaction carries: a finished Daily and the Daily
    // prepared after it, which receives what the finished one sends on.
    public sealed class CadenceStep
    {
        public uint Day { get; }
        public uint Following { get; }
        // The rows the Daily's two boards retain, fixed once it can finalize:
        // what its finalization can cost at most.
        public uint RetainedRows { get; }
        public CadenceStep(uint day, uint following, uint retainedRows)
        {
            if (following <= day) throw new ArgumentException("A Daily finalizes into a later Daily");
            if (retainedRows > 2 * Protocol.ArenaBoardCapacity) throw new ArgumentOutOfRangeException(nameof(retainedRows));
            Day = day; Following = following; RetainedRows = retainedRows;
        }
        public ulong WorstCaseUnits => Protocol.FinalizationBaseUnits + Protocol.FinalizationRowUnits * RetainedRows;
    }

    // The one owner, on the client, of the rules a player's own transaction
    // carries the cadence by: when a Daily is finalized, when it can be, and
    // what a pot is while the Daily before it has not finalized yet. No keeper
    // is on this path; the program enforces the same rules.
    public static class DailyCadence
    {
        // The most finalizations one transaction is offered. How many it
        // carries is what fits when it is simulated; the rest wait for the next.
        public const int MaximumSteps = 2;

        // The rows a Daily's boards keep: each its qualifiers, up to its capacity.
        public static uint RetainedRows(JObject daily) =>
            Math.Min((uint)daily["score_qualified_players"], Protocol.ArenaBoardCapacity) +
            Math.Min((uint)daily["theme_qualified_players"], Protocol.ArenaBoardCapacity);

        // The compute a transaction states for the finalizations it carries:
        // each one's worst case, beside the reserve for what else it does
        // (today's preparation, the entry and its delegation, or a claim). It
        // is stated, never measured, so no state that changes after a
        // simulation can make the transaction run out.
        public static uint ComputeLimit(IEnumerable<CadenceStep> steps) =>
            checked((uint)(Protocol.FinalizationFollowingReserveUnits + steps.Aggregate(0UL, (sum, step) => sum + step.WorstCaseUnits)));

        // The due finalizations, oldest first, as many as fit one transaction's maximum.
        public static IReadOnlyList<CadenceStep> Affordable(IEnumerable<CadenceStep> steps)
        {
            var kept = new List<CadenceStep>();
            foreach (var step in steps)
            {
                if (ComputeLimit(kept.Append(step)) > Protocol.TransactionComputeUnits) break;
                kept.Add(step);
            }
            return kept.AsReadOnly();
        }

        // A Daily has no status: it is finalized once it carries the time it was.
        public static bool Finalized(JObject daily) => (long)daily["finalized_at"] != 0;

        // The clock's part of the program's rule: the window has closed, and
        // every entry is resolved or the recovery deadline has passed.
        public static bool WindowDone(JObject daily, long now)
        {
            long closes = (long)NativeEngine.Daily((uint)daily["day_id"]).FreezesAt;
            bool resolved = checked((ulong)daily["entries_scored"] + (ulong)daily["entries_expired"]) == (ulong)daily["entries_paid"];
            return now >= closes && (resolved || now >= checked(closes + (long)Protocol.RunRecoverySeconds));
        }

        public static bool Finalizable(JObject daily, long now) =>
            !Finalized(daily) && (bool)daily["predecessor_rollover_applied"] && WindowDone(daily, now);

        // What a Daily holds for its own winners: what reached it from before,
        // less what it has paid out or sent on. Its own entries' share is never in it.
        public static ulong Pool(JObject daily)
        {
            var ledger = daily["ledger"];
            var value = new System.Numerics.BigInteger((ulong)ledger["seeded_lamports"]) + (ulong)ledger["entry_lamports"] +
                (ulong)ledger["rollover_in_lamports"] - (ulong)ledger["payout_lamports"] - (ulong)ledger["rollover_out_lamports"];
            if (value < 0 || value > ulong.MaxValue) throw new FormatException("Daily ledger available pool is invalid");
            return (ulong)value;
        }

        // What an unfinalized Daily sends its successor when it finalizes: its
        // entries' prize share, and whatever its own boards will not pay. The
        // native payout plan is the program's, so this is the exact amount once
        // its runs are resolved.
        public static ulong Forwarded(JObject daily)
        {
            if (Finalized(daily)) return 0;
            ulong pool = Pool(daily), paid = 0;
            var pools = NativeEngine.BoardPools(pool, (uint)daily["theme_qualified_players"]);
            foreach (var (offset, qualified) in new[] { (0, (uint)daily["score_qualified_players"]), (8, (uint)daily["theme_qualified_players"]) })
            {
                ulong board = NativeWire.Read(pools, offset, 8);
                var width = NativeEngine.BoardWidth(board, qualified);
                uint paying = Math.Min(checked((uint)NativeWire.Read(width, 0, 4)), Protocol.ArenaBoardCapacity);
                var denominator = NativeWire.Bytes(width, 4, 16);
                for (uint rank = 1; rank <= paying; rank++) paid = checked(paid + NativeEngine.PayoutForRank(board, denominator, rank));
            }
            return checked(pool - paid + (ulong)daily["ledger"]["next_pot_lamports"]);
        }

        // The pot a lobby shows for a Daily: its own pool, plus what the Daily
        // before it still has to send. The figure is the same the moment before
        // and the moment after that Daily finalizes.
        public static ulong Pot(JObject daily, JObject predecessor)
        {
            ulong own = daily == null ? 0 : Pool(daily);
            bool waiting = predecessor != null && !Finalized(predecessor) &&
                (daily == null || !(bool)daily["predecessor_rollover_applied"]);
            return waiting ? checked(own + Forwarded(predecessor)) : own;
        }
    }
}
