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
        public const string StorageKey = "daily";
        public string ActiveRun { get; }
        public RunMarker(string owner, ulong runId, string activeRun)
        {
            if (runId == 0) throw new ArgumentException("Invalid run marker");
            SolanaAddress.Bytes(owner); SolanaAddress.Bytes(activeRun);
            Owner = owner; RunId = runId; ActiveRun = activeRun;
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
        public RunMarker Marker { get; internal set; }
        public AccountEnvelope Account { get; internal set; }
    }

    public sealed class RunRecovery
    {
        private readonly string program, delegationProgram;
        private readonly Func<AccountEnvelope, string, JObject> decodeRun;
        public RunRecovery(string program, string delegationProgram, AccountBindings accounts)
            : this(program, delegationProgram, (envelope, authority) => {
                new ActiveRunReconciler(accounts).Reconcile(envelope, authority);
                return accounts.ActiveRun(envelope, authority);
            }) { }

        // This injection is also the agreement seam for routing-only fixture
        // cases. Production validates the account and native run invariants.
        private RunRecovery(string program, string delegationProgram,
            Func<AccountEnvelope, string, JObject> decodeRun)
        {
            SolanaAddress.Bytes(program); SolanaAddress.Bytes(delegationProgram);
            this.program = program; this.delegationProgram = delegationProgram;
            this.decodeRun = decodeRun;
        }

        public async Task<RunRecoveryResult> Resolve(RunMarker marker, IRecoveryTransport transport, long nowUnix)
        {
            if (nowUnix < 0 || nowUnix > 9007199254740991L) throw new ArgumentOutOfRangeException(nameof(nowUnix));
            if (marker == null) return new RunRecoveryResult { Phase = "none" };
            RunRecoveryResult Result(string phase, AccountEnvelope account = null) =>
                new RunRecoveryResult { Phase = phase, Marker = marker, Account = account };
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
                return Matches(decoded, marker) ? Result("delegated", envelope) : Result("missing");
            }
            var active = await transport.ReadBase(marker.ActiveRun);
            if (active?.Owner == delegationProgram) return Result("resolving");
            if (active == null) return Result("missing");
            if (active.Owner != program || active.Executable) throw new FormatException("ActiveRun account is not owned by the zKube program");
            var run = decodeRun(active, marker.Owner);
            if (!Matches(run, marker)) return Result("missing");
            string lifecycle = ((JObject)run["lifecycle"]).Properties().Single().Name;
            return Result(lifecycle == "Finished" ? "settleable" : "base", active);
        }

        private static bool Matches(JObject run, RunMarker marker) => run != null && (string)run["owner"] == marker.Owner &&
            (ulong)run["run_id"] == marker.RunId;
    }
}
