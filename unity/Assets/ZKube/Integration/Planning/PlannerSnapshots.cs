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
        // The board's Daily, which says whether the board is sealed and since when.
        public AccountEnvelope Daily { get; }
        public BoardObservation(uint dayId, string kind, AccountEnvelope account, AccountEnvelope daily)
        {
            if (kind != "score" && kind != "theme") throw new ArgumentException("Invalid board kind");
            DayId = dayId; Kind = kind; Account = account; Daily = daily;
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
        public long RunDeadlineAt { get; }
        // A run its player never settled stops being able to score at its
        // recovery deadline; the program then retires it at the next entry.
        public bool RunRetired(long now) => DailyRunId != 0 &&
            now >= checked(RunDeadlineAt + (long)ZKube.Core.Generated.Protocol.RunRecoverySeconds);
        public bool SlotFree(long now) => DailyRunId == 0 || RunRetired(now);
        private PlayerPlanSnapshot(string owner, JObject fields)
        {
            Owner = owner; NextRunId = (ulong)fields["next_run_id"];
            DailyRunId = (ulong)fields["active_run_id"]; Kredits = (ulong)fields["kredit_balance"];
            RunDeadlineAt = (long)fields["active_run_deadline_at"];
            if (NextRunId == 0 || NextRunId <= DailyRunId)
                throw new ArgumentException("Invalid monotonic run ID sequence");
        }
        public static PlayerPlanSnapshot Decode(AccountBindings bindings, AccountEnvelope envelope, string owner) =>
            new PlayerPlanSnapshot(owner, bindings.PlayerState(envelope, owner));
    }

    public sealed class DailyEntrySnapshot
    {
        public uint DayId { get; }
        // Today's Daily does not exist yet: this entry prepares it first.
        public bool PrepareToday { get; }
        private DailyEntrySnapshot(uint day, bool prepare) { DayId = day; PrepareToday = prepare; }
        public static DailyEntrySnapshot Decode(AccountBindings bindings, AccountEnvelope protocol,
            AccountEnvelope current, AccountEnvelope vault, uint dayId, long now)
        {
            var result = Inspect(bindings, protocol, current, vault, dayId, now);
            if (result.Snapshot == null) throw new InvalidOperationException("Daily entry unavailable: " + result.Status);
            return result.Snapshot;
        }

        // The read-only UI assessment and submission use the same bounded account
        // preconditions. Malformed accounts throw; absence and closed windows are states.
        // A Daily is open by the clock: one that nobody has entered yet simply
        // does not exist, and the first entry prepares it.
        public static DailyEntryAssessment Inspect(AccountBindings bindings, AccountEnvelope protocol,
            AccountEnvelope current, AccountEnvelope vault, uint dayId, long now)
        {
            // The day is the core's: the caller's day must be the one this instant belongs to.
            var window = NativeEngine.Daily(dayId);
            if (now < (long)window.OpensAt || NativeEngine.DayAt(now) != dayId) throw new ArgumentOutOfRangeException(nameof(now));
            if (protocol == null) return new DailyEntryAssessment("missing-protocol");
            var config = bindings.ProtocolConfig(protocol);
            if ((uint)config["launch_day_id"] == 0) return new DailyEntryAssessment("missing-daily");
            if ((bool)config["paused"]) return new DailyEntryAssessment("paused");
            if (dayId < (uint)config["suspended_until_day"]) return new DailyEntryAssessment("suspended");
            if (current != null && DailyCadence.Finalized(bindings.ArenaDaily(current, dayId))) return new DailyEntryAssessment("closed");
            if (now >= (long)window.FreezesAt) return new DailyEntryAssessment("frozen");
            if (vault == null) return new DailyEntryAssessment("missing-vault");
            bindings.CreditVault(vault);
            return new DailyEntryAssessment("ready", new DailyEntrySnapshot(dayId, current == null));
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
        public long DeadlineAt { get; }
        // How an unfinished run is ended: its player abandons it before its
        // cutoff; from the cutoff on, anyone ends it by the Deadline rule, which
        // scores its last accepted state.
        public string FinishAction(long now) => now >= DeadlineAt ? "deadline" : "finish";
        private RunPlanSnapshot(string owner, JObject fields, RunSummary summary)
        {
            Owner = owner; RunId = (ulong)fields["run_id"]; DeadlineAt = (long)fields["deadline_at"];
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
