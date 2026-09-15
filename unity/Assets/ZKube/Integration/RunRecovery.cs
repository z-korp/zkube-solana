using System;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;

namespace ZKube.Integration
{
    public sealed class RunMarker
    {
        public string Owner { get; }
        public ulong RunId { get; }
        public string Mode { get; }
        public string ActiveRun { get; }
        public string SessionSigner { get; }
        public string SessionToken { get; }
        public long ValidUntil { get; }
        public RunMarker(string owner, ulong runId, string mode, string activeRun, string sessionSigner, string sessionToken, long validUntil)
        {
            if (runId == 0 || (mode != "daily")) throw new ArgumentException("Invalid run marker");
            SolanaAddress.Bytes(owner); SolanaAddress.Bytes(activeRun);
            if ((sessionSigner == null) != (sessionToken == null) || validUntil < -9007199254740991L || validUntil > 9007199254740991L ||
                (sessionSigner == null && validUntil != 0)) throw new FormatException("Invalid run marker session");
            if (sessionSigner != null) { SolanaAddress.Bytes(sessionSigner); SolanaAddress.Bytes(sessionToken); }
            Owner = owner; RunId = runId; Mode = mode; ActiveRun = activeRun; SessionSigner = sessionSigner;
            SessionToken = sessionToken; ValidUntil = validUntil;
        }
    }

    public sealed class DelegationPlacement
    {
        public bool IsDelegated { get; set; }
        public string Endpoint { get; set; }
        public string RecordOwner { get; set; }
    }

    public interface IRecoveryTransport
    {
        string BaseEndpoint { get; }
        Task<AccountEnvelope> ReadBase(string address);
        Task<DelegationPlacement> Placement(string activeRun);
        Task<AccountEnvelope> ReadEr(string endpoint, string activeRun);
    }

    public sealed class RunRecoveryResult
    {
        public string Phase { get; internal set; }
        public bool SessionAuthorized { get; internal set; }
        public string Endpoint { get; internal set; }
        public RunMarker Marker { get; internal set; }
        public AccountEnvelope Account { get; internal set; }
    }

    public sealed class RunRecovery
    {
        private readonly string program, delegationProgram;
        private readonly SessionTokenBindings sessions;
        private readonly Func<AccountEnvelope, string, JObject> decodeRun;
        public RunRecovery(string program, string delegationProgram, SessionTokenBindings sessions, AccountBindings accounts)
            : this(program, delegationProgram, sessions, (envelope, authority) => {
                new ActiveRunReconciler(accounts).Reconcile(envelope, authority);
                return accounts.ActiveRun(envelope, authority);
            }) { }

        // This injection is also the agreement seam for routing-only fixture
        // cases. Production validates the account and native run invariants.
        public RunRecovery(string program, string delegationProgram, SessionTokenBindings sessions,
            Func<AccountEnvelope, string, JObject> decodeRun)
        {
            SolanaAddress.Bytes(program); SolanaAddress.Bytes(delegationProgram);
            this.program = program; this.delegationProgram = delegationProgram;
            this.sessions = sessions; this.decodeRun = decodeRun;
        }

        public async Task<RunRecoveryResult> Resolve(RunMarker marker, IRecoveryTransport transport, long nowUnix)
        {
            if (nowUnix < 0 || nowUnix > 9007199254740991L) throw new ArgumentOutOfRangeException(nameof(nowUnix));
            if (marker == null) return new RunRecoveryResult { Phase = "none" };
            bool authorized = false;
            if (marker.SessionToken != null && marker.ValidUntil - nowUnix > ClientPolicy.SessionReadySkewSeconds)
            {
                var tokenInfo = await transport.ReadBase(marker.SessionToken);
                if (tokenInfo != null)
                {
                    try
                    {
                        var token = sessions.Decode(tokenInfo);
                        authorized = token.Authority == marker.Owner && token.TargetProgram == program &&
                            token.SessionSigner == marker.SessionSigner && token.FeePayer == marker.Owner &&
                            Math.Min(marker.ValidUntil, token.ValidUntil) - nowUnix > ClientPolicy.SessionReadySkewSeconds;
                    }
                    catch (FormatException) { authorized = false; }
                }
            }
            RunRecoveryResult Result(string phase, AccountEnvelope account = null, string endpoint = null) =>
                new RunRecoveryResult { Phase = phase, SessionAuthorized = authorized, Marker = marker, Account = account, Endpoint = endpoint };
            var placement = await transport.Placement(marker.ActiveRun);
            if (placement.IsDelegated && placement.Endpoint != null)
            {
                if (placement.RecordOwner != null && placement.RecordOwner != program)
                    throw new FormatException("Delegation record owner does not match zKube");
                var envelope = await transport.ReadEr(placement.Endpoint, marker.ActiveRun);
                if (envelope == null) return Result("resolving");
                if (envelope.Owner != program || envelope.Executable)
                    throw new FormatException("Resolved ER account " + marker.ActiveRun + " is not owned by zKube");
                var decoded = decodeRun(envelope, marker.Owner);
                return Matches(decoded, marker) ? Result("delegated", envelope, placement.Endpoint) : Result("missing");
            }
            var active = await transport.ReadBase(marker.ActiveRun);
            if (active?.Owner == delegationProgram) return Result("resolving");
            if (active == null) return Result("missing");
            if (active.Owner != program || active.Executable) throw new FormatException("ActiveRun account is not owned by the zKube program");
            var run = decodeRun(active, marker.Owner);
            if (!Matches(run, marker)) return Result("missing");
            string lifecycle = ((JObject)run["lifecycle"]).Properties().Single().Name;
            return Result(lifecycle == "Finished" ? "settleable" : "base", active, transport.BaseEndpoint);
        }

        private static bool Matches(JObject run, RunMarker marker) => run != null && (string)run["owner"] == marker.Owner &&
            (ulong)run["run_id"] == marker.RunId &&
            string.Equals(((JObject)run["mode"]).Properties().Single().Name, marker.Mode, StringComparison.OrdinalIgnoreCase);
    }
}
