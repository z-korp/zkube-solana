using ZKube.Integration.Tests;
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
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

namespace ZKube.Integration.App.Tests
{
    // Transport/native/storage are deterministic injected test doubles. Signed
    // bytes and account data come from the Rust program producer, with synthetic signatures applied by the test.
    public sealed partial class MoneyTestEnvironment
    {
        public static JObject Fixture(string name) => ZKube.Integration.Tests.ProgramScenarios.Load(name);
        public static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"], (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        public readonly JObject Plans = Fixture("plans"), Solana = Fixture("solana"), Runs = Fixture("runs");
        public readonly TestMemory Store = new TestMemory(); public readonly TestNative Native = new TestNative(); public readonly FakeHttp Http = new FakeHttp();
        public MoneyConnectionConfig Config; public MoneyClientServices Services;
        private MoneyAppFlow flow;
        public MoneyAppFlow Flow => flow ??= new MoneyAppFlow(Services);
        public long Now; public string Owner => (string)Plans["inputs"]["owner"];
        public MoneyTestEnvironment()
        {
            var rpc = Fixture("transport"); Config = new MoneyConnectionConfig((string)rpc["inputs"]["base"], (string)rpc["inputs"]["router"], (string)rpc["inputs"]["expectedGenesis"]);
            Http.Genesis = Config.ExpectedGenesis; Http.Er = (string)rpc["inputs"]["er"]; Http.Program = (string)rpc["inputs"]["program"]; Http.Validator = (string)Plans["inputs"]["validator"];
            Now = (long)Plans["inputs"]["now"]; Native.Owner = Owner; Http.Environment = this; Native.AllowCreation = () => UiScenario != null;
            Native.Reply = async request => {
                string operation = (string)request["operation"];
                if (UiScenario != null && operation == "signTransactions") return JObject.Parse(await SignOwner(request));
                if (operation == "signTransactions") throw new InvalidOperationException("No signing is allowed in this foreground fixture");
                if (operation == "authorize") { Native.Entered?.TrySetResult(true); if (Native.Release != null) await Native.Release.Task; }
                return new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(Native.Owner)) };
            }; Services = Create(Config);
            var publications = Fixture("plans");
            foreach (var name in new[] { "protocol", "daily" }) Http.Add(publications["accounts"][name]);
        }
        public MoneyClientServices Create(MoneyConnectionConfig config) => new MoneyClientServices(
            ZKube.Integration.Tests.TestBootstrap.ProtocolJson,
            ZKube.Integration.Tests.TestBootstrap.TokenJson, config, Http.Transport, Native, Store, () => Now, owner => new ZKube.Local.LocalProductStore(owner: owner));
        public void UseDailyRun()
        {
            Http.Add(Runs["player"]);
            foreach (var mode in new[] { "daily" })
            { var row = Runs["cases"].Single(x => (string)x["id"] == "active-" + mode + "-playing"); Http.Add(row); Http.Delegated.Add((string)row["address"]); }
        }
        public void AddEconomy()
        { foreach (var name in new[] { "protocol", "credit" }) Http.Add(Plans["accounts"][name]);
            Http.Add(Fixture("economy")["team"]); if (!Http.Accounts.ContainsKey(Services.Planner.Player(Owner))) Http.Add(Solana["accounts"].Single(x => (string)x["id"] == "player-valid")); }
        public PendingTransaction Purchase() => new PendingTransaction(Owner, "purchase-one", Config.BaseUri, true,
            Convert.FromBase64String((string)Solana["transactions"].Single(x => (string)x["id"] == "purchase-1")["signedTransaction"]), (string)Solana["inputs"]["blockhash"], 500);
        public async Task ReadySession()
        {
            Native.Seed = Enumerable.Repeat((byte)2, 32).ToArray(); var row = Plans["accounts"]["session"]; var token = Services.Tokens.Decode(Envelope(row));
            await ZKube.Integration.Tests.TestBootstrap.SeedSession(Services.Sessions, Owner, (string)Plans["inputs"]["device"], (string)row["address"], token.ValidUntil);
            Http.Add(row); Http.Add(new JObject { ["address"] = Plans["inputs"]["device"], ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["lamports"] = 5000000, ["data"] = "" });
        }
        public void AssertReadOnly() => Assert.That(Http.Requests.Any(x => new[] { "sendTransaction", "simulateTransaction", "getLatestBlockhash" }.Contains((string)x["method"])), Is.False);
        public sealed class FakeHttp
        {
            public readonly TestHttp Transport;
            public FakeHttp() { Transport = new TestHttp { Reply = Respond }; }

            public MoneyTestEnvironment Environment;
            public ConcurrentQueue<JObject> Requests => Transport.Requests; public readonly Dictionary<string, JToken> Accounts = new Dictionary<string, JToken>();
            public readonly HashSet<string> Delegated = new HashSet<string>();
            public string Genesis, Er, Program, Validator, Confirmation = "confirmed", DelayMethod, Blockhash;
            public bool AllowFeeQuote;
            public JToken StatusError;
            public bool ThrowOnCancellation;
            public int CancellationCallbacks;
            public TaskCompletionSource<bool> Entered, Release; public bool Disposed => Transport.Disposed;
            public void Add(JToken row) => Accounts[(string)row["address"]] = row.DeepClone();
            private async Task<JToken> Respond(Uri endpoint, JObject request, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested(); string method = (string)request["method"];
                using var registration = method == DelayMethod && ThrowOnCancellation ? cancellation.Register(() => {
                    Interlocked.Increment(ref CancellationCallbacks);
                    throw new InvalidOperationException("Injected cancellation callback: " + method);
                }) : default;
                if (method == DelayMethod) {
                    var release = Release; var entered = Entered; DelayMethod = null;
                    entered?.TrySetResult(true); if (release != null) await release.Task;
                }
                // Deliberately allow this fake callback to arrive after cancellation;
                // the real transport/flow must still reject publication.
                JToken Account(string address) => Accounts.TryGetValue(address, out var row) ? new JObject {
                    ["owner"] = row["owner"], ["executable"] = row["executable"], ["lamports"] = row["lamports"] ?? new JValue(5000000), ["data"] = new JArray(row["data"], "base64") } : JValue.CreateNull();

                JToken overridden = Environment.UiScenario == null ? null : await Environment.UiResponse(request);
                if (overridden != null) return overridden;
                JToken result;
                switch (method)
                {
                    case "getGenesisHash": result = new JValue(Genesis); break;
                    case "getMultipleAccounts": result = TestHttp.Context(new JArray(request["params"][0].Values<string>().Select(Account))); break;
                    case "getAccountInfo": result = TestHttp.Context(Account((string)request["params"][0])); break;
                    case "getSignatureStatuses": result = TestHttp.Context(new JArray { Confirmation == null ? JValue.CreateNull() : new JObject { ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = StatusError?.DeepClone() ?? JValue.CreateNull() } }); break;
                    case "getBlockHeight": result = new JValue(400); break;
                    case "getMinimumBalanceForRentExemption": result = new JValue(890880); break;
                    case "getLatestBlockhash" when AllowFeeQuote: result = TestHttp.Context(new JObject { ["blockhash"] = Blockhash, ["lastValidBlockHeight"] = 500 }); break;
                    case "getFeeForMessage" when AllowFeeQuote: result = TestHttp.Context(new JValue(5400)); break;
                    case "getBalance" when AllowFeeQuote: result = TestHttp.Context(new JValue(0)); break;
                    case "getDelegationStatus": result = Delegated.Contains((string)request["params"][0]) ? new JObject { ["isDelegated"] = true, ["fqdn"] = Er,
                        ["delegationRecord"] = new JObject { ["owner"] = Program, ["authority"] = Validator, ["delegationSlot"] = 900, ["lamports"] = 1 } } : new JObject { ["isDelegated"] = false }; break;
                    default: Environment.forbidden++; throw new InvalidOperationException("Unplanned offline RPC " + method);
                }
                return result;
            }
            public void Dispose() { Transport.Dispose(); }
        }
    }
}
