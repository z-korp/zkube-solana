using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Integration.Client
{
    public sealed class IdentityLease
    {
        public string Owner { get; }
        public long Epoch { get; }
        public CancellationToken Cancellation { get; }
        internal IdentityLease(string owner, long epoch, CancellationToken cancellation)
        { Owner = owner; Epoch = epoch; Cancellation = cancellation; }
    }
    public sealed class ClientIdentity
    {
        private readonly WalletClient wallet;
        private readonly object gate = new object();
        private int connecting;
        private bool disconnecting;
        private long epoch;
        private CancellationTokenSource lifetime = new CancellationTokenSource();
        private string owner;
        public string Owner => Volatile.Read(ref owner);
        public long Epoch { get { lock (gate) return epoch; } }
        public void InvalidateData(string observedOwner)
        { lock (gate) { if (owner == observedOwner) epoch++; } }
        internal bool HasCurrentData(IdentityLease lease)
        { lock (gate) return IsCurrent(lease) && lease.Epoch == epoch; }
        public ClientIdentity(WalletClient wallet) { this.wallet = wallet; }
        public async Task<string> Connect(string expectedOwner = null)
        {
            if (Interlocked.CompareExchange(ref connecting, 1, 0) != 0) throw new InvalidOperationException("Identity change is already pending");
            try
            {
                long requestedEpoch;
                lock (gate)
                {
                    if (owner != null || disconnecting) throw new InvalidOperationException("Finish disconnecting before choosing another wallet");
                    requestedEpoch = epoch;
                }
                string connected = await wallet.Authorize(expectedOwner).ConfigureAwait(false);
                lock (gate)
                {
                    if (requestedEpoch == epoch)
                    {
                        lifetime = new CancellationTokenSource();
                        Volatile.Write(ref owner, connected);
                        return connected;
                    }
                }
                // Disconnect invalidated this authorization while the external
                // wallet was open. Its late success never restores app identity.
                await wallet.Disconnect(connected).ConfigureAwait(false);
                throw new OperationCanceledException("Wallet authorization was superseded");
            }
            finally { Volatile.Write(ref connecting, 0); }
        }
        public async Task Disconnect(Func<string, Task> cleanup = null)
        {
            string previous;
            CancellationTokenSource cancelled;
            lock (gate)
            {
                if (disconnecting) throw new InvalidOperationException("Disconnect is already pending");
                disconnecting = true;
                epoch++; previous = Interlocked.Exchange(ref owner, null);
                cancelled = lifetime;
            }
            // Cancellation runs caller callbacks; never invoke them under the
            // identity lock or dispose a source another disconnect captured.
            try
            {
                var errors = new List<Exception>();
                try { cancelled.Cancel(); }
                catch (AggregateException error) { errors.Add(error); }
                if (previous != null)
                {
                    try { await wallet.Disconnect(previous).ConfigureAwait(false); }
                    catch (WalletRequestException error) when (error.Code == "wallet-busy")
                    { /* The invalidated identity lease rejects the outstanding result. */ }
                    catch (Exception error) { errors.Add(error); }
                    finally
                    {
                        if (cleanup != null)
                            try { await cleanup(previous).ConfigureAwait(false); }
                            catch (Exception error) { errors.Add(error); }
                    }
                }
                if (errors.Count == 1) throw errors[0];
                if (errors.Count > 1) throw new AggregateException(errors);
            }
            finally { lock (gate) disconnecting = false; }
        }
        public IdentityLease Lease()
        {
            lock (gate) return new IdentityLease(owner ?? throw new InvalidOperationException("Connect the owner wallet first"), epoch, lifetime.Token);
        }
        public bool IsCurrent(IdentityLease lease)
        { lock (gate) return lease != null && owner == lease.Owner && lifetime.Token == lease.Cancellation && !lease.Cancellation.IsCancellationRequested; }
    }
}
