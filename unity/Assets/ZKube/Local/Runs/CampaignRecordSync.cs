using System;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Local
{
    // The durable pending flag belongs to the play record. A failed or unknown
    // write is retried by merging again; duplicate submissions are harmless.
    public sealed class CampaignRecordSync
    {
        private readonly object gate = new object();
        private readonly LocalProductStore product;
        private readonly LocalRunClient runs;
        private readonly Func<CancellationToken, Task<byte[]>> read;
        private readonly Func<byte[], CancellationToken, Task<bool>> writeWhenReady;
        private Task attempt = Task.CompletedTask;
        private bool retryRequested;
        private CancellationToken requestedCancellation, requestedShutdown;
        public Exception LastError { get; private set; }
        public Task Pending { get { lock (gate) return attempt; } }

        public CampaignRecordSync(LocalProductStore product, LocalRunClient runs,
            Func<CancellationToken, Task<byte[]>> read, Func<byte[], CancellationToken, Task<bool>> writeWhenReady)
        { this.product = product; this.runs = runs; this.read = read; this.writeWhenReady = writeWhenReady; }

        public void Start(CancellationToken cancellation, CancellationToken shutdown = default)
        {
            lock (gate)
            {
                if (product.Owner == null) return;
                requestedCancellation = cancellation; requestedShutdown = shutdown;
                if (!attempt.IsCompleted) { retryRequested = true; return; }
                attempt = Task.Run(async () => {
                    while (true)
                    {
                        CancellationToken currentCancellation, currentShutdown;
                        lock (gate) {
                            currentCancellation = requestedCancellation; currentShutdown = requestedShutdown;
                            retryRequested = false;
                        }
                        using (var linked = CancellationTokenSource.CreateLinkedTokenSource(currentCancellation, currentShutdown))
                            await Sync(linked.Token).ConfigureAwait(false);
                        lock (gate) {
                            if (retryRequested) continue;
                            attempt = Task.CompletedTask;
                            return;
                        }
                    }
                }, CancellationToken.None);
            }
        }
        private async Task Sync(CancellationToken cancellation)
        {
            try
            {
                LastError = null;
                var chain = await read(cancellation).ConfigureAwait(false);
                cancellation.ThrowIfCancellationRequested();
                runs.MergeCampaignRecord(chain);
                if (!product.Read.CampaignWritePending) return;
                var submitted = runs.PackedCampaignStars();
                if (await writeWhenReady(submitted, cancellation).ConfigureAwait(false))
                    runs.AcknowledgeCampaignRecord(submitted);
            }
            catch (Exception error) { LastError = error; }
        }
    }
}
