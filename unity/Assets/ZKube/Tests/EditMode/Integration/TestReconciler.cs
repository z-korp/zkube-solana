using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;

namespace ZKube.Integration.Tests
{
    public sealed class TestReconciler : IExecutionReconciler
    {
        private readonly AccountBindings bindings;
        private readonly TransactionPlanner planner;
        public bool Ready = true; public int Count;
        public TaskCompletionSource<bool> Entered, Release;
        public TestReconciler(AccountBindings bindings, TransactionPlanner planner) { this.bindings = bindings; this.planner = planner; }
        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            await Task.Yield(); Count++;
            Entered?.TrySetResult(true);
            if (Release != null) await Release.Task;
            Assert.That(evidence.Transaction.Instructions.Any(ix => ix.ProgramId == bindings.ProgramId), Is.True);
            Assert.That(TransactionSignatures.ValidateFullySigned(evidence.Pending.Transaction), Is.EqualTo(evidence.Pending.Signature));
            Assert.That(evidence.Accounts.All(a => a.Observation.Slot >= evidence.MinimumSlot), Is.True);
            Assert.That(evidence.Accounts.Select(a => a.Address), Is.EquivalentTo(evidence.Transaction.Accounts.Where(a => a.Writable).Select(a => a.Address)));
            var player = evidence.Accounts.SingleOrDefault(a => a.Address == planner.Player(evidence.Pending.Owner));
            if (player != null) bindings.PlayerState(player.Observation.Envelope, evidence.Pending.Owner);
            foreach (var account in evidence.Accounts.Where(a => a != player && a.Observation.Envelope?.Owner == bindings.ProgramId))
                RunPlanSnapshot.Decode(bindings, account.Observation.Envelope, evidence.Pending.Owner);
            return Ready;
        }
    }
}
