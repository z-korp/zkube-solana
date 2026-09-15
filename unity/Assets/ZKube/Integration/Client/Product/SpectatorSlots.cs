using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Integration.Client
{
    public sealed partial class ProductQueries
    {
        // Explicit durable-slot selection complements the TS-compatible latest
        // run-ID query. Either mode may be older than next_run_id-1.
        public Task<ProductRead<SpectatorSnapshot>> SpectateSlot(string owner, string mode,
            CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            SolanaAddress.Bytes(owner);
            if (mode != "campaign" && mode != "ranked") throw new ArgumentException("Unknown durable run mode", nameof(mode));
            string playerAddress = addresses.Player(owner);
            var before = await rpc.ReadAccount(rpc.Base, playerAddress, cancellation: token).ConfigureAwait(false);
            if (before.Envelope == null) return new SpectatorSnapshot("not-found", owner);
            string field = mode == "campaign" ? "campaign_active_run_id" : "active_run_id";
            var player = accounts.PlayerState(before.Envelope, owner);
            ulong runId = (ulong)player[field];
            if (runId == 0) return new SpectatorSnapshot("not-found", owner);
            if (runId >= (ulong)player["next_run_id"]) throw new FormatException("Durable slot exceeds the allocated run sequence");
            var result = await ReadSpectator(owner, runId, token, before.Slot).ConfigureAwait(false);
            var after = await rpc.ReadAccount(rpc.Base, playerAddress, minContextSlot: before.Slot, cancellation: token).ConfigureAwait(false);
            if (after.Envelope == null || (ulong)accounts.PlayerState(after.Envelope, owner)[field] != runId)
                return new SpectatorSnapshot("changed", owner, runId, result.Address);
            if (result.Account != null)
            {
                var actual = accounts.ActiveRun(result.Account, owner);
                string actualMode = ((Newtonsoft.Json.Linq.JObject)actual["mode"]).Properties().Single().Name.ToLowerInvariant();
                if (actualMode != (mode == "ranked" ? "daily" : "campaign")) throw new FormatException("Durable slot run mode differs from PlayerState reservation");
            }
            return result;
        });
    }
}
