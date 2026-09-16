using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyEconomyFlowTests
    {
        [Test] public async Task TheLastOperationIsSharedAcrossPagesAndClearedOnReconnect()
        {
            var e = new MoneyTestEnvironment();
            try
            {
                await e.Flow.Connect(e.Owner); e.AddEconomy();
                e.Http.AllowFeeQuote = true; e.Http.Blockhash = (string)e.Plans["inputs"]["blockhash"];
                var first = (await e.Flow.BuyKredits(1)).Value;
                var retained = await e.Flow.RefreshKredits();
                Assert.That(retained.Value.PreviousOperation, Is.SameAs(first));
                var next = (await e.Flow.BuyKredits(10)).Value;
                Assert.That(retained.IsCurrent, Is.False);
                Assert.That((await e.Flow.RefreshSession()).Value.PreviousOperation, Is.SameAs(next));
                Assert.That((await e.Flow.RefreshOwner()).Value.PreviousOperation, Is.SameAs(next));
                Assert.That((await e.Flow.ResumePending()).Value.Code, Is.EqualTo("no-pending-transaction"));
                Assert.That((await e.Flow.RefreshKredits()).Value.PreviousOperation, Is.SameAs(next));
                await e.Flow.Disconnect(); await e.Flow.Connect(e.Owner);
                Assert.That((await e.Flow.RefreshKredits()).Value.PreviousOperation, Is.Null);
            }
            finally { await e.Flow.StopAsync(); }
        }

        [TestCase(1U), TestCase(10U), TestCase(25U)]
        public async Task EveryPackUsesItsActualAgreedOwnerMessageAndPreservesAFeeShortageReceipt(uint pack)
        {
            var e = new MoneyTestEnvironment();
            try
            {
                await e.Flow.Connect(e.Owner); e.AddEconomy();
                e.Http.AllowFeeQuote = true; e.Http.Blockhash = (string)e.Plans["inputs"]["blockhash"];
                var result = (await e.Flow.BuyKredits(pack)).Value;
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage), result.Code);
                var quote = e.Http.Requests.Single(row => (string)row["method"] == "getFeeForMessage");
                var expected = e.Solana["transactions"].Single(row => (string)row["id"] == "purchase-" + pack);
                ZKube.Integration.Tests.ProgramScenarios.EquivalentMessages((string)quote["params"][0], (string)expected["message"]);
                Assert.That(e.Native.Calls, Is.EqualTo(1));
                Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null);
                var observed = (await e.Flow.RefreshOwner()).Value;
                Assert.That(observed.PreviousOperation, Is.SameAs(result));
            }
            finally { await e.Flow.StopAsync(); }
        }

        [Test] public async Task OpeningKreditsObservesAnExistingReceiptWithoutResumingOrBuying()
        {
            var e = new MoneyTestEnvironment();
            try
            {
                await e.Flow.Connect(e.Owner); e.AddEconomy();
                var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
                var state = (await e.Flow.RefreshKredits()).Value;
                Assert.That(state.Pending.Signature, Is.EqualTo(pending.Signature));
                Assert.That(state.Profile.Owner, Is.EqualTo(e.Owner));
                var rejected = await MoneyTestEnvironment.Fails<InvalidOperationException>(() => e.Flow.BuyKredits(1));
                StringAssert.Contains("existing transaction", rejected.Message);
                Assert.That(e.Http.Requests.Any(row => (string)row["method"] == "getSignatureStatuses"), Is.False);
                Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
                e.AssertReadOnly(); Assert.That(e.Native.Calls, Is.EqualTo(1));
            }
            finally { await e.Flow.StopAsync(); }
        }

        [Test] public async Task AQueuedPurchaseRejectsADoubleTapAndCancelsBeforeAnyQuote()
        {
            var e = new MoneyTestEnvironment();
            try
            {
                await e.Flow.Connect(e.Owner); e.AddEconomy();
                e.Http.DelayMethod = "getMultipleAccounts";
                e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                var reading = e.Flow.RefreshRewards((uint)MoneyTestEnvironment.Fixture("reads")["inputs"]["oldDay"]); await e.Http.Entered.Task;
                using var cancellation = new CancellationTokenSource();
                var purchase = e.Flow.BuyKredits(1, cancellation.Token);
                Assert.Throws<InvalidOperationException>(() => e.Flow.BuyKredits(1));
                cancellation.Cancel(); e.Http.Release.TrySetResult(true);
                await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await reading);
                await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await purchase);
                e.AssertReadOnly(); Assert.That(e.Native.Calls, Is.EqualTo(1));
            }
            finally { e.Http.Release?.TrySetResult(true); await e.Flow.StopAsync(); }
        }

        [Test] public async Task AnEarlierOwnerScopeCannotInitiatePurchaseAfterReconnect()
        {
            var e = new MoneyTestEnvironment();
            try
            {
                // Exercise the economy's identity boundary without starting
                // independent background save reads in the application flow.
                await e.Services.Identity.Connect(e.Owner);
                var origin = e.Services.Identity.Lease();
                await e.Services.Identity.Disconnect(); await e.Services.Identity.Connect(e.Owner);
                int calls = e.Http.Requests.Count, native = e.Native.Calls;
                await MoneyTestEnvironment.Fails<OperationCanceledException>(() => e.Services.Economy.Buy(1, origin.Cancellation));
                Assert.That(e.Http.Requests.Count, Is.EqualTo(calls)); Assert.That(e.Native.Calls, Is.EqualTo(native));
            }
            finally { await e.Flow.StopAsync(); }
        }
    }
}
