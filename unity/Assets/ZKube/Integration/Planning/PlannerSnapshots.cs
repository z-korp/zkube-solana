using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration.Planning
{
    public sealed class BoardObservation
    {
        public uint DayId { get; }
        public string Kind { get; }
        public AccountEnvelope Account { get; }
        public BoardObservation(uint dayId, string kind, AccountEnvelope account)
        {
            if (kind != "score" && kind != "theme") throw new ArgumentException("Invalid board kind");
            DayId = dayId; Kind = kind; Account = account;
        }
    }

    public sealed class PlannerActor
    {
        public string Owner { get; }
        public string Signer { get; }
        public string SessionToken { get; }
        private PlannerActor(string owner, string signer, string token)
        { SolanaAddress.Bytes(owner); SolanaAddress.Bytes(signer); Owner = owner; Signer = signer; SessionToken = token; }
        public static PlannerActor Wallet(string owner) => new PlannerActor(owner, owner, null);
        public static PlannerActor Device(string owner, string signer, AccountEnvelope envelope, SessionTokenBindings bindings, string program, long now)
        {
            var token = bindings.Decode(envelope);
            if (token.Authority != owner || token.SessionSigner != signer || token.TargetProgram != program ||
                token.FeePayer != owner || token.ValidUntil <= checked(now + ClientPolicy.SessionReadySkewSeconds))
                throw new ArgumentException("Device session is not authorized");
            return new PlannerActor(owner, signer, envelope.Address);
        }
    }

    public sealed class PlayerPlanSnapshot
    {
        public string Owner { get; }
        public ulong NextRunId { get; }
        public ulong DailyRunId { get; }
        public ulong Kredits { get; }
        private PlayerPlanSnapshot(string owner, JObject fields)
        {
            Owner = owner; NextRunId = (ulong)fields["next_run_id"];
            DailyRunId = (ulong)fields["active_run_id"]; Kredits = (ulong)fields["kredit_balance"];
            if (NextRunId == 0 || NextRunId <= DailyRunId)
                throw new ArgumentException("Invalid monotonic run ID sequence");
        }
        public static PlayerPlanSnapshot Decode(AccountBindings bindings, AccountEnvelope envelope, string owner) =>
            new PlayerPlanSnapshot(owner, bindings.PlayerState(envelope, owner));
    }

    public sealed class DailyEntrySnapshot
    {
        public uint DayId { get; }
        public uint FollowingDayId { get; }
        private DailyEntrySnapshot(uint day, uint following) { DayId = day; FollowingDayId = following; }
        public static DailyEntrySnapshot Decode(AccountBindings bindings, AccountEnvelope protocol, AccountEnvelope arcade,
            AccountEnvelope current, AccountEnvelope following, AccountEnvelope vault, uint dayId, long now)
        {
            var result = Inspect(bindings, protocol, arcade, current, following, vault, dayId, now);
            if (result.Snapshot == null) throw new InvalidOperationException("Daily entry unavailable: " + result.Status);
            return result.Snapshot;
        }

        // The read-only UI assessment and submission use the same bounded account
        // preconditions. Malformed accounts throw; absence and closed windows are states.
        public static DailyEntryAssessment Inspect(AccountBindings bindings, AccountEnvelope protocol, AccountEnvelope arcade,
            AccountEnvelope current, AccountEnvelope following, AccountEnvelope vault, uint dayId, long now)
        {
            if (now < 0 || now / 86400 != dayId) throw new ArgumentOutOfRangeException(nameof(now));
            if (protocol == null) return new DailyEntryAssessment("missing-protocol");
            var publication = bindings.ProtocolConfig(protocol);
            if ((bool)publication["paused"]) return new DailyEntryAssessment("paused");
            if (arcade == null) return new DailyEntryAssessment("missing-config");
            var config = bindings.ArcadeConfig(arcade);
            uint suspension = (uint)config["suspended_until_day"];
            if (dayId < suspension) return new DailyEntryAssessment("suspended");
            if (current == null) return new DailyEntryAssessment("missing-daily");
            var daily = bindings.ArenaDaily(current, dayId);
            if (((JObject)daily["status"]).Properties().Single().Name != "Open") return new DailyEntryAssessment("closed");
            var window = NativeEngine.DailyWindow(dayId);
            if (now < (long)window.OpensAt) return new DailyEntryAssessment("not-open");
            if (now >= (long)window.FreezesAt) return new DailyEntryAssessment("frozen");
            uint followingDay = Math.Max(checked(dayId + 1), suspension);
            if (following == null) return new DailyEntryAssessment("missing-receiver");
            bindings.ArenaDaily(following, followingDay);
            if (vault == null) return new DailyEntryAssessment("missing-vault");
            bindings.CreditVault(vault);
            return new DailyEntryAssessment("ready", new DailyEntrySnapshot(dayId, followingDay));
        }
    }

    public sealed class DailyEntryAssessment
    {
        public string Status { get; }
        public DailyEntrySnapshot Snapshot { get; }
        internal DailyEntryAssessment(string status, DailyEntrySnapshot snapshot = null) { Status = status; Snapshot = snapshot; }
    }

    public sealed class RunPlanSnapshot
    {
        public string Owner { get; }
        public ulong RunId { get; }
        public string RentPayer { get; }
        public string DailyAddress { get; }
        internal RunSummary Summary { get; }
        public bool Terminal { get; }
        private RunPlanSnapshot(string owner, JObject fields, RunSummary summary)
        {
            Owner = owner; RunId = (ulong)fields["run_id"];
            RentPayer = (string)fields["rent_payer"]; DailyAddress = (string)fields["daily_challenge"]; Summary = summary;
            Terminal = (summary.Phase == (byte)CorePhase.Finished || summary.Phase == (byte)CorePhase.LevelComplete) &&
                (long)fields["finished_at"] > 0 && (uint)fields["pending_vrf_counter"] == 0;
        }
        public static RunPlanSnapshot Decode(AccountBindings bindings, AccountEnvelope envelope, string owner)
        {
            var fields = bindings.ActiveRun(envelope, owner);
            var native = new ActiveRunReconciler(bindings).Reconcile(envelope, owner);
            return new RunPlanSnapshot(owner, fields, NativeEngine.Summary(native));
        }
    }
}
