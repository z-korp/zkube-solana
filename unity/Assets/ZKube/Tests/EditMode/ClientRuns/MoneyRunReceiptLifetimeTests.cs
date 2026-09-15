using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client.Runs.Tests
{
    public sealed partial class RunClientTests
    {
        [Test] public async Task AConsumedRunsReceiptCanFinishWithoutClaimingItsNewSuccessor()
        {
            foreach (string mode in new[] { "campaign", "daily" })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished"; env.Http.Delegated.Remove(mode);
                var initial = await env.Client.Inspect(mode);
                var binding = new RunPresentationBinding(initial, new ActiveRunReconciler(env.Accounts));
                env.Http.SuccessorAfterConsume = true; env.Http.Confirmed = false;
                await Fails<RunExecutionException>(async () => await env.Client.FinishAndSettle(mode, binding));
                var pending = await env.Journal.Load(env.Owner); Assert.That(pending, Is.Not.Null);
                env.Http.Confirmed = true;
                var receipt = new RunOperationReceipts(env.Owner, mode, binding.Address);
                var recovered = await env.Client.Recover(mode, binding, receipts: receipt);
                Assert.That(recovered.Phase, Is.EqualTo("consumed")); Assert.That(recovered.Token, Is.Null);
                Assert.That(receipt.Steps.Single().Address, Is.EqualTo(binding.Address));
                Assert.That(receipt.Steps.Single().Result.Signature, Is.EqualTo(pending.Signature));
                Assert.That(receipt.Steps.Single().Result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That((await env.Markers.Load(env.Owner, mode)).ActiveRun, Is.EqualTo((string)env.Http.Runs["successor"]["address"]));
                Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(1));
            }
        }
    }
}
