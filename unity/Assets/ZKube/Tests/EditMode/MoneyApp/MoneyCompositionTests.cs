using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyCompositionTests
    {
        [Test]
        public async Task PublicReadUsesOnlyTheTwoPublicPdasWithoutAnIdentityOrPlatformStorage()
        {
            var e = new MoneyTestEnvironment();
            Assert.That(e.Http.Requests, Is.Empty); Assert.That(e.Native.Calls, Is.Zero); Assert.That(e.Store.Calls, Is.Zero);
            var value = (await e.Flow.RefreshPublic()).Value;
            Assert.That(value.DayId, Is.EqualTo((uint)e.Plans["inputs"]["day"]));
            Assert.That(value.PotLamports.HasValue, Is.True);
            var request = e.Http.Requests.Single(x => (string)x["method"] == "getMultipleAccounts");
            CollectionAssert.AreEqual(new[] { e.Services.Planner.ProtocolAddress,
                e.Services.Planner.Daily(value.DayId) }, request["params"][0].Values<string>());
            Assert.That(e.Native.Calls + e.Native.KeyLoads + e.Store.Calls, Is.Zero);
            await e.Flow.StopAsync();
        }
        [Test]
        public async Task ConfigurationIsExplicitAndWrongGenesisCannotInterpretAccounts()
        {
            var e = new MoneyTestEnvironment();
            foreach (var config in new[] { null, new MoneyConnectionConfig(null, e.Config.RouterUri, e.Config.ExpectedGenesis),
                new MoneyConnectionConfig(e.Config.BaseUri, e.Config.RouterUri, "mainnet"),
                new MoneyConnectionConfig(e.Config.BaseUri, e.Config.BaseUri, e.Config.ExpectedGenesis) })
                Assert.Throws<MoneyConfigurationException>(() => e.Create(config));
            Assert.That(e.Http.Requests, Is.Empty); Assert.That(e.Native.Calls + e.Store.Calls, Is.Zero);
            e.Http.Genesis = "wrong-genesis";
            await MoneyTestEnvironment.Fails<Exception>(async () => await e.Flow.RefreshPublic());
            Assert.That(e.Http.Requests.Select(x => (string)x["method"]), Is.EqualTo(new[] { "getGenesisHash" }));
            Assert.That(e.Flow.Public, Is.Null); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ForegroundPreservesArcadeWithoutDeviceKeysOrNewTransactions()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); await e.Flow.Connect(e.Owner);
            var value = (await e.Flow.RefreshOwner()).Value;
            foreach (var mode in new[] { "daily" })
            {
                var actual = value.Daily;
                var row = e.Runs["cases"].Single(x => (string)x["id"] == "active-" + mode + "-playing");
                Assert.That(actual.Phase, Is.EqualTo("delegated"));
                CollectionAssert.AreEqual(Convert.FromBase64String((string)row["token"]["state"]), actual.Token.State);
                Assert.That((await e.Services.RunMarkers.Load(e.Owner)).ActiveRun, Is.EqualTo((string)row["address"]));
            }
            Assert.That(value.Session.Status, Is.EqualTo("none")); Assert.That(value.Pending, Is.Null);
            Assert.That(e.Native.Calls, Is.EqualTo(1)); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ExplicitReadyEnsureDoesNotCreateKeysOrPromptAndOldPurchaseRemainsADistinctReceipt()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); await e.ReadySession();
            var ready = (await e.Flow.EnsureSession()).Value;
            Assert.That(ready.Action, Is.EqualTo("ready")); Assert.That(ready.Ready, Is.True);
            Assert.That(ready.Operation.Outcome, Is.EqualTo(ExecutionOutcome.CompletedLocally));
            e.AddEconomy(); await e.Services.Journal.Begin(e.Purchase());
            var old = (await e.Flow.EnsureSession()).Value;
            Assert.That(old.Action, Is.EqualTo("recover")); Assert.That(old.Operation.Intent, Is.EqualTo("purchase-one"));
            Assert.That(old.Operation.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null);
            Assert.That(e.Native.Calls, Is.EqualTo(1)); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task PendingPurchaseUsesRealReconcilerAndInvalidatesRetainedEconomyProjection()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); e.AddEconomy(); await e.Flow.Connect(e.Owner);
            var retained = await e.Flow.RefreshOwner();
            var product = await e.Services.Products.Profile();
            var identity = e.Services.Identity.Lease(); long epoch = e.Services.Identity.Epoch;
            await e.Services.Journal.Begin(e.Purchase());
            var result = await e.Services.Executor.Resume(e.Owner, e.Services.Reconciler);
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That(retained.IsCurrent, Is.False); Assert.Throws<OperationCanceledException>(() => _ = retained.Value);
            Assert.That(product.IsCurrent, Is.False); Assert.Throws<OperationCanceledException>(() => _ = product.Value);
            Assert.That(e.Services.Identity.Epoch, Is.EqualTo(epoch + 1));
            Assert.That(e.Services.Identity.IsCurrent(identity), Is.True, "Data changes preserve the connected identity");
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ForegroundPendingStatusNeverBecomesAnEmptySuccessOrNewSessionRepair()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); e.Http.Confirmation = "processed";
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            var value = (await e.Flow.RefreshOwner()).Value;
            Assert.That(value.PreviousOperation.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(value.Pending.Signature, Is.EqualTo(pending.Signature));
            Assert.That(value.Profile, Is.Null); Assert.That(value.Campaign, Is.Null); Assert.That(value.Session, Is.Null);
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Native.KeyLoads, Is.Zero); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ForegroundDoesNotConsumeATransactionArrivingDuringItsProfileRead()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); e.AddEconomy();
            // Let the independent connect-time record read enter before holding
            // the foreground read whose transaction boundary this case checks.
            e.Http.DelayMethod = "getAccountInfo";
            e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            await e.Flow.Connect(e.Owner); await e.Http.Entered.Task; e.Http.Release.SetResult(true);
            e.Http.DelayMethod = "getAccountInfo";
            e.Http.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            e.Http.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var refresh = e.Flow.RefreshOwner(); await e.Http.Entered.Task;
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            e.Http.StatusError = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") };
            e.Http.Release.SetResult(true); var observed = (await refresh).Value;
            Assert.That(observed.PreviousOperation, Is.Null);
            Assert.That(observed.Pending.Signature, Is.EqualTo(pending.Signature));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Http.Requests.Any(x => (string)x["method"] == "getSignatureStatuses"), Is.False);
            var receipt = (await e.Flow.ResumePending()).Value;
            Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(receipt.Signature, Is.EqualTo(pending.Signature));
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ConfirmedFailureRemainsFailureAndMalformedObservedAccountsKeepTheJournal()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); e.AddEconomy();
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            var address = e.Services.Planner.CreditVaultAddress; var valid = e.Http.Accounts[address].DeepClone();
            e.Http.Accounts[address]["owner"] = e.Owner;
            var malformed = (await e.Flow.ResumePending()).Value;
            Assert.That(malformed.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            e.Http.Accounts[address] = valid;
            e.Http.StatusError = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") };
            var failed = (await e.Flow.ResumePending()).Value;
            Assert.That(failed.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure)); Assert.That(failed.ChainError, Is.Not.Null);
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ExplicitUnderfundedEnsureKeepsTheSameSignerAndExposesFeeShortageBeforeSigning()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); await e.ReadySession();
            e.Http.Accounts[(string)e.Plans["inputs"]["device"]]["lamports"] = 0;
            e.Http.AllowFeeQuote = true; e.Http.Blockhash = (string)e.Plans["inputs"]["blockhash"];
            var value = (await e.Flow.EnsureSession()).Value;
            Assert.That(value.Action, Is.EqualTo("refill")); Assert.That(value.Ready, Is.False);
            Assert.That(value.Operation.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage), value.Operation.Code);
            var quote = e.Http.Requests.Single(x => (string)x["method"] == "getFeeForMessage");
            var oracle = e.Solana["transactions"].Single(x => (string)x["id"] == "session-refill-0");
            ZKube.Integration.Tests.ProgramScenarios.EquivalentMessages((string)quote["params"][0], (string)oracle["message"]);
            Assert.That((await e.Services.Sessions.Load(e.Owner)).Active.Signer, Is.EqualTo((string)e.Plans["inputs"]["device"]));
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); Assert.That(e.Native.Calls, Is.EqualTo(1));
            Assert.That(e.Http.Requests.Any(x => (string)x["method"] == "sendTransaction"), Is.False); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ActualConsumedArcadeReceiptClearsItsDurableMarkerThroughTheComposedDispatcher()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); await e.Flow.Connect(e.Owner); await e.Flow.RefreshOwner();
            var campaign = await e.Services.RunMarkers.Load(e.Owner);
            e.Http.Accounts.Remove(campaign.ActiveRun); e.Http.Delegated.Remove(campaign.ActiveRun); e.Http.Add(e.Runs["consumedPlayers"]["daily"]);
            await e.Services.Journal.Begin(new PendingTransaction(e.Owner, "consume-daily", e.Config.BaseUri, true,
                Convert.FromBase64String((string)e.Runs["ownerConsume"]["daily"]), (string)e.Plans["inputs"]["blockhash"], 500));
            var result = (await e.Flow.ResumePending()).Value;
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That(await e.Services.RunMarkers.Load(e.Owner), Is.Null);
            Assert.That(await e.Services.Journal.Load(e.Owner), Is.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task ExistingSignedRenewalSavesItsExpiryAcrossRestart()
        {
            var e = new MoneyTestEnvironment(); var fixture = MoneyTestEnvironment.Fixture("device");
            var plan = fixture["cases"][0]; e.Native.Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            var old = new SessionRecord(e.Owner, (string)fixture["inputs"]["device"], (string)plan["oldToken"]["address"], e.Now + (long)plan["remaining"]);
            var renewed = new SessionRecord(e.Owner, (string)fixture["inputs"]["device"], (string)fixture["renewedToken"]["address"], (long)fixture["renewedToken"]["validUntil"]);
            await e.Services.Sessions.Replace(await e.Services.Sessions.Load(e.Owner), new SessionRecords(e.Owner, old));
            e.Http.Add(fixture["renewedToken"]); e.Http.Add(e.Solana["accounts"].Single(x => (string)x["id"] == "player-valid"));
            var pending = new PendingTransaction(e.Owner, "session-renew", e.Config.BaseUri, true, Convert.FromBase64String((string)plan["signedTransaction"]), (string)fixture["inputs"]["blockhash"], 500);
            await e.Services.Journal.Begin(pending); await e.Flow.StopAsync();
            var restarted = e.Create(e.Config); var flow = new MoneyAppFlow(restarted); await flow.Connect(e.Owner);
            var result = (await flow.ResumePending()).Value;
            Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), result.Code);
            Assert.That((await restarted.Sessions.Load(e.Owner)).Active.Signer, Is.EqualTo(renewed.Signer));
            Assert.That(e.Native.Creations, Is.Zero); Assert.That(await restarted.Journal.Load(e.Owner), Is.Null);
            Assert.That((await flow.ResumePending()).Value.Code, Is.EqualTo("no-pending-transaction"));
            Assert.That(e.Native.Creations, Is.Zero); e.AssertReadOnly(); await flow.StopAsync();
        }
    }

}
