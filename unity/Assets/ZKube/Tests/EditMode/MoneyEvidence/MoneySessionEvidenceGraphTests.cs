using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration;
using ZKube.Integration.App;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;

namespace ZKube.Tests.MoneyEvidence
{
    public sealed class MoneySessionEvidenceGraphTests
    {
        private static string Root => Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
        private static JObject Fixture => JObject.Parse(File.ReadAllText(Environment.GetEnvironmentVariable("ZKUBE_MONEY_SESSION_FIXTURE_PATH") ?? Path.Combine(Root, "fixtures/unity-money-session-v1.json")));
        private static Task<MoneySessionEvidenceGraph> Create(string scenario) => MoneySessionEvidenceGraph.Create(scenario,
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
        private static void Assessment(SessionAssessment actual, JToken expected)
        {
            if (expected.Type == JTokenType.Null) { Assert.That(actual.Status, Is.EqualTo("none")); return; }
            Assert.That(actual.Status, Is.EqualTo((string)expected["status"])); Assert.That(actual.Funding, Is.EqualTo((string)expected["funding"]));
            Assert.That(actual.ValidUntil, Is.EqualTo((long)expected["validUntil"])); Assert.That(actual.Balance, Is.EqualTo((ulong)expected["balance"]));
        }
        [TestCase("session-enable-success")]
        [TestCase("session-enable-pending-failure")]
        [TestCase("session-refill-success")]
        [TestCase("session-current")]
        [TestCase("session-disable-pending-success")]
        [TestCase("session-disable-zero")]
        [TestCase("session-owner-decline")]
        [TestCase("session-fee-shortage")]
        [TestCase("session-renew-expired")]
        public async Task FiniteSessionScenarioUsesActualPlannerAndConfirmedDispatcher(string scenario)
        {
            var graph = await Create(scenario); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                Assert.That(graph.Services.Identity.Owner, Is.Null); Assert.That(graph.Calls.Any(call => call.Operation == "signTransactions"), Is.False);
                await flow.RefreshPublic(); await flow.Connect(graph.Owner);
                var row = Fixture["scenarios"].Single(value => (string)value["id"] == scenario);
                Assessment(await graph.Services.SessionLifecycle.Inspect(), row["expectedBefore"]);
                ExecutionResult result;
                if ((string)row["operation"] == "disable") result = await graph.Services.SessionLifecycle.Revoke();
                else
                {
                    var ensured = (await flow.EnsureSession()).Value; result = ensured.Operation;
                    if ((string)row["operation"] == "ready") Assert.That(ensured.Action, Is.EqualTo("ready"));
                }
                if ((string)row["status"] == "processed")
                {
                    Assert.That(result.Outcome, Is.EqualTo(ExecutionOutcome.Pending), result.Code);
                    var pending = await graph.Services.Journal.Load(graph.Owner); Assert.That(pending.Signature, Is.EqualTo(result.Signature));
                    bool disable = (string)row["operation"] == "disable";
                    Assert.That(graph.HasActiveKey, Is.EqualTo(disable)); Assert.That(graph.HasCandidateKey, Is.EqualTo(!disable));
                    if ((bool)row["failure"]) graph.ConfirmPendingFailure(); else graph.ConfirmPendingSuccess();
                    // Fixture outcome selection does not apply local key changes.
                    Assert.That(graph.HasActiveKey, Is.EqualTo(disable)); Assert.That(graph.HasCandidateKey, Is.EqualTo(!disable));
                    result = (await flow.ResumePending()).Value;
                }
                var expected = (bool)row["ownerDeclines"] ? ExecutionOutcome.Rejected : scenario == "session-fee-shortage" ? ExecutionOutcome.FeeShortage :
                    (bool)row["failure"] ? ExecutionOutcome.ConfirmedFailure : row["transaction"].Type == JTokenType.Null ? ExecutionOutcome.CompletedLocally : ExecutionOutcome.ConfirmedSuccess;
                Assert.That(result.Outcome, Is.EqualTo(expected), scenario + " " + result.Code);
                Assessment(await graph.Services.SessionLifecycle.Inspect(), row["expectedAfter"]);
                var keys = await graph.Services.Sessions.Load(graph.Owner);
                if (row["expectedActive"].Type == JTokenType.Null) Assert.That(keys.Active, Is.Null);
                else
                {
                    Assert.That(keys.Active.Signer, Is.EqualTo((string)row["expectedActive"]["signer"]));
                    Assert.That(keys.Active.Token, Is.EqualTo((string)row["expectedActive"]["token"]));
                    Assert.That(keys.Active.ValidUntil, Is.EqualTo((long)row["expectedActive"]["validUntil"]));
                }
                Assert.That(graph.HasActiveKey, Is.EqualTo(keys.Active != null));
                Assert.That(graph.HasCandidateKey, Is.EqualTo((string)row["operation"] == "enable" && expected != ExecutionOutcome.ConfirmedSuccess));
                Assert.That(keys.Candidate != null, Is.EqualTo(graph.HasCandidateKey));
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                bool sent = expected == ExecutionOutcome.ConfirmedSuccess || expected == ExecutionOutcome.ConfirmedFailure;
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(sent ? 1 : 0));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(sent || (bool)row["ownerDeclines"] ? 1 : 0));
                if (sent)
                {
                    Assert.That(result.Signature, Is.EqualTo(TransactionSignatures.ValidateFullySigned(Convert.FromBase64String((string)row["transaction"]["signed"]))));
                    var operations = graph.Calls.Select(call => call.Operation).ToList();
                    Assert.That(operations.IndexOf("commit-journal"), Is.LessThan(operations.IndexOf("sendTransaction")));
                    Assert.That(operations.IndexOf("clear-journal"), Is.GreaterThan(operations.FindIndex(value => value.StartsWith("observed-confirmed"))));
                }
                Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        [Test] public async Task SyntheticWalletHoldCannotPublishAcrossDisconnectOrCreateAnotherSubmission()
        {
            var graph = await Create("session-enable-success"); var flow = new MoneyAppFlow(graph.Services); var hold = graph.HoldNextWallet();
            try
            {
                await flow.Connect(graph.Owner); var action = flow.EnsureSession(); await hold.Entered;
                var disconnect = flow.Disconnect(); Assert.That(graph.Services.Identity.Owner, Is.Null);
                hold.Release();
                bool cancelled = false; try { await action; } catch (OperationCanceledException) { cancelled = true; }
                Assert.That(cancelled, Is.True); await disconnect;
                Assert.That(graph.Calls.Any(call => call.Operation == "sendTransaction"), Is.False);
                Assert.That(graph.HasActiveKey, Is.False); Assert.That(graph.HasCandidateKey, Is.True);
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); await flow.StopAsync(); }
        }
        [TestCase(false)]
        [TestCase(true)]
        public async Task InjectedReadbackFailureWaitsForConfirmedJournalClearAndFiresOnlyOnce(bool timeout)
        {
            var graph = await Create("session-disable-pending-success"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                if (timeout) graph.TimeoutFirstReadAfterJournalClear(); else graph.FailFirstReadAfterJournalClear();
                Assert.Throws<InvalidOperationException>(() => graph.FailFirstReadAfterJournalClear());
                await flow.Connect(graph.Owner);
                var pending = await graph.Services.SessionLifecycle.Revoke();
                Assert.That(pending.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                Assert.That(graph.HasActiveKey, Is.True);
                Assert.That(graph.Calls.Any(call => call.Operation == "injected-readback-failure-after-journal-clear"), Is.False);
                graph.ConfirmPendingSuccess();
                var receipt = (await flow.ResumePending()).Value;
                Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(receipt.Signature, Is.EqualTo(pending.Signature));
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                bool failed = false;
                try { await graph.Services.Rpc.ReadAccounts(graph.Services.Rpc.Base, new[] { graph.Owner }); }
                catch (IOException) when (!timeout) { failed = true; }
                catch (TaskCanceledException) when (timeout) { failed = true; }
                Assert.That(failed, Is.True);
                Assert.That((await graph.Services.Rpc.ReadAccounts(graph.Services.Rpc.Base, new[] { graph.Owner })).Accounts[0].Envelope, Is.Not.Null);
                var operations = graph.Calls.Select(call => call.Operation).ToList();
                string fault = timeout ? "injected-readback-timeout-after-journal-clear" : "injected-readback-failure-after-journal-clear";
                Assert.That(operations.Count(value => value == fault), Is.EqualTo(1));
                Assert.That(operations.IndexOf(fault), Is.GreaterThan(operations.IndexOf("clear-journal")));
                Assert.That(graph.HasActiveKey, Is.False); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        [Test] public async Task PostConfirmationCorruptionUsesActualTokenValidationAndDoesNotMutateCanonicalRows()
        {
            var graph = await Create("session-enable-success"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                graph.CorruptFirstReadAfterJournalClear(); await flow.Connect(graph.Owner);
                var receipt = await graph.Services.SessionLifecycle.EnableOrRenew();
                Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(await graph.Services.Journal.Load(graph.Owner), Is.Null);
                bool failed = false;
                try { await graph.Services.SessionLifecycle.Inspect(); } catch (FormatException) { failed = true; }
                Assert.That(failed, Is.True);
                var current = await graph.Services.SessionLifecycle.Inspect();
                Assert.That(current.Current, Is.True); Assert.That(current.Funding, Is.EqualTo("ready"));
                Assert.That(graph.Calls.Count(call => call.Operation == "injected-token-owner-after-journal-clear"), Is.EqualTo(1));
                Assert.That(graph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
                Assert.That(graph.HasActiveKey, Is.True); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
        [Test] public async Task PendingSessionCannotAdvanceBeforeAnObservedReceiptOrAsAnotherOutcome()
        {
            var graph = await Create("session-enable-pending-failure"); var flow = new MoneyAppFlow(graph.Services);
            try
            {
                Assert.Throws<InvalidOperationException>(() => graph.ConfirmPendingFailure()); await flow.Connect(graph.Owner);
                var pending = (await flow.EnsureSession()).Value; Assert.That(pending.Operation.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                Assert.Throws<InvalidOperationException>(() => graph.ConfirmPendingSuccess());
                var repeated = (await flow.EnsureSession()).Value;
                Assert.That(repeated.Action, Is.EqualTo("recover")); Assert.That(repeated.Operation.Signature, Is.EqualTo(pending.Operation.Signature));
                Assert.That(graph.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
                Assert.That(graph.HasCandidateKey, Is.True); Assert.That(graph.HasActiveKey, Is.False); Assert.That(graph.ForbiddenCalls, Is.Zero);
            }
            finally { await flow.StopAsync(); }
        }
    }
}
