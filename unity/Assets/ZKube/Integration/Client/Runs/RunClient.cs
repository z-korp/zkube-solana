using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client.Runs
{
    public sealed class RunExecutionException : Exception
    {
        public ExecutionResult Result { get; }
        public RunExecutionException(ExecutionResult result) : base(result.Code ?? result.Outcome.ToString()) { Result = result; }
    }

    // Owns orchestration only: planner derives instructions, executor retains
    // uncertain sends, recovery validates placement, and Rust owns gameplay.
    public sealed class RunClient
    {
        private readonly ClientIdentity identity;
        private readonly SessionAccess sessions;
        private readonly AccountBindings accounts;
        private readonly ProtocolBindings protocol;
        private readonly ActiveRunReconciler native;
        private readonly TransactionPlanner planner;
        private readonly SolanaRpcTransport rpc;
        private readonly RunStateStore markers;
        private readonly RunRecovery recovery;
        private readonly TransactionJournal journal;
        private readonly TransactionExecutor executor;
        private readonly IExecutionReconciler reconciler;
        private readonly Func<long> now;
        private readonly Func<byte[]> clientSeed;
        private int operating;

        public RunClient(ClientIdentity identity, SessionAccess sessions, AccountBindings accounts,
            TransactionPlanner planner, SolanaRpcTransport rpc, RunStateStore markers, RunRecovery recovery,
            TransactionJournal journal, TransactionExecutor executor, IExecutionReconciler reconciler, Func<long> now, ProtocolBindings protocol, Func<byte[]> clientSeed = null)
        {
            this.identity = identity; this.sessions = sessions; this.accounts = accounts;
            native = new ActiveRunReconciler(accounts); this.planner = planner; this.rpc = rpc;
            this.protocol = protocol ?? throw new ArgumentNullException(nameof(protocol));
            this.markers = markers; this.recovery = recovery; this.journal = journal;
            this.executor = executor; this.reconciler = reconciler; this.now = now; this.clientSeed = clientSeed;
        }

        // Foreground inspection publishes current accepted state without consuming
        // a transaction receipt that its caller did not capture. Explicit recovery
        // retains the existing journal Resume behavior below.
        public Task<RunClientState> Inspect(CancellationToken cancellation = default) =>
            Operate(cancellation, (lease, token) => Observe(lease, token));

        public Task<RunClientState> Recover(RunPresentationBinding binding, CancellationToken cancellation = default, RunOperationReceipts receipts = null)
        {
            if (binding == null) throw new ArgumentNullException(nameof(binding));
            if (identity.Owner != binding.Owner) return Task.FromResult(new RunClientState("identity-changed"));
            return Operate(cancellation, async (lease, token) => {
                if (lease.Owner != binding.Owner) return new RunClientState("identity-changed");
                receipts?.Bind(binding.Address);
                // A consume receipt can outlive its run slot. Only a decoded
                // consumption of this bound run may reconcile after the slot
                // clears or is replaced; an older action cannot claim a successor.
                var pending = await journal.Load(lease.Owner).ConfigureAwait(false);
                bool consuming = PendingConsumes(pending, binding);
                var player = await rpc.ReadAccount(rpc.Base, planner.Player(lease.Owner), cancellation: token).ConfigureAwait(false);
                if (player.Envelope == null) return new RunClientState("run-unavailable");
                var fields = accounts.PlayerState(player.Envelope, lease.Owner);
                ulong runId = (ulong)fields["active_run_id"];
                if ((runId == 0 || planner.ActiveRun(lease.Owner, runId) != binding.Address) && !consuming) return new RunClientState("run-unavailable");
                if (pending != null)
                {
                    if (!TransactionSignatures.Describe(pending.Transaction).Accounts.Any(a => a.Address == binding.Address && a.Writable))
                        return new RunClientState("other-action-pending");
                    token.ThrowIfCancellationRequested();
                    var result = await executor.Resume(lease.Owner, reconciler, token, pending.Signature).ConfigureAwait(false);
                    receipts?.Record(result);
                    if (result.Outcome != ExecutionOutcome.ConfirmedSuccess && result.Outcome != ExecutionOutcome.ConfirmedFailure &&
                        result.Outcome != ExecutionOutcome.ExpiredReconciled) throw new RunExecutionException(result);
                }
                var observed = await Observe(lease, token).ConfigureAwait(false);
                if (consuming && observed.Marker?.ActiveRun != binding.Address) return new RunClientState("consumed");
                if (observed.Marker?.Owner != binding.Owner || observed.Marker?.ActiveRun != binding.Address || observed.Token == null)
                    return new RunClientState("run-unavailable");
                return observed;
            }, receipts);
        }

        private bool PendingConsumes(PendingTransaction pending, RunPresentationBinding binding)
        {
            if (pending == null || !pending.IsBase || pending.Owner != binding.Owner) return false;
            var transaction = TransactionSignatures.Describe(pending.Transaction);
            if (transaction.Instructions.Any(instruction => instruction.ProgramId != protocol.ProgramId &&
                instruction.ProgramId != PlanningConstants.ComputeBudgetProgram)) return false;
            var instructions = transaction.Instructions.Where(instruction => instruction.ProgramId == protocol.ProgramId)
                .Select(protocol.DecodeInstruction).ToArray();
            string consume = "consume_arena_run";
            return instructions.Length > 0 && instructions.Last().Name == consume &&
                instructions.Take(instructions.Length - 1).All(instruction => instruction.Name == "finish_run") &&
                instructions.All(instruction => instruction.Accounts.TryGetValue("active_run", out var active) && active == binding.Address &&
                    (!instruction.Accounts.TryGetValue("owner", out var owner) || owner == binding.Owner) &&
                    (!instruction.Accounts.TryGetValue("owner_authority", out var authority) || authority == binding.Owner));
        }

        public Task<RunClientState> StartDaily(CancellationToken cancellation = default, RunOperationReceipts receipts = null) =>
            Operate(cancellation, async (lease, token) => {
                await RequireNoPending(lease, token).ConfigureAwait(false);
                var prior = await Observe(lease, token).ConfigureAwait(false);
                if (prior.Marker != null) throw new InvalidOperationException("Recover the run already occupying the Arcade slot");
                var batch = await rpc.ReadAccounts(rpc.Base, new[] { planner.Player(lease.Owner), planner.ProtocolAddress }, cancellation: token).ConfigureAwait(false);
                var player = PlayerPlanSnapshot.Decode(accounts, batch.Accounts[0].Envelope, lease.Owner);
                receipts?.Bind(planner.ActiveRun(lease.Owner, player.NextRunId));
                using var session = await sessions.Load(lease).ConfigureAwait(false);
                var occupied = await rpc.ReadAccount(rpc.Base, planner.ActiveRun(lease.Owner, player.NextRunId), cancellation: token).ConfigureAwait(false);
                TransactionPlan prepared;
                    long observedNow = now(); uint day = checked((uint)(observedNow / 86400));
                    uint following = Math.Max(checked(day + 1), (uint)accounts.ProtocolConfig(batch.Accounts[1].Envelope)["suspended_until_day"]);
                    var daily = await rpc.ReadAccounts(rpc.Base, new[] { planner.Daily(day), planner.Daily(following), planner.CreditVaultAddress }, cancellation: token).ConfigureAwait(false);
                    var entry = DailyEntrySnapshot.Decode(accounts, batch.Accounts[1].Envelope,
                        daily.Accounts[0].Envelope, daily.Accounts[1].Envelope, daily.Accounts[2].Envelope, day, observedNow);
                    var claims = await EntryClaims(lease.Owner, day, observedNow, token).ConfigureAwait(false);
                    prepared = planner.PrepareDaily(session.Actor, player, entry, claims, observedNow, occupied.Envelope);
                var validator = await rpc.ClosestValidator(token).ConfigureAwait(false);
                var plan = planner.PrepareAndDelegate(prepared, session.Actor, validator.Identity);
                // Persist the locator before any signing/send. A failed or
                // expired preparation clears it only through fresh absence proof.
                await markers.Save(new RunMarker(lease.Owner, player.NextRunId,
                    planner.ActiveRun(lease.Owner, player.NextRunId))).ConfigureAwait(false);
                var result = await executor.Execute(plan, "start-daily", new[] { session.Signer }, reconciler, token).ConfigureAwait(false);
                receipts?.Record(result);
                if (result.Outcome != ExecutionOutcome.Pending) await Observe(lease, token).ConfigureAwait(false);
                RequireSettled(result);
                return await WaitFor(lease, planner.ActiveRun(lease.Owner, player.NextRunId), token, state => state.Phase == "delegated" || state.Phase == "settleable").ConfigureAwait(false);
            }, receipts);

        public Task<RunClientState> ResolveVrf(RunPresentationBinding binding, CancellationToken cancellation = default, RunOperationReceipts receipts = null) =>
            Operate(cancellation, async (lease, token) => {
                // A board remains bound to its original owner and PDA across
                // asynchronous identity changes and slot replacement.
                binding?.RequireIdentity(lease.Owner, binding.Address);
                if (binding != null) receipts?.Bind(binding.Address);
                await RequireNoPending(lease, token).ConfigureAwait(false);
                var current = await Observe(lease, token).ConfigureAwait(false);
                binding?.RequireIdentity(current.Marker?.Owner, current.Marker?.ActiveRun);
                if (current.Marker == null) return current;
                string address = current.Marker.ActiveRun;
                receipts?.Bind(address);
                if (current.Account == null) current = await WaitFor(lease, address, token, state => state.Account != null).ConfigureAwait(false);
                if (current.Marker == null) return current;
                binding?.Accept(current);
                var before = NativeEngine.Summary(current.Token);
                uint pendingBefore = (uint)accounts.ActiveRun(current.Account, lease.Owner)["pending_vrf_counter"];
                if (RunObservation.IsTerminal(before) || (before.Phase == (byte)CorePhase.Playing && pendingBefore == 0)) return current;
                // An already requested VRF callback is public recovery. It must
                // remain observable after session expiry or local key loss.
                using var session = current.Phase == "base" || pendingBefore == 0
                    ? await sessions.Load(lease).ConfigureAwait(false) : null;
                if (current.Phase == "base")
                {
                    var validator = await rpc.ClosestValidator(token).ConfigureAwait(false);
                    await Execute(planner.Delegate(session.Actor, current.Marker.RunId, validator.Identity), "delegate-daily", session, token, receipts).ConfigureAwait(false);
                    current = await WaitFor(lease, address, token, state => state.Phase == "delegated" || state.Phase == "settleable").ConfigureAwait(false);
                }
                if (current.Marker == null) return current;
                binding?.Accept(current);
                if (RunObservation.IsTerminal(NativeEngine.Summary(current.Token))) return current;
                RequireEr(current);
                var fields = accounts.ActiveRun(current.Account, lease.Owner);
                uint counter = (uint)fields["vrf_request_counter"], pending = (uint)fields["pending_vrf_counter"];
                var summary = NativeEngine.Summary(current.Token);
                if (summary.Phase == (byte)CorePhase.Playing && pending == 0) return current;
                if (pending == 0)
                {
                    await Execute(planner.RunAction(session.Actor, Snapshot(current), "vrf", Seed()), "vrf-daily", session, token, receipts).ConfigureAwait(false);
                    counter = checked(counter + 1);
                }
                else counter = pending;
                return await WaitFor(lease, address, token, state => {
                    if (state.Account == null) return false;
                    var accepted = accounts.ActiveRun(state.Account, lease.Owner);
                    return RunObservation.IsTerminal(NativeEngine.Summary(state.Token)) ||
                        RunObservation.HasResolvedVrf((uint)accepted["vrf_request_counter"], (uint)accepted["pending_vrf_counter"], counter);
                }).ConfigureAwait(false);
            }, receipts);

        public Task<RunClientState> Apply(CoreRunToken expected, RunPresentationBinding binding, RunClientAction action,
            byte row = 0, byte start = 0, byte destination = 0, CancellationToken cancellation = default, RunOperationReceipts receipts = null) =>
            Operate(cancellation, async (lease, token) => {
                if (binding != null) receipts?.Bind(binding.Address);
                await RequireNoPending(lease, token).ConfigureAwait(false);
                var current = await Observe(lease, token).ConfigureAwait(false);
                RequireEr(current);
                // Replay/action/grid equality prevents a stale board intention
                // from being silently applied to a different accepted position.
                if (expected == null || !current.Token.State.SequenceEqual(expected.State))
                    throw new InvalidOperationException("The run changed; recover the accepted board before acting");
                if (binding == null || !binding.Accept(current).Config.SequenceEqual(expected.Config))
                    throw new InvalidOperationException("The board rules differ from the run");
                receipts?.Bind(current.Marker.ActiveRun);
                NativeCandidate(expected, action, row, start, destination);
                using var session = await sessions.Load(lease).ConfigureAwait(false);
                string instruction = action == RunClientAction.Move ? "move" : action == RunClientAction.Guardian ? "bonus" : action == RunClientAction.Reroll ? "reroll" : "finish";
                await Execute(planner.RunAction(session.Actor, Snapshot(current), instruction,
                    action == RunClientAction.Abandon ? null : Seed(), row, start, destination, start), instruction + "-daily", session, token, receipts).ConfigureAwait(false);
                uint expectedAction = checked(NativeEngine.Summary(expected).ActionCounter + (action == RunClientAction.Abandon ? 0u : 1u));
                return await WaitFor(lease, current.Marker.ActiveRun, token, state => state.Account != null &&
                    (action == RunClientAction.Abandon ? RunObservation.IsTerminal(NativeEngine.Summary(state.Token)) :
                        RunObservation.HasAcceptedAction(NativeEngine.Summary(state.Token), expectedAction))).ConfigureAwait(false);
            }, receipts);

        // A terminal screen owns one run, not whichever run later occupies its slot.
        public Task<RunClientState> FinishAndSettle(RunPresentationBinding binding, CancellationToken cancellation = default, RunOperationReceipts receipts = null)
        {
            if (binding == null) throw new ArgumentNullException(nameof(binding));
            if (identity.Owner != binding.Owner) return Task.FromResult(new RunClientState("identity-changed"));
            return Settle(binding, cancellation, receipts);
        }

        private Task<RunClientState> Settle(RunPresentationBinding binding, CancellationToken cancellation, RunOperationReceipts receipts) =>
            Operate(cancellation, async (lease, token) => {
                if (binding != null && lease.Owner != binding.Owner) return new RunClientState("identity-changed");
                if (binding != null) receipts?.Bind(binding.Address);
                await RequireNoPending(lease, token).ConfigureAwait(false);
                var current = await Observe(lease, token).ConfigureAwait(false);
                if (binding != null)
                {
                    if (current.Marker?.Owner != binding.Owner || current.Marker?.ActiveRun != binding.Address || current.Token == null)
                        return new RunClientState("run-unavailable");
                    binding.Accept(current);
                }
                if (current.Marker == null) return current;
                string address = current.Marker.ActiveRun;
                receipts?.Bind(address);
                if (current.Account == null) throw new InvalidOperationException("Wait for the current run to recover before settling");
                if (current.Phase == "delegated")
                {
                    using var session = await sessions.Load(lease).ConfigureAwait(false);
                    if (!Snapshot(current).Terminal)
                    {
                        await Execute(planner.RunAction(session.Actor, Snapshot(current), "finish"), "finish-daily", session, token, receipts).ConfigureAwait(false);
                        current = await WaitFor(lease, address, token, state => state.Account != null && Snapshot(state).Terminal).ConfigureAwait(false);
                    }
                    if (current.Marker == null) return current;
                    if (current.Phase == "delegated")
                    {
                        await Execute(planner.Commit(session.Actor, Snapshot(current)), "commit-daily", session, token, receipts).ConfigureAwait(false);
                        current = await WaitFor(lease, address, token, state => state.Phase == "settleable").ConfigureAwait(false);
                    }
                }
                if (current.Marker == null) return current;
                if (current.Phase != "base" && current.Phase != "settleable") throw new InvalidOperationException("Wait for terminal Base copy-back");
                binding?.Accept(current);
                // Re-read after copy-back: a session may expire, be revoked or lose
                // its allowance while ER settlement is pending. Normal settlement
                // uses the funded device payer, matching the TS finalization plan.
                // Known unavailability retains owner recovery; malformed reads,
                // fee failures and uncertain sends never switch signers implicitly.
                AuthorizedDeviceSession payer = null;
                try { payer = await sessions.Load(lease).ConfigureAwait(false); }
                catch (SessionUnavailableException) { token.ThrowIfCancellationRequested(); }
                using (payer)
                    await Execute(planner.Consume(payer?.Actor ?? PlannerActor.Wallet(lease.Owner), Snapshot(current), current.Phase == "base"),
                        "consume-daily", payer, token, receipts).ConfigureAwait(false);
                return ForRun(await Observe(lease, token).ConfigureAwait(false), address);
            }, receipts);

        public static RunTransition NativeCandidate(CoreRunToken token, RunClientAction action, byte row, byte start, byte destination)
        {
            var summary = NativeEngine.Summary(token);
            switch (action)
            {
                case RunClientAction.Move: return NativeEngine.PlayMove(token, summary.ActionCounter, summary.Moves, row, start, destination);
                case RunClientAction.Guardian: return NativeEngine.ApplyBonus(token, summary.ActionCounter, row, start);
                case RunClientAction.Reroll: return NativeEngine.RequestReroll(token, summary.ActionCounter);
                case RunClientAction.Abandon: return NativeEngine.Finish(token, 3);
                default: throw new ArgumentOutOfRangeException(nameof(action));
            }
        }

        private async Task<RunClientState> Operate(CancellationToken cancellation,
            Func<IdentityLease, CancellationToken, Task<RunClientState>> operation, RunOperationReceipts receipts = null)
        {
            if (Interlocked.CompareExchange(ref operating, 1, 0) != 0) throw new InvalidOperationException("A run operation is already pending");
            try
            {
                var lease = identity.Lease();
                receipts?.Begin(lease.Owner);
                using var linked = CancellationTokenSource.CreateLinkedTokenSource(lease.Cancellation, cancellation);
                var result = await operation(lease, linked.Token).ConfigureAwait(false);
                linked.Token.ThrowIfCancellationRequested();
                if (!identity.IsCurrent(lease)) throw new OperationCanceledException("Player identity changed");
                return result;
            }
            finally { Volatile.Write(ref operating, 0); }
        }
        private async Task RequireNoPending(IdentityLease lease, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            if (await journal.Load(lease.Owner).ConfigureAwait(false) != null)
                throw new InvalidOperationException("Recover the pending transaction before starting another intention");
        }
        private async Task Execute(TransactionPlan plan, string intent, AuthorizedDeviceSession session, CancellationToken cancellation, RunOperationReceipts receipts)
        {
            // Execute rejects a journal found under its own guard. Recovery is
            // explicit, so a prior success cannot satisfy this new intention.
            var result = await executor.Execute(plan, intent, session == null ? Array.Empty<DeviceSigner>() : new[] { session.Signer }, reconciler, cancellation).ConfigureAwait(false);
            receipts?.Record(result);
            if (result.Intent != intent) throw new InvalidOperationException("A prior transaction was recovered; repeat this intention from fresh state");
            RequireSettled(result);
        }
        private static void RequireSettled(ExecutionResult result)
        {
            if (result.Outcome != ExecutionOutcome.ConfirmedSuccess)
                throw new RunExecutionException(result);
        }
        private RunPlanSnapshot Snapshot(RunClientState state) => RunPlanSnapshot.Decode(accounts, state.Account, state.Marker.Owner);
        private static void RequireEr(RunClientState state)
        { if (state.Phase != "delegated" || state.Account == null) throw new InvalidOperationException("Wait for the run's resolved ER state"); }
        private byte[] Seed()
        {
            if (clientSeed != null)
            {
                var supplied = clientSeed();
                if (supplied == null || supplied.Length != 32)
                    throw new InvalidOperationException("A run client seed must contain 32 bytes");
                return (byte[])supplied.Clone();
            }
            var bytes = new byte[32]; using var rng = RandomNumberGenerator.Create(); rng.GetBytes(bytes); return bytes;
        }

        private async Task<RunClientState> Observe(IdentityLease lease, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            var observed = await markers.ResolveOrDiscover(lease.Owner, recovery, rpc, now()).ConfigureAwait(false);
            cancellation.ThrowIfCancellationRequested();
            if (observed.Phase == "missing" && await journal.Load(lease.Owner).ConfigureAwait(false) == null)
            {
                var marker = observed.Marker;
                var before = await rpc.Placement(marker.ActiveRun).ConfigureAwait(false);
                if (!before.IsDelegated)
                {
                    var proof = await rpc.ReadAccounts(rpc.Base, new[] { planner.Player(lease.Owner), marker.ActiveRun }, cancellation: cancellation).ConfigureAwait(false);
                    var after = await rpc.Placement(marker.ActiveRun).ConfigureAwait(false);
                    var player = accounts.PlayerState(proof.Accounts[0].Envelope, lease.Owner);
                    if (!after.IsDelegated && proof.Accounts[1].Envelope == null &&
                        (ulong)player["active_run_id"] != marker.RunId)
                    {
                        await markers.ClearAfterConsumption(marker, proof.Accounts[0].Envelope, null, after).ConfigureAwait(false);
                        observed = await markers.ResolveOrDiscover(lease.Owner, recovery, rpc, now()).ConfigureAwait(false);
                    }
                }
            }
            return new RunClientState(observed, native);
        }
        private async Task<RunClientState> WaitFor(IdentityLease lease, string address, CancellationToken cancellation, Func<RunClientState, bool> ready)
        {
            var elapsed = Stopwatch.StartNew();
            do
            {
                var state = await Observe(lease, cancellation).ConfigureAwait(false);
                // A newer run can occupy the Arcade slot after cross-device consume.
                // Its counters never fulfill an observation of the old action.
                var anchored = ForRun(state, address);
                if (anchored != state) return anchored;
                if (ready(state)) return state;
                await Task.Delay(250, cancellation).ConfigureAwait(false);
            } while (elapsed.Elapsed < TimeSpan.FromSeconds(20));
            throw new TimeoutException("Run observation is still pending; recover before continuing");
        }
        private static RunClientState ForRun(RunClientState state, string address) =>
            state.Marker?.ActiveRun == address ? state : new RunClientState("consumed");
        private async Task<IReadOnlyList<ValidatedBoardReward>> EntryClaims(string owner, uint day, long observedNow, CancellationToken cancellation)
        {
            uint first = day > PlanningConstants.ClaimLookbackDays ? day - PlanningConstants.ClaimLookbackDays : 0;
            var wanted = new List<(uint Day, string Kind)>();
            for (uint candidate = first; candidate < day; candidate++)
                foreach (string kind in new[] { "score", "theme" }) wanted.Add((candidate, kind));
            var boards = new List<BoardObservation>();
            for (int offset = 0; offset < wanted.Count; offset += SolanaRpcTransport.MaximumBatchAccounts)
            {
                var group = wanted.Skip(offset).Take(SolanaRpcTransport.MaximumBatchAccounts).ToArray();
                try
                {
                    var batch = await rpc.ReadAccounts(rpc.Base, group.Select(item => planner.Board(item.Day, item.Kind)).ToArray(), cancellation: cancellation).ConfigureAwait(false);
                    for (int index = 0; index < group.Length; index++) boards.Add(new BoardObservation(group[index].Day, group[index].Kind, batch.Accounts[index].Envelope));
                }
                catch (OperationCanceledException) { throw; }
                catch (Exception) { cancellation.ThrowIfCancellationRequested(); /* Optional attachments never block entry. */ }
            }
            return TransactionPlanner.ReadEntryClaims(accounts, boards, owner, day, observedNow);
        }

    }
}
