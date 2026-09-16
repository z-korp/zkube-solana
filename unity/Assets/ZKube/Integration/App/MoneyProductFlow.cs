using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;

namespace ZKube.Integration.App
{
    public sealed partial class MoneyAppFlow
    {
        // All connected product pages share the identity epoch and shutdown
        // drain. A read never repairs a session
        // or resumes a transaction; those remain explicit owner actions.
        private Task<MoneyRead<T>> ReadOwnerProduct<T>(CancellationToken cancellation,
            Func<IdentityLease, CancellationToken, Task<T>> action) => Track(async () => {
                var lease = services.Identity.Lease(); var read = BeginRead(false, cancellation, lease);
                try
                {
                    await ownerReads.WaitAsync(read.Token).ConfigureAwait(false);
                    try
                    {
                        var value = await action(lease, read.Token).ConfigureAwait(false);
                        Require(read, lease);
                        return new MoneyRead<T>(value, () => Current(read, lease));
                    }
                    finally { ownerReads.Release(); }
                }
                finally { EndRead(read); }
            });
    }
}
