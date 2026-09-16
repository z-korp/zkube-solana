using System;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Local;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyCampaignFlowTests
    {
        [Test] public async Task money_identity_cannot_start_a_local_daily()
        {
            var e = new MoneyTestEnvironment();
            await e.Flow.Connect(e.Owner);
            var client = e.Services.Campaign(e.Owner).Runs;
            Assert.That(client.GetType(), Is.EqualTo(typeof(LocalRunClient)));
            Assert.That(client.GetType().GetMethod("StartDaily"), Is.Null);
            Assert.That(client.GetType().GetMethod("Today"), Is.Null);
            await e.Flow.StopAsync(); e.AssertReadOnly();
        }

        [Test] public async Task money_campaign_needs_an_address_and_no_session()
        {
            var e = new MoneyTestEnvironment();
            await ZKube.Integration.Tests.AsyncAssert.Throws<InvalidOperationException>(async () => await e.Flow.StartCampaignRun(1, 1));
            await e.Flow.Connect(e.Owner);
            var run = await e.Flow.StartCampaignRun(1, 1);
            Assert.That(run.Value.Bind("Campaign").Accepted, Is.Not.Null);
            Assert.That(e.Native.KeyLoads, Is.Zero);
            var browse = await e.Flow.RefreshCampaign();
            Assert.That(browse.Value.Browse.Realms.Count, Is.EqualTo(10));
            CollectionAssert.AreEqual(run.Value.Bind("Campaign").Accepted.State, (await e.Flow.OpenSavedCampaign()).Value.Bind("Campaign").Accepted.State);
            await e.Flow.Disconnect();
            Assert.That(run.IsCurrent, Is.False);
            await ZKube.Integration.Tests.AsyncAssert.Throws<OperationCanceledException>(async () => await run.Value.Recover(CancellationToken.None));
            Assert.That(browse.IsCurrent, Is.False);
            e.AssertReadOnly(); await e.Flow.StopAsync();
        }

        [Test] public async Task campaign_record_write_never_gates_play_or_other_transactions()
        {
            var e = new MoneyTestEnvironment(); e.AddEconomy();
            e.Http.DelayMethod = "getAccountInfo";
            e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            await e.Flow.Connect(e.Owner); await e.Http.Entered.Task;
            var local = e.Services.Campaign(e.Owner);
            local.MergeCampaignRecord(new byte[25] { 1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0 });
            var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var sync = new CampaignRecordSync(local.Product, local.Runs, _ => Task.FromResult(new byte[25]),
                async (stars, token) => { entered.TrySetResult(true); return await release.Task; });
            sync.Start(CancellationToken.None); await entered.Task;
            try
            {
                var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
                var run = await e.Flow.StartCampaignRun(1, 1);
                Assert.That(run.Value.Bind("Campaign").Accepted, Is.Not.Null);
                Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
                var result = await e.Services.Executor.Resume(e.Owner, e.Services.Reconciler);
                Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
                Assert.That(run.IsCurrent, Is.True, "Economy preserves the Campaign identity lease");
                Assert.That(sync.Pending.IsCompleted, Is.False, "Write remains pending");
                Assert.That(local.Product.Read.CampaignWritePending, Is.True, "Retry intent remains durable");
            }
            finally {
                release.TrySetResult(false); await sync.Pending;
                var stopping = e.Flow.StopAsync(); e.Http.Release.TrySetResult(true); await stopping;
            }
            Assert.That(local.Product.Read.CampaignWritePending, Is.True);
            e.AssertReadOnly();
        }
    }
}
