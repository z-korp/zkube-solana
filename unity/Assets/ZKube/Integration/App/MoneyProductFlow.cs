using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;

namespace ZKube.Integration.App
{
    public sealed partial class MoneyAppFlow
    {
        // All connected product pages publish under the same owner epoch,
        // economy revision and shutdown drain. A read never repairs a session
        // or resumes a transaction; those remain explicit owner actions.
        private Task<MoneyRead<T>> ReadOwnerProduct<T>(CancellationToken cancellation,
            Func<IdentityLease, CancellationToken, Task<T>> action) => Track(async () => {
                var lease = services.Identity.Lease(); var read = BeginRead(false, cancellation, lease);
                try
                {
                    await ownerReads.WaitAsync(read.Token).ConfigureAwait(false);
                    try
                    {
                        long revision = services.EconomyRevision(lease.Owner);
                        var value = await action(lease, read.Token).ConfigureAwait(false);
                        Require(read, lease);
                        if (services.EconomyRevision(lease.Owner) != revision)
                            throw new OperationCanceledException("Owner economy changed during product refresh");
                        return new MoneyRead<T>(value, () => Current(read, lease) &&
                            services.EconomyRevision(lease.Owner) == revision);
                    }
                    finally { ownerReads.Release(); }
                }
                finally { EndRead(read); }
            });
    }
}
