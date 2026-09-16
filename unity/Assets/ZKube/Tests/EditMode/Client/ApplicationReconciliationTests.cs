using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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

namespace ZKube.Integration.Tests
{
    public sealed class ApplicationReconciliationTests
    {
        private static JObject Fixture(string name) => ZKube.Integration.Tests.ProgramScenarios.Load(name);
        private sealed class Http : IJsonRpcHttp
        {
            public readonly Dictionary<string, JToken> Accounts = new Dictionary<string, JToken>();
            public readonly List<JObject> Requests = new List<JObject>();
            public string Confirmation = "confirmed";
            public JToken Error;
            public ulong AccountSlot = 1000, Height = 400;
            public string Genesis;
            public async Task<string> Post(Uri endpoint, string json, int limit, CancellationToken cancellation)
            {
                await Task.Yield(); cancellation.ThrowIfCancellationRequested();
                var request = JObject.Parse(json); Requests.Add(request); JToken result;
                JObject Context(JToken value, ulong slot = 1000) => new JObject { ["context"] = new JObject { ["slot"] = slot }, ["value"] = value };
                switch ((string)request["method"])
                {
                    case "getGenesisHash": result = new JValue(Genesis); break;
                    case "getSignatureStatuses": result = Context(new JArray(Confirmation == null ? JValue.CreateNull() : new JObject {
                        ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = Error?.DeepClone() ?? JValue.CreateNull() })); break;
                    case "getBlockHeight": result = new JValue(Height); break;
                    case "getMultipleAccounts":
                        result = Context(new JArray(request["params"][0].Values<string>().Select(address => Accounts.TryGetValue(address, out var value) ? value.DeepClone() : JValue.CreateNull())), AccountSlot); break;
                    default: throw new InvalidOperationException("Offline recovery must never sign, send, or obtain a new blockhash: " + request["method"]);
                }
                return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
            }
            public void Add(JToken envelope) => Accounts[(string)envelope["address"]] = new JObject { ["owner"] = envelope["owner"],
                ["executable"] = envelope["executable"], ["lamports"] = 5000000, ["data"] = new JArray(envelope["data"], "base64") };
        }
        [Test]
        public async Task SignedRenewalResumesPublicSaveBeforeJournalRemoval()
        {
            var plans = Fixture("device"); var solana = Fixture("solana"); var rpcFixture = Fixture("transport");
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            string idl = File.ReadAllText(Path.Combine(generated, "solana.json")); var protocol = new ProtocolBindings(idl);
            var accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json"))); var planner = new TransactionPlanner(protocol, tokens);
            string owner = (string)plans["inputs"]["owner"];
            foreach (var plan in plans["cases"])
            {
                var store = new SessionRecordTests.Store(); var native = new SessionRecordTests.Native(); var records = new SessionRecordStore(store, tokens, protocol.ProgramId);
                var old = new SessionRecord(owner, (string)plans["inputs"]["device"], (string)plan["oldToken"]["address"], (long)plans["inputs"]["now"] + (long)plan["remaining"]);
                var renewed = new SessionRecord(owner, (string)plans["inputs"]["device"], (string)plans["renewedToken"]["address"], (long)plans["renewedToken"]["validUntil"]);
                await records.Replace(await records.Load(owner), new SessionRecords(owner, old));
                var http = new Http { Genesis = (string)rpcFixture["inputs"]["expectedGenesis"] };
                http.Add(solana["accounts"].Single(row => (string)row["id"] == "player-valid")); http.Add(plans["renewedToken"]);
                var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], http.Genesis, protocol.ProgramId);
                var journal = new TransactionJournal(store);
                var pending = new PendingTransaction(owner, "session-renew", (string)rpcFixture["inputs"]["base"], true,
                    Convert.FromBase64String((string)plan["signedTransaction"]), (string)plans["inputs"]["blockhash"], 500);
                await journal.Begin(pending);
                var reconciler = new ExecutionReconciler(protocol, accounts, tokens, records, planner, rpc, _ => Task.CompletedTask, _ => Task.CompletedTask);
                TransactionExecutor Restart() => new TransactionExecutor(planner, rpc, new WalletClient(native), journal);
                http.AccountSlot = 999;
                Assert.That((await Restart().Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                Assert.That((await records.Load(owner)).Active.ValidUntil, Is.EqualTo(old.ValidUntil));
                http.AccountSlot = 1000; http.Accounts[renewed.Token]["owner"] = owner;
                Assert.That((await Restart().Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                http.Add(plans["renewedToken"]); store.FailBeforeCommit = true;
                Assert.That((await Restart().Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.Pending));
                Assert.That((await records.Load(owner)).Active.ValidUntil, Is.EqualTo(old.ValidUntil));
                Assert.That(await journal.Load(owner), Is.Not.Null); store.FailBeforeCommit = false;
                Assert.That((await Restart().Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That((await records.Load(owner)).Active.ValidUntil, Is.EqualTo(renewed.ValidUntil)); Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(renewed.Signer));
                Assert.That(await journal.Load(owner), Is.Null);
            }
        }
        [Test]
        public async Task FailedRenewalRetainsThePreviousExpiryAndInstallKey()
        {
            var plans = Fixture("device"); var rpcFixture = Fixture("transport");
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            string idl = File.ReadAllText(Path.Combine(generated, "solana.json")); var protocol = new ProtocolBindings(idl);
            var accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json"))); var planner = new TransactionPlanner(protocol, tokens);
            string owner = (string)plans["inputs"]["owner"]; var plan = plans["cases"].Single(value => (long)value["remaining"] == 61 && (ulong)value["balance"] == 0);
            var store = new SessionRecordTests.Store(); var native = new SessionRecordTests.Native(); var records = new SessionRecordStore(store, tokens, protocol.ProgramId);
            var old = new SessionRecord(owner, (string)plans["inputs"]["device"], (string)plan["oldToken"]["address"], (long)plans["inputs"]["now"] + 61);
            await records.Replace(await records.Load(owner), new SessionRecords(owner, old));
            var http = new Http { Genesis = (string)rpcFixture["inputs"]["expectedGenesis"], Confirmation = "processed", Error = new JObject { ["InstructionError"] = new JArray(0, "InvalidArgument") } };
            http.Add(plan["oldToken"]);
            var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], http.Genesis, protocol.ProgramId);
            var journal = new TransactionJournal(store);
            await journal.Begin(new PendingTransaction(owner, "session-renew", (string)rpcFixture["inputs"]["base"], true,
                Convert.FromBase64String((string)plan["signedTransaction"]), (string)plans["inputs"]["blockhash"], 500));
            var reconciler = new ExecutionReconciler(protocol, accounts, tokens, records, planner, rpc, _ => Task.CompletedTask, _ => Task.CompletedTask);
            var executor = new TransactionExecutor(planner, rpc, new WalletClient(native), journal);
            Assert.That((await executor.Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            http.Confirmation = "confirmed";
            Assert.That((await executor.Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
            Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(old.Signer));
            Assert.That((await records.Load(owner)).Active.ValidUntil, Is.EqualTo(old.ValidUntil)); Assert.That(await journal.Load(owner), Is.Null);
        }

        [Test]
        public async Task PurchaseValidatesFreshAccountsAndAwaitsInvalidationBeforeClearingJournal()
        {
            var solana = Fixture("solana"); var plans = Fixture("plans"); var economy = Fixture("economy"); var rpcFixture = Fixture("transport");
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            string idl = File.ReadAllText(Path.Combine(generated, "solana.json")); var protocol = new ProtocolBindings(idl);
            var accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json"))); var planner = new TransactionPlanner(protocol, tokens);
            string owner = (string)solana["inputs"]["owner"];
            var store = new SessionRecordTests.Store(); var journal = new TransactionJournal(store);
            var http = new Http { Genesis = (string)rpcFixture["inputs"]["expectedGenesis"] };
            var profile = solana["accounts"].Single(row => (string)row["id"] == "player-valid"); http.Add(profile);
            foreach (string name in new[] { "protocol", "credit" }) http.Add(plans["accounts"][name]); http.Add(economy["team"]);
            var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], http.Genesis, protocol.ProgramId);
            var transaction = solana["transactions"].Single(row => (string)row["id"] == "purchase-1");
            await journal.Begin(new PendingTransaction(owner, "purchase-kredits", (string)rpcFixture["inputs"]["base"], true,
                Convert.FromBase64String((string)transaction["signedTransaction"]), (string)solana["inputs"]["blockhash"], 500));
            string accepted = null;
            var entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var reconciler = new ExecutionReconciler(protocol, accounts, tokens, new SessionRecordStore(store, tokens, protocol.ProgramId), planner, rpc, async value => { accepted = value; entered.SetResult(true); await release.Task; }, _ => Task.CompletedTask);
            var executor = new TransactionExecutor(planner, rpc, new WalletClient(new SessionRecordTests.Native()), journal);
            var result = executor.Resume(owner, reconciler); await entered.Task;
            Assert.That(await journal.Load(owner), Is.Not.Null); Assert.That(accepted, Is.EqualTo(owner));
            release.SetResult(true);
            Assert.That((await result).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess)); Assert.That(await journal.Load(owner), Is.Null);
            Assert.That(http.Requests.Where(row => (string)row["method"] == "getMultipleAccounts").All(row => (ulong)row["params"][1]["minContextSlot"] == 1000), Is.True);
        }

        [Test]
        public async Task ClaimRejectsWrongBoardOwnerThenUsesClaimedBitmapOrFreshArchivalAbsence()
        {
            var solana = Fixture("solana"); var economy = Fixture("economy"); var rpcFixture = Fixture("transport");
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            string idl = File.ReadAllText(Path.Combine(generated, "solana.json")); var protocol = new ProtocolBindings(idl);
            var accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json"))); var planner = new TransactionPlanner(protocol, tokens);
            string owner = (string)solana["inputs"]["owner"];
            foreach (string outcome in new[] { "claimed", "removed", "expired" })
            {
                var store = new SessionRecordTests.Store(); var journal = new TransactionJournal(store);
                var board = economy[outcome == "expired" ? "oldScore" : "claimedBoard"];
                var daily = economy[outcome == "expired" ? "oldDaily" : "claimDaily"];
                string signedClaim = outcome == "expired" ? (string)economy["oldScoreTransaction"] : (string)economy["claim"]["signedTransaction"];
                var http = new Http { Genesis = (string)rpcFixture["inputs"]["expectedGenesis"] };
                http.Add(solana["accounts"].Single(row => (string)row["id"] == "player-valid"));
                http.Add(daily); http.Add(board);
                var rpc = new SolanaRpcTransport(http, (string)rpcFixture["inputs"]["base"], (string)rpcFixture["inputs"]["router"], http.Genesis, protocol.ProgramId);
                await journal.Begin(new PendingTransaction(owner, "claim-daily", (string)rpcFixture["inputs"]["base"], true,
                    Convert.FromBase64String(signedClaim), (string)solana["inputs"]["blockhash"], 500));
                string accepted = null;
                var reconciler = new ExecutionReconciler(protocol, accounts, tokens, new SessionRecordStore(store, tokens, protocol.ProgramId), planner, rpc, value => { accepted = value; return Task.CompletedTask; }, _ => Task.CompletedTask);
                var executor = new TransactionExecutor(planner, rpc, new WalletClient(new SessionRecordTests.Native()), journal);
                http.Accounts[(string)board["address"]]["owner"] = owner;
                Assert.That((await executor.Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(accepted, Is.Null);
                if (outcome == "removed")
                { http.Accounts.Remove((string)board["address"]); http.Accounts.Remove((string)daily["address"]); }
                else http.Add(board);
                Assert.That((await executor.Resume(owner, reconciler)).Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(accepted, Is.EqualTo(owner));
                Assert.That(await journal.Load(owner), Is.Null);
            }
        }
    }
}
