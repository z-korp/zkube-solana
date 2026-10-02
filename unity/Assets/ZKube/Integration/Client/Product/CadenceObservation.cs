using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    // What a player's transaction can carry right now: today's Daily to
    // prepare, if it does not exist, and the finished Dailies to finalize,
    // oldest first. It is read forward from the protocol's result root, which
    // names the last finalized Daily: every Daily after it is waiting, in day
    // order, whatever the backlog. Nothing here looks back from the newest.
    public sealed class CadenceObservation
    {
        public uint? PrepareDay { get; private set; }
        public IReadOnlyList<CadenceStep> Steps { get; private set; } = Array.Empty<CadenceStep>();
        public ulong Slot { get; private set; }

        public static async Task<CadenceObservation> Read(AccountBindings accounts, TransactionPlanner addresses,
            SolanaRpcTransport rpc, JObject protocol, uint day, long now, ulong? minContextSlot, CancellationToken token)
        {
            var result = new CadenceObservation { Slot = minContextSlot ?? 0 };
            if (protocol == null || (uint)protocol["launch_day_id"] == 0) return result;
            uint newest = (uint)protocol["last_prepared_day"];
            // Only today's Daily can ever be prepared.
            if (newest < day) result.PrepareDay = day;
            // The Dailies waiting to finalize are those after the last one in
            // the root. The oldest and the next few are all a transaction needs.
            uint first = Math.Max((uint)protocol["launch_day_id"], checked((uint)protocol["last_daily_id"] + 1));
            var waiting = new List<JObject>();
            for (ulong from = first; from <= newest && waiting.Count <= DailyCadence.MaximumSteps; from += SolanaRpcTransport.MaximumBatchAccounts)
            {
                var days = Enumerable.Range(0, SolanaRpcTransport.MaximumBatchAccounts).Select(offset => from + (ulong)offset)
                    .Where(candidate => candidate <= newest).Select(candidate => (uint)candidate).ToArray();
                var read = await rpc.ReadAccounts(rpc.Base, days.Select(addresses.Daily).ToArray(),
                    minContextSlot: minContextSlot, cancellation: token).ConfigureAwait(false);
                result.Slot = Math.Max(result.Slot, read.Slot);
                for (int index = 0; index < days.Length; index++)
                    if (read.Accounts[index].Envelope != null) waiting.Add(accounts.ArenaDaily(read.Accounts[index].Envelope, days[index]));
            }
            var steps = new List<CadenceStep>();
            for (int index = 0; index < waiting.Count && steps.Count < DailyCadence.MaximumSteps; index++)
            {
                var daily = waiting[index];
                // Each finalizes into the Daily prepared after it: the next one
                // waiting, or today's when this transaction prepares it.
                uint? following = index + 1 < waiting.Count ? (uint)waiting[index + 1]["day_id"]
                    : (uint)daily["day_id"] == newest ? result.PrepareDay : null;
                if (DailyCadence.Finalized(daily) || !following.HasValue || !DailyCadence.WindowDone(daily, now)) break;
                steps.Add(new CadenceStep((uint)daily["day_id"], following.Value));
            }
            result.Steps = steps.AsReadOnly();
            return result;
        }
    }
}
