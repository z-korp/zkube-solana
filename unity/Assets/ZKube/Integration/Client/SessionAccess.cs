using System;
using System.Threading.Tasks;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    // Only these expected absence/readiness outcomes allow an explicit owner
    // settlement fallback. Invalid account relationships and failed RPC reads do not.
    public sealed class SessionUnavailableException : InvalidOperationException
    {
        internal SessionUnavailableException(string message) : base(message) { }
    }
    public sealed class AuthorizedDeviceSession : IDisposable
    {
        public DeviceSigner Signer { get; }
        public PlannerActor Actor { get; }
        public SessionAssessment Assessment { get; }
        internal AuthorizedDeviceSession(DeviceSigner signer, PlannerActor actor, SessionAssessment assessment)
        { Signer = signer; Actor = actor; Assessment = assessment; }
        public void Dispose() => Signer.Dispose();
    }
    public sealed class SessionAccess
    {
        private readonly WalletClient wallet;
        private readonly SessionRecordStore records;
        private readonly SessionTokenBindings tokens;
        private readonly SolanaRpcTransport rpc;
        private readonly string program;
        private readonly Func<long> now;
        public SessionAccess(WalletClient wallet, SessionRecordStore records, SessionTokenBindings tokens,
            SolanaRpcTransport rpc, string program, Func<long> now)
        { this.wallet = wallet; this.records = records; this.tokens = tokens; this.rpc = rpc; this.program = program; this.now = now; }
        public async Task<AuthorizedDeviceSession> Load(IdentityLease lease)
        {
            lease.Cancellation.ThrowIfCancellationRequested();
            var saved = await records.Load(lease.Owner).ConfigureAwait(false);
            var signer = await wallet.LoadDeviceSigner(lease.Owner).ConfigureAwait(false);
            try
            {
                if (saved.Active == null || signer == null) throw new SessionUnavailableException("Enable a device session first");
                var observation = await rpc.ReadAccounts(rpc.Base, new[] { saved.Active.Token, saved.Active.Signer }, cancellation: lease.Cancellation).ConfigureAwait(false);
                ulong rent = await rpc.RentFloor(rpc.Base, 0, lease.Cancellation).ConfigureAwait(false);
                long observedNow = now();
                var assessment = SessionReadiness.Inspect(saved.Active, signer.Address, observation.Accounts[0].Envelope,
                    observation.Accounts[1], rent, observedNow, tokens, program);
                if (!assessment.Current) throw new SessionUnavailableException("Renew the device session before playing");
                if (assessment.Funding != "ready") throw new SessionUnavailableException("Refill the device allowance before playing");
                var actor = PlannerActor.Device(lease.Owner, signer.Address, observation.Accounts[0].Envelope, tokens, program, observedNow);
                lease.Cancellation.ThrowIfCancellationRequested();
                return new AuthorizedDeviceSession(signer, actor, assessment);
            }
            catch { signer?.Dispose(); throw; }
        }
    }
}
