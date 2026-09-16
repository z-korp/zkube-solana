using System;
using System.Threading.Tasks;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client
{
    public sealed class RunPersistence
    {
        private readonly RunStateStore store;
        public RunPersistence(RunStateStore store) { this.store = store; }
        public async Task Accept(RunRecordChange observation)
        {
            if (observation.State == RunRecordState.Consumed)
            {
                if (observation.PlayerAfter == null) throw new FormatException("Consumed run has no validated player observation");
                var marker = await store.Load(observation.Owner).ConfigureAwait(false);
                if (marker?.ActiveRun == observation.Address)
                    await store.ClearAfterConsumption(marker, observation.PlayerAfter, null, new DelegationPlacement { IsDelegated = false }).ConfigureAwait(false);
                return;
            }
            if (observation.State == RunRecordState.Absent) return;
            if (!observation.RunId.HasValue) throw new FormatException("Accepted run has no durable locator");
            var existing = await store.Load(observation.Owner).ConfigureAwait(false);
            if (existing?.ActiveRun == observation.Address) return;
            await store.Save(new RunMarker(observation.Owner, observation.RunId.Value, observation.Address)).ConfigureAwait(false);
        }
    }
}
