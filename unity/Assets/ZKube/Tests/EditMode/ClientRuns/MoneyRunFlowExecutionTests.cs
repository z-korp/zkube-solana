using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration.App;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client.Runs.Tests
{
    public sealed partial class RunClientTests
    {
        private static async Task<MoneyAppFlow> CreateFlow(Environment env, Func<byte[]> runClientSeed = null)
        {
            var services = new MoneyClientServices(
                ZKube.Integration.Tests.TestBootstrap.ProtocolJson,
                ZKube.Integration.Tests.TestBootstrap.TokenJson,
                new MoneyConnectionConfig("https://base.invalid/", "https://router.invalid/", env.Http.Genesis),
                env.Http.Transport, env.Native, env.Storage, () => env.Now, owner => new ZKube.Local.LocalProductStore(owner: owner), runClientSeed);
            var flow = new MoneyAppFlow(services); await flow.Connect(); return flow;
        }

        [Test] public async Task ExplicitFixtureSeedReachesTheActualSignedInstructionOnlyOnAnAction()
        {
            var env = await Environment.Create(); int requested = 0;
            var seed = Enumerable.Repeat((byte)7, 32).ToArray();
            var flow = await CreateFlow(env, () => { requested++; return seed; });
            try
            {
                var launch = (await flow.OpenSavedRun()).Value;
                Assert.That(requested, Is.Zero);
                var result = (await flow.SubmitRun(launch.Run, launch.Operation.State.Token,
                    RunClientAction.Reroll, 0, 0, 0, env.Now)).Value;
                Assert.That(result.Error, Is.Null); Assert.That(requested, Is.EqualTo(1));
                var protocol = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
                var transaction = TransactionSignatures.Describe(Convert.FromBase64String(env.Http.SentTransactions.Single()));
                var instruction = protocol.DecodeInstruction(transaction.Instructions.Single(value => value.ProgramId == protocol.ProgramId));
                Assert.That(instruction.Name, Is.EqualTo("request_reroll"));
                Assert.That(instruction.Arguments["client_seed"].Values<byte>(), Is.EqualTo(seed));
                Assert.That(seed.All(value => value == 7), Is.True);
                Assert.That(result.Receipts.Single().Result.Signature, Is.Not.Null.And.Not.Empty);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task InvalidFixtureSeedsCannotProduceASignedOrSentRunTransaction()
        {
            foreach (int length in new[] { -1, 0, 31, 33 })
            {
                var env = await Environment.Create();
                var flow = await CreateFlow(env, () => length < 0 ? null : new byte[length]);
                try
                {
                    var launch = (await flow.OpenSavedRun()).Value;
                    var result = (await flow.SubmitRun(launch.Run, launch.Operation.State.Token,
                        RunClientAction.Reroll, 0, 0, 0, env.Now)).Value;
                    Assert.That(result.Error, Is.TypeOf<InvalidOperationException>());
                    StringAssert.Contains("32 bytes", result.Error.Message);
                    Assert.That(result.Receipts, Is.Empty); Assert.That(env.Http.SentTransactions, Is.Empty);
                    Assert.That(env.Native.OwnerPrompts, Is.Zero); Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                }
                finally { await flow.StopAsync(); }
            }
        }

        [Test] public async Task MoneyRunReadFailureRetainsActualConfirmedReceiptAndReportsTheNewFailure()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); var flow = await CreateFlow(env);
                try
                {
                    var launch = (await flow.OpenSavedRun()).Value;
                    var accepted = (await flow.SubmitRun(launch.Run, launch.Operation.State.Token,
                        RunClientAction.Reroll, 0, 0, 0, env.Now)).Value;
                    Assert.That(accepted.Error, Is.Null); Assert.That(accepted.Receipts.Count, Is.EqualTo(1));
                    var exact = accepted.Receipts[0].Result;
                    Assert.That(exact.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                    Assert.That(exact.Intent, Is.EqualTo("reroll-" + mode));
                    Assert.That(exact.Signature, Is.Not.Null.And.Not.Empty);
                    Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                    int sent = env.Http.SentTransactions.Count;
                    env.Http.FailObservation = true;
                    var retry = (await flow.RecoverRun(launch.Run)).Value;
                    Assert.That(retry.Error, Is.TypeOf<IOException>()); Assert.That(retry.Receipts, Is.Empty);
                    Assert.That(flow.LastRunReceipts(launch.Run).Steps.Select(row => row.Result), Is.EqualTo(accepted.Receipts.Select(row => row.Result)));
                    Assert.That(flow.LastRunReceipts(launch.Run).Steps[0].Result, Is.SameAs(exact));
                    Assert.That(env.Http.SentTransactions.Count, Is.EqualTo(sent));
                }
                finally { await flow.StopAsync(); }
            }
        }

        [Test] public async Task MoneyRunSettlementUsesTheActualReconcilerAndKeepsOrderedCommitConsumeReceipts()
        {
            foreach (string mode in new[] { "daily" })
            {
                var env = await Environment.Create(); env.Http.States[mode] = "finished";
                var flow = await CreateFlow(env);
                try
                {
                    var launch = (await flow.OpenSavedRun()).Value;
                    var result = (await flow.SettleRun(launch.Run)).Value;
                    Assert.That(result.Error, Is.Null); Assert.That(result.State.Phase, Is.EqualTo("consumed"));
                    Assert.That(result.Receipts.Select(step => step.Result.Intent),
                        Is.EqualTo(new[] { "commit-" + mode, "consume-" + mode }));
                    Assert.That(result.Receipts.All(step => step.Address == launch.Run.Address && step.Owner == env.Owner &&
                        step.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
                    Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                    Assert.That(await env.Markers.Load(env.Owner), Is.Null);
                    Assert.That(flow.LastRunReceipts(launch.Run).Steps.Select(row => row.Result), Is.EqualTo(result.Receipts.Select(row => row.Result)));
                }
                finally { await flow.StopAsync(); }
            }
        }
    }
}
