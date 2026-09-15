using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client
{
    public sealed class ExecutionDispatcher : IExecutionReconciler
    {
        private readonly SessionInstructionReconciler sessions;
        private readonly EconomyInstructionReconciler economy;
        private readonly SessionMaintenanceReconciler maintenance;
        private readonly RunInstructionReconciler runs;
        public ExecutionDispatcher(SessionInstructionReconciler sessions, SessionMaintenanceReconciler maintenance, EconomyInstructionReconciler economy, RunInstructionReconciler runs)
        { this.sessions = sessions; this.maintenance = maintenance; this.economy = economy; this.runs = runs; }
        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            // Each branch accepts only its complete recognized top-level shape.
            // It performs its durable sink before returning true; unknown or
            // malformed compositions remain journaled by the executor.
            if (await sessions.Reconcile(evidence, cancellation).ConfigureAwait(false)) return true;
            if (await maintenance.Reconcile(evidence, cancellation).ConfigureAwait(false)) return true;
            if (await economy.Reconcile(evidence, cancellation).ConfigureAwait(false)) return true;
            return await runs.Reconcile(evidence, cancellation).ConfigureAwait(false);
        }
    }
}
