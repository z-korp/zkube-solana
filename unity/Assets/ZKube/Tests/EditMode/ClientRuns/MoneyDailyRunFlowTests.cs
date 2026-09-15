using System;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Client.Runs.Tests
{
    public sealed partial class RunClientTests
    {
        [Test] public async Task DailyFlowEntersOnceAndOpensOnlyTheAcceptedOracleState()
        {
            var env = await Environment.Create(); env.Http.Prepare("daily"); env.Http.FailClaims = true;
            var flow = await CreateFlow(env, () => Enumerable.Repeat((byte)7, 32).ToArray());
            try
            {
                var launch = (await flow.StartDailyRun()).Value;
                Assert.That(launch.CanBind, Is.True, launch.Operation.Error?.ToString());
                Assert.That(NativeEngine.Summary(launch.Operation.State.Token).Phase, Is.EqualTo((byte)CorePhase.Playing));
                Assert.That(env.Http.Sent, Is.EqualTo(new[] { "enter_arena", "delegate_active_run", "request_vrf" }));
                Assert.That(launch.Operation.Receipts.All(step => step.Result.Outcome == ExecutionOutcome.ConfirmedSuccess), Is.True);
                Assert.That(launch.Operation.Receipts.Select(step => step.Result.Intent), Is.EqualTo(new[] { "start-daily", "vrf-daily" }));
                Assert.That(env.Native.OwnerPrompts, Is.Zero);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
                Assert.That(await env.Markers.Load(env.Owner), Is.Not.Null);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task APreviouslyReadyDailyCannotEnterAtTheFreeze()
        {
            var env = await Environment.Create(); env.Http.Prepare("daily");
            var flow = await CreateFlow(env);
            try
            {
                var shown = await flow.RefreshDaily(); Assert.That(shown.Value.Entry.Ready, Is.True);
                env.Now = (env.Now / 86400 + 1) * 86400 - 60;
                try { await flow.StartDailyRun(); Assert.Fail("Expected the fresh freeze gate"); }
                catch (InvalidOperationException error) { StringAssert.Contains("frozen", error.Message); }
                Assert.That(env.Http.SentTransactions, Is.Empty); Assert.That(env.Native.OwnerPrompts, Is.Zero);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            }
            finally { await flow.StopAsync(); }
        }

        [Test] public async Task APreviouslyReadyDailyCannotSilentlyRepairARevokedSession()
        {
            var env = await Environment.Create(); env.Http.Prepare("daily");
            var flow = await CreateFlow(env);
            try
            {
                var shown = await flow.RefreshDaily(); Assert.That(shown.Value.Entry.Ready, Is.True);
                env.Http.RevokedSession = true;
                try { await flow.StartDailyRun(); Assert.Fail("Expected explicit session repair"); }
                catch (InvalidOperationException error) { StringAssert.Contains("needs-session", error.Message); }
                Assert.That(env.Http.SentTransactions, Is.Empty); Assert.That(env.Native.OwnerPrompts, Is.Zero);
                Assert.That(await env.Journal.Load(env.Owner), Is.Null);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
