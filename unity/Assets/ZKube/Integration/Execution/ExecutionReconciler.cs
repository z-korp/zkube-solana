using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Execution
{
    public sealed partial class ExecutionReconciler : IExecutionReconciler
    {
        private readonly ProtocolBindings protocol;
        private readonly AccountBindings accounts;
        private readonly SessionTokenBindings tokens;
        private readonly SessionRecordStore records;
        private readonly TransactionPlanner planner;
        private readonly SolanaRpcTransport rpc;
        private readonly ActiveRunReconciler native;
        private readonly Func<string, Task> invalidateOwner;
        private readonly Func<RunRecordChange, Task> acceptRun;
        public ExecutionReconciler(ProtocolBindings protocol, AccountBindings accounts, SessionTokenBindings tokens,
            SessionRecordStore records, TransactionPlanner planner, SolanaRpcTransport rpc,
            Func<string, Task> invalidateOwner, Func<RunRecordChange, Task> acceptRun)
        {
            this.protocol = protocol; this.accounts = accounts; this.tokens = tokens; this.records = records;
            this.planner = planner; this.rpc = rpc; this.invalidateOwner = invalidateOwner; this.acceptRun = acceptRun;
            native = new ActiveRunReconciler(accounts);
        }
        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            if (!await ReconcileInstruction(evidence, cancellation).ConfigureAwait(false)) return false;
            await invalidateOwner(evidence.Pending.Owner).ConfigureAwait(false);
            return true;
        }
        private Task<bool> ReconcileInstruction(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
            if (!evidence.Expired && evidence.Status.Confirmation != RpcConfirmation.Confirmed &&
                evidence.Status.Confirmation != RpcConfirmation.Finalized) return Task.FromResult(false);
            var calls = evidence.Transaction.Instructions.Where(i => i.ProgramId != PlanningConstants.ComputeBudgetProgram).ToArray();
            if (calls.Length == 0) return Task.FromResult(false);
            if (calls[0].ProgramId == tokens.ProgramId || calls[0].ProgramId == PlanningConstants.SystemProgram)
                return calls.Length > 1 && calls[calls.Length - 1].ProgramId == tokens.ProgramId
                    ? ReconcileSession(evidence, calls) : ReconcileMaintenance(evidence, calls);
            if (calls[0].ProgramId != protocol.ProgramId) return Task.FromResult(false);
            var first = protocol.DecodeInstruction(calls[0]);
            if (first.Name == "initialize_player") return ReconcileSession(evidence, calls);
            if (calls.Any(call => call.ProgramId != protocol.ProgramId)) return Task.FromResult(false);
            switch (first.Name)
            {
                case "purchase_kredits":
                case "set_featured_emblem":
                    return calls.Length == 1 ? ReconcileEconomy(evidence, first, cancellation) : Task.FromResult(false);
                case "claim_daily_prize":
                    if (calls.Length == 1) return ReconcileEconomy(evidence, first, cancellation);
                    break;
                default:
                    if (!SupportsRun(first.Name)) return Task.FromResult(false);
                    break;
            }
            var decoded = new[] { first }.Concat(calls.Skip(1).Select(protocol.DecodeInstruction)).ToArray();
            return ReconcileRun(evidence, decoded, cancellation);
        }
        private static RpcAccount Observed(ExecutionReconciliation evidence, string address)
        {
            var row = evidence.Accounts.SingleOrDefault(value => value.Address == address);
            if (row?.Observation == null || row.Observation.Slot < evidence.MinimumSlot)
                throw new FormatException("Missing fresh affected-account observation");
            return row.Observation;
        }
    }
}
