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
        public readonly MemoryStore Store = new MemoryStore(); public readonly FakeNative Native = new FakeNative(); public readonly FakeHttp Http = new FakeHttp();
        public MoneyConnectionConfig Config; public MoneyClientServices Services;
        private MoneyAppFlow flow;
        public MoneyAppFlow Flow => flow ??= new MoneyAppFlow(Services);
        public long Now; public string Owner => (string)Plans["inputs"]["owner"];
        public MoneyTestEnvironment()
        {
            var rpc = Fixture("transport"); Config = new MoneyConnectionConfig((string)rpc["inputs"]["base"], (string)rpc["inputs"]["router"], (string)rpc["inputs"]["expectedGenesis"]);
            Http.Genesis = Config.ExpectedGenesis; Http.Er = (string)rpc["inputs"]["er"]; Http.Program = (string)rpc["inputs"]["program"]; Http.Validator = (string)Plans["inputs"]["validator"];
            Now = (long)Plans["inputs"]["now"]; Native.Owner = Owner; Http.Environment = this; Native.Environment = this; Services = Create(Config);
            var publications = Fixture("plans");
            foreach (var name in new[] { "protocol", "daily" }) Http.Add(publications["accounts"][name]);
        }
        public MoneyClientServices Create(MoneyConnectionConfig config) => new MoneyClientServices(
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
            File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")), config, Http, Native, Store, () => Now, owner => new ZKube.Local.LocalProductStore(owner: owner));
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
            await Services.Sessions.Replace(await Services.Sessions.Load(Owner), new SessionRecords(Owner,
                new SessionRecord(Owner, (string)Plans["inputs"]["device"], (string)row["address"], token.ValidUntil)));
            Http.Add(row); Http.Add(new JObject { ["address"] = Plans["inputs"]["device"], ["owner"] = PlanningConstants.SystemProgram, ["executable"] = false, ["lamports"] = 5000000, ["data"] = "" });
        }
        public void AssertReadOnly() => Assert.That(Http.Requests.Any(x => new[] { "sendTransaction", "simulateTransaction", "getLatestBlockhash" }.Contains((string)x["method"])), Is.False);
        public static async Task<T> Fails<T>(Func<Task> call) where T : Exception
        { try { await call(); } catch (T error) { return error; } Assert.Fail("Expected " + typeof(T).Name); return null; }
        public sealed class MemoryStore : IPublicClientStore, IDisposable
        {
            private readonly Dictionary<string, string> values = new Dictionary<string, string>(); public int Calls; public bool Disposed;
            public Task<string> Read(string owner, string field) { lock (values) { Calls++; values.TryGetValue(owner + field, out var value); return Task.FromResult(value); } }
            public Task Write(string owner, string field, string value) { lock (values) { Calls++; values[owner + field] = value; } return Task.CompletedTask; }
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            { lock (values) { Calls++; values.TryGetValue(owner + field, out var prior); if (prior != expected) return Task.FromResult(false); values[owner + field] = value; return Task.FromResult(true); } }
            public void Dispose() { Disposed = true; }
        }
        public sealed class FakeNative : INativeWalletTransport, IDisposable
        {
            public MoneyTestEnvironment Environment; public readonly ConcurrentQueue<string> Operations = new ConcurrentQueue<string>();
            public string Owner; public int Calls, KeyLoads, Creations; public byte[] Seed; public bool Disposed;
            public TaskCompletionSource<bool> Entered, Release;
            public async Task<string> Request(string json)
            {
                Calls++; var request = JObject.Parse(json); string operation = (string)request["operation"]; Operations.Enqueue(operation);
                if (Environment.UiScenario != null && operation == "signTransactions") return await Environment.SignOwner(request);
                if (operation == "signTransactions") throw new InvalidOperationException("No signing is allowed in this foreground fixture");
                if (operation == "authorize") { Entered?.TrySetResult(true); if (Release != null) await Release.Task; }
                return new JObject { ["requestId"] = request["requestId"], ["ok"] = true,
                    ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(Owner)) }.ToString();
            }
            public Task<byte[]> LoadDeviceSeed(bool create)
            {
                KeyLoads++;
                if (create && Seed == null)
                {
                    if (Environment.UiScenario == null) throw new InvalidOperationException("Unexpected device key creation");
                    Seed = Enumerable.Repeat((byte)2, 32).ToArray(); Creations++;
                }
                return Task.FromResult(Seed?.ToArray());
            }
            public void Dispose() { Disposed = true; }
        }
        public sealed class FakeHttp : IJsonRpcHttp, IDisposable
        {
            public MoneyTestEnvironment Environment;
            public readonly ConcurrentQueue<JObject> Requests = new ConcurrentQueue<JObject>(); public readonly Dictionary<string, JToken> Accounts = new Dictionary<string, JToken>();
            public readonly HashSet<string> Delegated = new HashSet<string>();
            public string Genesis, Er, Program, Validator, Confirmation = "confirmed", DelayMethod, Blockhash;
            public bool AllowFeeQuote;
            public JToken StatusError;
            public bool ThrowOnCancellation;
            public int CancellationCallbacks;
            public TaskCompletionSource<bool> Entered, Release; public bool Disposed;
            public void Add(JToken row) => Accounts[(string)row["address"]] = row.DeepClone();
            public async Task<string> Post(Uri endpoint, string json, int maximum, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested(); var request = JObject.Parse(json); string method = (string)request["method"];
                request["endpoint"] = endpoint.AbsoluteUri; Requests.Enqueue(request);
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
                JObject Context(JToken value) => new JObject { ["context"] = new JObject { ["slot"] = 1000 }, ["value"] = value };
                JToken overridden = Environment.UiScenario == null ? null : await Environment.UiResponse(request);
                if (overridden != null) return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = overridden }.ToString();
                JToken result;
                switch (method)
                {
                    case "getGenesisHash": result = new JValue(Genesis); break;
                    case "getMultipleAccounts": result = Context(new JArray(request["params"][0].Values<string>().Select(Account))); break;
                    case "getAccountInfo": result = Context(Account((string)request["params"][0])); break;
                    case "getSignatureStatuses": result = Context(new JArray { Confirmation == null ? JValue.CreateNull() : new JObject { ["slot"] = 990, ["confirmationStatus"] = Confirmation, ["err"] = StatusError?.DeepClone() ?? JValue.CreateNull() } }); break;
                    case "getBlockHeight": result = new JValue(400); break;
                    case "getMinimumBalanceForRentExemption": result = new JValue(890880); break;
                    case "getLatestBlockhash" when AllowFeeQuote: result = Context(new JObject { ["blockhash"] = Blockhash, ["lastValidBlockHeight"] = 500 }); break;
                    case "getFeeForMessage" when AllowFeeQuote: result = Context(new JValue(5400)); break;
                    case "getBalance" when AllowFeeQuote: result = Context(new JValue(0)); break;
                    case "getDelegationStatus": result = Delegated.Contains((string)request["params"][0]) ? new JObject { ["isDelegated"] = true, ["fqdn"] = Er,
                        ["delegationRecord"] = new JObject { ["owner"] = Program, ["authority"] = Validator, ["delegationSlot"] = 900, ["lamports"] = 1 } } : new JObject { ["isDelegated"] = false }; break;
                    default: Environment.forbidden++; throw new InvalidOperationException("Unplanned offline RPC " + method);
                }
                return new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
            }
            public void Dispose() { Disposed = true; }
        }
    }
}
