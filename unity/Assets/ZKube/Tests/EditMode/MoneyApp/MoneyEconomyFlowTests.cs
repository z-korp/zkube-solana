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
                var expected = e.Plans["plans"].Single(row => (string)row["id"] == "purchase-" + pack);
                Assert.That((string)quote["params"][0], Is.EqualTo((string)expected["expected"]["message"]));
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
                var reading = e.Flow.RefreshRewards((uint)MoneyTestEnvironment.Fixture("unity-product-reads-v1.json")["inputs"]["oldDay"]); await e.Http.Entered.Task;
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
                await e.Flow.Connect(e.Owner);
                var origin = e.Services.Identity.Lease();
                await e.Flow.Disconnect(); await e.Flow.Connect(e.Owner);
                int calls = e.Http.Requests.Count, native = e.Native.Calls;
                await MoneyTestEnvironment.Fails<OperationCanceledException>(() => e.Services.Economy.Buy(1, origin.Cancellation));
                Assert.That(e.Http.Requests.Count, Is.EqualTo(calls)); Assert.That(e.Native.Calls, Is.EqualTo(native));
            }
            finally { await e.Flow.StopAsync(); }
        }
    }
}
