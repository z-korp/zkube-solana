using System;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;
using Newtonsoft.Json.Linq;
using ZKube.Integration.Tests;

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

        [Test] public async Task ADeviceThatCannotPayItsFirstEntryIsAskedToRefillBeforeEntering()
        {
            ulong needed = DeviceFunding.EntryBalanceLamports(false);
            Assert.That(needed, Is.EqualTo(Protocol.SystemAccountRentLamports + Protocol.FirstEntryPeakRentLamports +
                2 * DeviceFunding.TransactionFeeLamports + DeviceFunding.DelegationChargeLamports));
            // The funded target pays a first entry and then the largest pack's other runs.
            ulong pack = needed + (SessionViewPolicy.KreditPacks.Max() - 1UL) * DeviceFunding.RunCostLamports;
            Assert.That(DeviceFunding.AllowanceLamports, Is.InRange(pack, pack + Protocol.PayoutUnitLamports - 1));
            Assert.That(DeviceFunding.AllowanceLamports % Protocol.PayoutUnitLamports, Is.Zero);
            // Later the same day the daily player exists and its rent is not paid again.
            Assert.That(needed - DeviceFunding.EntryBalanceLamports(true), Is.EqualTo(Protocol.ArenaPlayerRentLamports));
            foreach (bool funded in new[] { false, true })
            {
                var env = await Environment.Create(); env.Http.Prepare("daily");
                env.Http.SignerBalance = funded ? needed : needed - 1;
                var flow = await CreateFlow(env);
                try
                {
                    var shown = await flow.RefreshDaily();
                    Assert.That(shown.Value.Entry.Status, Is.EqualTo(funded ? "ready" : "needs-refill"));
                    if (funded) continue;
                    try { await flow.StartDailyRun(); Assert.Fail("Expected the refill gate"); }
                    catch (InvalidOperationException error) { StringAssert.Contains("needs-refill", error.Message); }
                    Assert.That(env.Http.SentTransactions, Is.Empty); Assert.That(env.Native.OwnerPrompts, Is.Zero);
                }
                finally { await flow.StopAsync(); }
            }
        }

        [Test] public async Task AResolvedErEndpointMustBeHttpsLikeEveryOtherEndpoint()
        {
            var plans = Fixture("plans"); string run = (string)Fixture("runs")["successor"]["address"];
            string program = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson).ProgramId;
            string genesis = (string)Fixture("transport")["inputs"]["expectedGenesis"];
            foreach (var (fqdn, accepted) in new[] { ("http://er.remote.example/", false), ("https://er.remote.example/", true),
                ("http://127.0.0.1:8899/", true), ("ftp://er.remote.example/", false) })
            {
                var http = new TestHttp { Reply = (endpoint, request, cancellation) => Task.FromResult<JToken>(
                    (string)request["method"] == "getGenesisHash" ? new JValue(genesis) :
                    (string)request["method"] == "getDelegationStatus" ? new JObject { ["isDelegated"] = true, ["fqdn"] = fqdn,
                        ["delegationRecord"] = new JObject { ["owner"] = program, ["authority"] = plans["inputs"]["validator"],
                            ["delegationSlot"] = 900, ["lamports"] = 1 } } :
                    TestHttp.Context(JValue.CreateNull(), 10000)) };
                var rpc = new SolanaRpcTransport(http, "https://base.invalid/", "https://router.invalid/", genesis, program);
                if (accepted) { Assert.That((await rpc.Placement(run)).Endpoint, Is.EqualTo(fqdn)); Assert.That(await rpc.ReadEr(fqdn, run), Is.Null); continue; }
                try { await rpc.Placement(run); Assert.Fail("Expected the endpoint policy to reject " + fqdn); }
                catch (FormatException) { }
                // Nothing was cached: no read can reach the rejected endpoint.
                try { await rpc.ReadEr("https://er.remote.example/", run); Assert.Fail("Expected no cached placement"); }
                catch (InvalidOperationException) { }
            }
            Assert.Throws<FormatException>(() => new SolanaRpcTransport(new TestHttp(), "http://base.invalid/", "https://router.invalid/", genesis, program));
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
