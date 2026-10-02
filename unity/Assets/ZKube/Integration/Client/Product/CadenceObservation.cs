using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    // What a player's transaction should carry right now, read from the chain
    // of prepared Dailies: the one Daily to prepare, if it does not exist, and
    // the finished Dailies to finalize, oldest first. A Daily exists only for a
    // day somebody entered, so there is never an unplayed day in between.
    public sealed class CadenceObservation
    {
        public uint? PrepareDay { get; private set; }
        public IReadOnlyList<CadenceStep> Steps { get; private set; } = Array.Empty<CadenceStep>();
        // The unfinalized Daily directly before the newest one: what the
        // newest pot is still waiting for.
        public JObject Predecessor { get; private set; }
        public ulong Slot { get; private set; }
        public bool Due => PrepareDay.HasValue || Steps.Count != 0;

        // `today` is today's decoded Daily, or null when nobody has entered it yet.
        public static async Task<CadenceObservation> Read(AccountBindings accounts, TransactionPlanner addresses,
            SolanaRpcTransport rpc, JObject protocol, JObject today, uint day, long now, ulong? minContextSlot, CancellationToken token)
        {
            var result = new CadenceObservation { Slot = minContextSlot ?? 0 };
            if (protocol == null || (uint)protocol["launch_day_id"] == 0) return result;
            uint lastPrepared = (uint)protocol["last_prepared_day"];
            // The one Daily the program lets anyone prepare: today's, or during
            // a suspension the first day after it.
            uint preparable = Math.Max(day, (uint)protocol["suspended_until_day"]);
            async Task<JObject> Daily(uint id)
            {
                var read = await rpc.ReadAccount(rpc.Base, addresses.Daily(id), minContextSlot: minContextSlot, cancellation: token).ConfigureAwait(false);
                result.Slot = Math.Max(result.Slot, read.Slot);
                return read.Envelope == null ? null : accounts.ArenaDaily(read.Envelope, id);
            }
            uint following, cursor; bool applied;
            if (lastPrepared < preparable)
            {
                result.PrepareDay = preparable; following = preparable; cursor = lastPrepared; applied = false;
            }
            else
            {
                var newest = today != null && lastPrepared == day ? today : await Daily(lastPrepared).ConfigureAwait(false);
                if (newest == null) return result;
                following = lastPrepared; cursor = (uint)newest["predecessor_day"]; applied = (bool)newest["predecessor_rollover_applied"];
            }
            // Walk back over the Dailies that have not finalized, newest first.
            var waiting = new List<(JObject Daily, uint Following)>();
            while (!applied && waiting.Count < DailyCadence.MaximumHops)
            {
                var daily = await Daily(cursor).ConfigureAwait(false);
                if (daily == null || DailyCadence.Finalized(daily)) break;
                waiting.Add((daily, following));
                following = cursor; applied = (bool)daily["predecessor_rollover_applied"]; cursor = (uint)daily["predecessor_day"];
            }
            if (waiting.Count == 0) return result;
            result.Predecessor = waiting[0].Daily;
            // Dailies finalize in chain order. The oldest must already have
            // received its own predecessor; each later one follows in the same transaction.
            waiting.Reverse();
            if (!(bool)waiting[0].Daily["predecessor_rollover_applied"]) return result;
            var steps = new List<CadenceStep>();
            foreach (var (daily, next) in waiting)
            {
                if (steps.Count == DailyCadence.MaximumSteps || !DailyCadence.WindowDone(daily, now)) break;
                steps.Add(new CadenceStep((uint)daily["day_id"], next));
            }
            result.Steps = steps.AsReadOnly();
            return result;
        }
    }
}
