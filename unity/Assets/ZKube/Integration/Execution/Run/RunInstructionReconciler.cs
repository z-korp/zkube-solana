using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Execution
{
    // Reconciles run effects from the signed instruction and fresh chain state.
    // It never reapplies gameplay or infers a VRF output locally. The application
    // persists the observation before the executor may clear its send journal.
    public sealed class RunInstructionReconciler : IExecutionReconciler
    {
        private readonly ProtocolBindings protocol;
        private readonly AccountBindings accounts;
        private readonly ActiveRunReconciler native;
        private readonly TransactionPlanner addresses;
        private readonly SolanaRpcTransport rpc;
        private readonly Func<RunSemanticObservation, Task> accept;

        public RunInstructionReconciler(ProtocolBindings protocol, AccountBindings accounts,
            TransactionPlanner addresses, SolanaRpcTransport rpc, Func<RunSemanticObservation, Task> accept)
        {
            this.protocol = protocol; this.accounts = accounts; this.addresses = addresses;
            this.rpc = rpc; this.accept = accept; native = new ActiveRunReconciler(accounts);
        }

        public static bool Supports(string name) => name == "enter_arena" ||
            name == "delegate_active_run" || name == "request_vrf" || name == "play_move" || name == "apply_bonus" ||
            name == "request_reroll" || name == "finish_run" || name == "commit_run" ||
            name == "consume_arena_run";

        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            if (evidence.Transaction.Instructions.Any(i => i.ProgramId != protocol.ProgramId &&
                i.ProgramId != PlanningConstants.ComputeBudgetProgram)) return false;
            var instructions = evidence.Transaction.Instructions.Where(i => i.ProgramId == protocol.ProgramId)
                .Select(protocol.DecodeInstruction).ToArray();
            int claims = instructions.TakeWhile(i => i.Name == "claim_daily_prize").Count();
            if (claims > 0)
            {
                if (claims > PlanningConstants.MaxAutoClaims || claims == instructions.Length ||
                    instructions[claims].Name != "enter_arena" || !evidence.Pending.IsBase ||
                    instructions.Take(claims).Any(i => i.Accounts["owner_authority"] != evidence.Pending.Owner ||
                        i.Accounts["player_state"] != addresses.Player(evidence.Pending.Owner))) return false;
                instructions = instructions.Skip(claims).ToArray();
            }
            if (instructions.Length == 0 || instructions.Any(i => !Supports(i.Name))) return false;
            if (!evidence.Expired && evidence.Status.Confirmation != RpcConfirmation.Confirmed &&
                evidence.Status.Confirmation != RpcConfirmation.Finalized) return false;
            bool succeeded = !evidence.Expired && evidence.Status.ErrorJson == null;
            string owner = evidence.Pending.Owner;
            string address = null;
            foreach (var instruction in instructions)
            {
                string candidate = instruction.Accounts.TryGetValue("active_run", out var active) ? active : instruction.Accounts["pda"];
                if (address != null && address != candidate) throw new FormatException("Transaction spans multiple run addresses");
                address = candidate;
                foreach (string role in new[] { "owner", "owner_authority" })
                    if (instruction.Accounts.TryGetValue(role, out var authority) && authority != owner)
                        throw new FormatException("Run transaction owner does not match the journal");
            }
            var observation = Fresh(evidence, address);
            var consume = instructions.LastOrDefault(i => i.Name == "consume_arena_run");
            if (consume != null)
            {
                if (!evidence.Pending.IsBase) throw new FormatException("Consumption must reconcile on Base");
                var playerInfo = Fresh(evidence, consume.Accounts["player_state"]);
                if (playerInfo.Envelope == null) return false;
                var player = accounts.PlayerState(playerInfo.Envelope, owner);
                ulong current = (ulong)player["active_run_id"];
                if (observation.Envelope == null)
                {
                    if ((current != 0 && addresses.ActiveRun(owner, current) == address) || (await rpc.Placement(address)).IsDelegated) return false;
                    await accept(new RunSemanticObservation(owner, address, null, evidence.Pending.Endpoint,
                        observation.Slot, RunSemanticPhase.Consumed, null, false, playerInfo.Envelope));
                    return true;
                }
                if (succeeded) return false;
                return await AcceptRun(observation, owner, address, evidence.Pending.Endpoint, instructions, false);
            }
            var prepare = instructions.FirstOrDefault(i => i.Name == "enter_arena");
            ulong? expectedRun = prepare == null ? (ulong?)null : (ulong)prepare.Arguments["run_id"];
            if (prepare != null)
            {
                if (!evidence.Pending.IsBase || addresses.ActiveRun(owner, expectedRun.Value) != address)
                    throw new FormatException("Preparation does not match its Base run PDA");
                var playerInfo = Fresh(evidence, prepare.Accounts["player_state"]);
                if (playerInfo.Envelope == null) return false;
                var player = accounts.PlayerState(playerInfo.Envelope, owner);
                ulong slot = (ulong)player["active_run_id"];
                if (succeeded && (ulong)player["next_run_id"] <= expectedRun.Value) return false;
                if (succeeded && slot != expectedRun)
                    return await ConsumedAfterProgress(evidence, address, expectedRun, cancellation);
                if (!succeeded && observation.Envelope == null)
                {
                    if (slot == expectedRun || (await rpc.Placement(address)).IsDelegated) return false;
                    await accept(new RunSemanticObservation(owner, address, expectedRun, evidence.Pending.Endpoint,
                        observation.Slot, RunSemanticPhase.Absent, null, false));
                    return true;
                }
            }
            bool commit = instructions.Any(i => i.Name == "commit_run");
            bool delegated = instructions.Any(i => i.Name == "delegate_active_run");
            if ((commit && evidence.Pending.IsBase) || (delegated && !evidence.Pending.IsBase))
                throw new FormatException("Run delegation or commit uses the wrong ledger");
            string endpoint = evidence.Pending.Endpoint;
            if (commit || delegated || !evidence.Pending.IsBase)
            {
                var placement = await rpc.Placement(address);
                cancellation.ThrowIfCancellationRequested();
                if (!placement.IsDelegated && !evidence.Pending.IsBase)
                {
                    // This context belongs to Base. An ER status slot must never
                    // be sent as Base minContextSlot: the ledgers are independent.
                    observation = await rpc.ReadAccount(rpc.Base, address, cancellation: cancellation);
                    endpoint = rpc.BaseEndpoint;
                    if ((await rpc.Placement(address)).IsDelegated) return false;
                    if (observation.Envelope == null)
                        return succeeded && await ConsumedAfterProgress(evidence, address, expectedRun, cancellation);
                    if (observation.Envelope.Owner != protocol.ProgramId ||
                        !RunObservation.IsTerminal(NativeEngine.Summary(native.Reconcile(observation.Envelope, owner)))) return false;
                }
                else if (placement.IsDelegated)
                {
                    if (commit && succeeded) return false;
                    if (placement.Endpoint == null) return false;
                    if (evidence.Pending.IsBase || placement.Endpoint != endpoint)
                    {
                        var batch = await rpc.HistoricalAccounts(placement.Endpoint, false, new[] { address }, cancellation: cancellation);
                        var after = await rpc.Placement(address);
                        if (!after.IsDelegated || after.Endpoint != placement.Endpoint) return false;
                        var current = batch.Accounts[0];
                        if (current.Envelope == null || current.Envelope.Owner != protocol.ProgramId) return false;
                        // Placement may move between ledgers. Compare validated
                        // run progress, never their unrelated context slots.
                        if (!evidence.Pending.IsBase && !Progresses(observation.Envelope, current.Envelope, owner)) return false;
                        observation = current; endpoint = placement.Endpoint;
                    }
                }
            }
            if (observation.Envelope == null)
                return succeeded && await ConsumedAfterProgress(evidence, address, expectedRun, cancellation);
            // A delegated Base envelope is deliberately not decoded as ActiveRun.
            if (observation.Envelope.Owner != protocol.ProgramId) return false;
            return await AcceptRun(observation, owner, address, endpoint, instructions, succeeded, expectedRun);
        }

        private async Task<bool> AcceptRun(RpcAccount observation, string owner, string address, string endpoint,
            DecodedProtocolInstruction[] instructions, bool succeeded, ulong? expectedRun = null)
        {
            var account = accounts.ActiveRun(observation.Envelope, owner);
            var token = native.Reconcile(observation.Envelope, owner);
            var summary = NativeEngine.Summary(token);
            ulong runId = (ulong)account["run_id"];
            if (address != addresses.ActiveRun(owner, runId) || (expectedRun.HasValue && runId != expectedRun.Value)) throw new FormatException("Observed run does not match signed intent");
            bool acceptedAction = false;
            if (succeeded)
            {
                foreach (var instruction in instructions)
                {
                    if (instruction.Arguments.TryGetValue("expected_action", out var expected))
                    {
                        if (!RunObservation.HasAcceptedAction(summary, checked((uint)expected + 1))) return false;
                        acceptedAction = true;
                    }
                    if (instruction.Name == "request_vrf" && (uint)account["vrf_request_counter"] == 0) return false;
                    if ((instruction.Name == "finish_run" || instruction.Name == "commit_run") && !RunObservation.IsTerminal(summary)) return false;
                }
            }
            var lifecycle = Variant(account["lifecycle"]);
            var phase = RunObservation.IsTerminal(summary) ? RunSemanticPhase.Terminal : lifecycle == "Prepared" || lifecycle == "Delegated"
                ? RunSemanticPhase.Prepared : RunObservation.IsAcceptedActionReady(summary, (uint)account["pending_vrf_counter"], 0)
                ? RunSemanticPhase.Ready : RunSemanticPhase.AwaitingRow;
            await accept(new RunSemanticObservation(owner, address, runId, endpoint, observation.Slot, phase, token, acceptedAction));
            return true;
        }

        private static RpcAccount Fresh(ExecutionReconciliation evidence, string address)
        {
            var matches = evidence.Accounts.Where(a => a.Address == address).ToArray();
            if (matches.Length != 1 || matches[0].Observation == null || matches[0].Observation.Slot < evidence.MinimumSlot)
                throw new FormatException("Missing fresh run account observation");
            return matches[0].Observation;
        }
        private bool Progresses(AccountEnvelope before, AccountEnvelope after, string owner)
        {
            if (before == null) return false;
            var previousAccount = accounts.ActiveRun(before, owner); var currentAccount = accounts.ActiveRun(after, owner);
            var previous = NativeEngine.Summary(native.Reconcile(before, owner));
            var current = NativeEngine.Summary(native.Reconcile(after, owner));
            return (ulong)previousAccount["run_id"] == (ulong)currentAccount["run_id"] &&
                current.ActionCounter >= previous.ActionCounter && current.LastVrfCounter >= previous.LastVrfCounter &&
                (uint)currentAccount["vrf_request_counter"] >= (uint)previousAccount["vrf_request_counter"] &&
                (!RunObservation.IsTerminal(previous) || RunObservation.IsTerminal(current));
        }
        private async Task<bool> ConsumedAfterProgress(ExecutionReconciliation evidence, string address,
            ulong? runId, CancellationToken cancellation)
        {
            if ((await rpc.Placement(address)).IsDelegated) return false;
            var batch = await rpc.ReadAccounts(rpc.Base, new[] { address, addresses.Player(evidence.Pending.Owner) },
                minContextSlot: evidence.Pending.IsBase ? evidence.MinimumSlot : (ulong?)null, cancellation: cancellation);
            if ((await rpc.Placement(address)).IsDelegated || batch.Accounts[0].Envelope != null || batch.Accounts[1].Envelope == null) return false;
            var player = accounts.PlayerState(batch.Accounts[1].Envelope, evidence.Pending.Owner);
            foreach (string field in new[] { "active_run_id" })
            {
                ulong current = (ulong)player[field];
                if (current != 0 && addresses.ActiveRun(evidence.Pending.Owner, current) == address) return false;
            }
            if (runId.HasValue && (ulong)player["next_run_id"] <= runId.Value) return false;
            // An action/commit carries no run ID. If already consumed,
            // only the signed address survives. The sink clears a matching
            // stored address; it must not invent a run result or clear a new run.
            await accept(new RunSemanticObservation(evidence.Pending.Owner, address, runId,
                rpc.BaseEndpoint, batch.Slot, RunSemanticPhase.Consumed, null, false, batch.Accounts[1].Envelope));
            return true;
        }
        private static string Variant(JToken value) => ((JObject)value).Properties().Single().Name;
    }
}
