using System;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyCampaignFlowTests
    {
        [Test] public async Task CampaignReadInvalidatesAfterAcceptedEconomyWhileOwnerStaysConnected()
        {
            var e = Create(); e.AddEconomy(); await e.Flow.Connect(e.Owner);
            var retained = await e.Flow.RefreshCampaign(); await e.Services.Journal.Begin(e.Purchase());
            var result = await e.Services.Executor.Resume(e.Owner, e.Services.Dispatcher);
            Assert.That(result.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That(e.Services.Identity.Owner, Is.EqualTo(e.Owner));
            Assert.That(retained.IsCurrent, Is.False); Assert.Throws<OperationCanceledException>(() => _ = retained.Value);
            e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test] public async Task CampaignReadCannotPublishAcrossAnAcceptedEconomyChange()
        {
            var e = Create(); e.AddEconomy(); await e.Flow.Connect(e.Owner);
            e.Http.DelayMethod = "getMultipleAccounts"; e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var read = e.Flow.RefreshCampaign(); await e.Http.Entered.Task;
            try
            {
                await e.Services.Journal.Begin(e.Purchase());
                var result = await e.Services.Executor.Resume(e.Owner, e.Services.Dispatcher);
                Assert.That(result.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess), result.Code);
            }
            finally { e.Http.Release.TrySetResult(true); }
            await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await read);
            e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        private static MoneyTestEnvironment Create()
        {
            var e = new MoneyTestEnvironment(); var fixture = MoneyTestEnvironment.Fixture("unity-product-reads-v1.json");
            foreach (var catalog in fixture["accounts"]["catalogs"]) e.Http.Add(catalog);
            e.Http.Add(fixture["accounts"]["player"]); return e;
        }
        [Test] public async Task BrowseNeverConsumesPendingJournalAndPreservesIdentityGuard()
        {
            var e = Create(); await e.Flow.Connect(e.Owner); var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            var result = await e.Flow.RefreshCampaign();
            Assert.That(result.Value.PendingTransaction, Is.True); Assert.That(result.Value.Browse.Realms.Count, Is.EqualTo(10));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Http.Requests.Any(row => (string)row["method"] == "getSignatureStatuses"), Is.False);
            await e.Flow.Disconnect(); Assert.That(result.IsCurrent, Is.False); Assert.Throws<OperationCanceledException>(() => _ = result.Value);
            e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test] public async Task DisconnectDiscardsDelayedCampaignReadWithoutReplacementPublication()
        {
            var e = Create(); await e.Flow.Connect(e.Owner);
            e.Http.DelayMethod = "getMultipleAccounts"; e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var task = e.Flow.RefreshCampaign(); await e.Http.Entered.Task;
            try { await e.Flow.Disconnect(); }
            finally { e.Http.Release.TrySetResult(true); }
            await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await task);
            Assert.That(e.Services.Identity.Owner, Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
    }
}
