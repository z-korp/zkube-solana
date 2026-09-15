using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Integration.Transport.Tests
{
    public sealed class RpcAgreementTests
    {
        private JObject fixture;
        private FakeHttp http;
        private SolanaRpcTransport rpc;
        private string address;
        private byte[] transaction;
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/unity-rpc-v1.json"))));
        private sealed class FakeHttp : IJsonRpcHttp
        {
            public Func<Uri, JObject, JToken> Result;
            public Func<Uri, JObject, string> Raw;
            public readonly List<JObject> Requests = new List<JObject>();
            public Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                cancellation.ThrowIfCancellationRequested();
                var request = JObject.Parse(json);
                Requests.Add(new JObject { ["endpoint"] = endpoint.AbsoluteUri, ["method"] = request["method"], ["params"] = request["params"].DeepClone() });
                return Task.FromResult(Raw != null ? Raw(endpoint, request) : new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = Result(endpoint, request) }.ToString(Formatting.None));
            }
        }
        [SetUp]
        public void Setup()
        {
            fixture = Fixture(); var inputs = fixture["inputs"];
            address = (string)inputs["address"]; transaction = Convert.FromBase64String((string)inputs["transaction"]);
            http = new FakeHttp { Result = DefaultResult };
            rpc = NewTransport();
        }
        private SolanaRpcTransport NewTransport() => new SolanaRpcTransport(http, (string)fixture["inputs"]["base"],
            (string)fixture["inputs"]["router"], (string)fixture["inputs"]["expectedGenesis"], (string)fixture["inputs"]["program"]);
        private JToken DefaultResult(Uri endpoint, JObject request)
        {
            string method = (string)request["method"];
            if (method == "getGenesisHash") return fixture["inputs"]["expectedGenesis"].DeepClone();
            if (method == "getDelegationStatus") return fixture["routing"][0]["status"].DeepClone();
            if (method == "getAccountInfo") return new JObject { ["context"] = new JObject { ["slot"] = 123 }, ["value"] = fixture["routing"][0]["erAccount"].DeepClone() };
            if (method == "getLatestBlockhash") return fixture["cases"].Single(row => (string)row["id"] == "base-blockhash")["result"].DeepClone();
            throw new InvalidOperationException("Unexpected RPC " + method);
        }
        public static IEnumerable<TestCaseData> Cases()
        {
            var fixture = Fixture();
            var operations = fixture["cases"].Select(row => (string)row["input"]["operation"]).ToHashSet();
            foreach (string required in new[] { "genesis", "blockhash", "fee", "balance", "rent", "height", "account", "accounts", "simulate", "send", "status", "validator", "placement" })
                Assert.That(operations, Does.Contain(required));
            foreach (var row in fixture["cases"]) yield return new TestCaseData((string)row["id"]).SetName("RPC_" + row["id"]);
        }

        [TestCaseSource(nameof(Cases))]
        public async Task ActualWeb3AndClientRequestsAgree(string id)
        {
            var row = fixture["cases"].Single(value => (string)value["id"] == id); var input = row["input"];
            string operation = (string)input["operation"];
            RpcEndpoint endpoint = (string)input["route"] == "er" ? await rpc.ResolveEr(address) : rpc.Base;
            RpcBlockhash lease = operation == "simulate" || operation == "send" ? await rpc.LatestBlockhash(endpoint) : null;
            if (operation != "genesis") await rpc.VerifyBase();
            http.Requests.Clear(); http.Result = (_, __) => row["result"].DeepClone();
            JToken actual = null;
            switch (operation)
            {
                case "genesis": await rpc.VerifyBase(); actual = fixture["inputs"]["expectedGenesis"]; break;
                case "blockhash": var hash = await rpc.LatestBlockhash(endpoint); actual = new JObject { ["blockhash"] = hash.Blockhash, ["lastValidBlockHeight"] = hash.LastValidBlockHeight }; break;
                case "fee": actual = await rpc.FeeForMessage(endpoint, Convert.FromBase64String((string)fixture["inputs"]["message"])); break;
                case "balance": actual = await rpc.Balance(endpoint, (string)input["address"]); break;
                case "rent": actual = await rpc.RentFloor(endpoint, (uint)input["bytes"]); break;
                case "height": actual = await rpc.BlockHeight(endpoint); break;
                case "account":
                    var account = await rpc.ReadAccount(endpoint, (string)input["address"], minContextSlot: (ulong?)input["minContextSlot"]);
                    Assert.That(account.Slot, Is.EqualTo((ulong)row["result"]["context"]["slot"])); actual = Account(account); break;
                case "accounts":
                    var addresses = input["addresses"].Values<string>().ToArray();
                    var batch = (bool?)input["historical"] == true
                        ? await rpc.HistoricalAccounts(endpoint.Address.AbsoluteUri, endpoint.IsBase, addresses, minContextSlot: (ulong?)input["minContextSlot"])
                        : await rpc.ReadAccounts(endpoint, addresses, minContextSlot: (ulong?)input["minContextSlot"]);
                    Assert.That(batch.Slot, Is.EqualTo((ulong)row["result"]["context"]["slot"]));
                    actual = new JArray(batch.Accounts.Select(Account)); break;
                case "simulate": var simulation = await rpc.Simulate(endpoint, transaction, lease); actual = new JObject {
                    ["err"] = simulation.ErrorJson == null ? JValue.CreateNull() : JToken.Parse(simulation.ErrorJson), ["logs"] = new JArray(simulation.Logs), ["unitsConsumed"] = simulation.UnitsConsumed }; break;
                case "send": actual = await rpc.Send(endpoint, transaction, (string)input["policy"] == "erSession" ? RpcSubmissionPolicy.ErSession : RpcSubmissionPolicy.Wallet, lease); break;
                case "status":
                    var status = (bool?)input["historical"] == true
                        ? await rpc.HistoricalSignatureStatus(endpoint.Address.AbsoluteUri, endpoint.IsBase, (string)input["signature"])
                        : await rpc.SignatureStatus(endpoint, (string)input["signature"]);
                    var expected = row["output"];
                    Assert.That(status.ContextSlot, Is.EqualTo((ulong)row["result"]["context"]["slot"]));
                    Assert.That(status.Confirmation, Is.EqualTo(expected.Type == JTokenType.Null ? RpcConfirmation.Missing :
                        expected["confirmationStatus"] == null ? RpcConfirmation.Unknown :
                        (RpcConfirmation)Enum.Parse(typeof(RpcConfirmation), (string)expected["confirmationStatus"], true)));
                    if (expected.Type != JTokenType.Null) Assert.That(status.Slot, Is.EqualTo((ulong)expected["slot"]));
                    Assert.That(status.ErrorJson, Is.EqualTo(expected.Type == JTokenType.Null || expected["err"].Type == JTokenType.Null ? null : expected["err"].ToString(Formatting.None)));
                    actual = expected; break;
                case "validator": var validator = await rpc.ClosestValidator(); actual = new JObject { ["identity"] = validator.Identity, ["fqdn"] = validator.Endpoint }; break;
                case "placement":
                    var placement = await rpc.Placement((string)input["address"]);
                    Assert.That(placement.IsDelegated, Is.EqualTo((bool)row["output"]["isDelegated"]));
                    Assert.That(placement.Endpoint, Is.EqualTo((string)row["output"]["fqdn"]));
                    Assert.That(placement.RecordOwner, Is.EqualTo((string)row["output"]["delegationRecord"]?["owner"])); actual = row["output"]; break;
                default: Assert.Fail("Unknown fixture operation"); break;
            }
            Assert.That(JToken.DeepEquals(actual ?? JValue.CreateNull(), row["output"]), Is.True, id + " output differs: " + actual);
            Assert.That(JToken.DeepEquals(new JArray(http.Requests), row["requests"]), Is.True, id + " request differs: " + new JArray(http.Requests));
        }
        private static JToken Account(RpcAccount account) => account.Envelope == null ? JValue.CreateNull() : new JObject { ["slot"] = account.Slot,
            ["owner"] = account.Envelope.Owner, ["data"] = Convert.ToBase64String(account.Envelope.Data), ["lamports"] = account.Lamports, ["executable"] = account.Envelope.Executable };

        private static async Task ExpectFailure<T>(Func<Task> action) where T : Exception
        {
            Exception failure = null;
            try { await action(); } catch (Exception error) { failure = error; }
            Assert.That(failure, Is.InstanceOf<T>());
        }

        [Test]
        public async Task RouterDecisionsMatchActualWaitForDelegation()
        {
            foreach (var row in fixture["routing"])
            {
                rpc = NewTransport();
                http.Result = (endpoint, request) => (string)request["method"] == "getDelegationStatus" ? row["status"].DeepClone() :
                    (string)request["method"] == "getAccountInfo" ? new JObject { ["context"] = new JObject { ["slot"] = 123 }, ["value"] = row["erAccount"].DeepClone() } : DefaultResult(endpoint, request);
                bool accepted;
                try { await rpc.ResolveEr(address); accepted = true; } catch (FormatException) { accepted = false; }
                Assert.That(accepted, Is.EqualTo((bool)row["accepted"]), (string)row["id"]);
            }
        }

        [Test]
        public async Task WrongGenesisPreventsEveryDependentCall()
        {
            http.Result = (_, __) => address;
            await ExpectFailure<FormatException>(async () => await rpc.ReadBase(address));
            Assert.That(http.Requests.Select(row => (string)row["method"]), Is.EqualTo(new[] { "getGenesisHash" }));
        }

        [Test]
        public async Task MalformedResponsesAndAccountBoundsAreRejected()
        {
            await rpc.VerifyBase();
            http.Raw = (_, request) => new JObject { ["jsonrpc"] = "2.0", ["id"] = (long)request["id"] + 1, ["result"] = null }.ToString();
            await ExpectFailure<FormatException>(async () => await rpc.ReadBase(address));
            http.Raw = null;
            var result = (JObject)DefaultResult(new Uri((string)fixture["inputs"]["base"]), new JObject { ["method"] = "getAccountInfo" });
            result["value"]["data"][0] = "AQID";
            http.Result = (_, __) => result.DeepClone();
            await ExpectFailure<FormatException>(async () => await rpc.ReadAccount(rpc.Base, address, 2));
            result["value"]["data"][0] = "AQID\n";
            await ExpectFailure<FormatException>(async () => await rpc.ReadBase(address));
            result["value"]["data"][0] = "AQID"; result["value"]["lamports"] = JToken.Parse("9007199254740993");
            Assert.That((await rpc.ReadAccount(rpc.Base, address)).Lamports, Is.EqualTo(9007199254740993UL));
            await ExpectFailure<FormatException>(async () => await rpc.ReadAccount(rpc.Base, address, minContextSlot: 124));
        }

        [Test]
        public async Task StaleNullBatchesCannotProveAbsenceAfterAConfirmedAction()
        {
            await rpc.VerifyBase();
            http.Result = (_, __) => new JObject { ["context"] = new JObject { ["slot"] = 123 }, ["value"] = new JArray(JValue.CreateNull()) };
            await ExpectFailure<FormatException>(async () => await rpc.ReadAccounts(rpc.Base, new[] { address }, minContextSlot: 124));
            await ExpectFailure<FormatException>(async () => await rpc.HistoricalAccounts("https://old-er.zkube.invalid/", false, new[] { address }, minContextSlot: 124));
            var observation = await rpc.HistoricalAccounts("https://old-er.zkube.invalid/", false, new[] { address }, minContextSlot: 123);
            Assert.That(observation.Slot, Is.EqualTo(123UL));
            Assert.That(observation.Accounts.Single().Envelope, Is.Null);
            Assert.That(observation.Accounts.Single().Slot, Is.EqualTo(123UL));
            await ExpectFailure<InvalidOperationException>(async () => await rpc.ReadEr("https://old-er.zkube.invalid/", address));
        }

        [Test]
        public async Task BlockhashLeasesCannotCrossEndpointsOrChangedPlacement()
        {
            var er = await rpc.ResolveEr(address); var lease = await rpc.LatestBlockhash(rpc.Base);
            await ExpectFailure<InvalidOperationException>(async () => await rpc.Simulate(er, transaction, lease));
            var erLease = await rpc.LatestBlockhash(er);
            http.Result = (endpoint, request) => (string)request["method"] == "getDelegationStatus" ? new JObject { ["isDelegated"] = false } : DefaultResult(endpoint, request);
            await rpc.Placement(address);
            await ExpectFailure<InvalidOperationException>(async () => await rpc.Send(er, transaction, RpcSubmissionPolicy.ErSession, erLease));
            await ExpectFailure<InvalidOperationException>(async () => await rpc.Send(rpc.Base, transaction, RpcSubmissionPolicy.ErSession, lease));
        }

        [Test]
        public async Task UnknownSendOutcomeIsNeverRetriedAndWrongReturnedSignatureIsRejected()
        {
            var lease = await rpc.LatestBlockhash(rpc.Base); http.Requests.Clear();
            http.Result = (_, __) => throw new IOException("Connection dropped after submission");
            await ExpectFailure<IOException>(async () => await rpc.Send(rpc.Base, transaction, RpcSubmissionPolicy.Wallet, lease));
            Assert.That(http.Requests.Count, Is.EqualTo(1));
            http.Result = (_, __) => new string('1', 64);
            await ExpectFailure<FormatException>(async () => await rpc.Send(rpc.Base, transaction, RpcSubmissionPolicy.Wallet, lease));
        }

        [Test]
        public async Task HistoricalStatusProbesDoNotCreateASendRoute()
        {
            http.Result = (endpoint, request) => (string)request["method"] == "getSignatureStatuses" ? new JObject { ["context"] = new JObject { ["slot"] = 1 }, ["value"] = new JArray(JValue.CreateNull()) } :
                (string)request["method"] == "getBlockHeight" ? new JValue(1000) : DefaultResult(endpoint, request);
            Assert.That((await rpc.HistoricalSignatureStatus("https://old-er.zkube.invalid/", false, (string)fixture["inputs"]["signature"])).Confirmation, Is.EqualTo(RpcConfirmation.Missing));
            Assert.That(await rpc.HistoricalBlockHeight("https://old-er.zkube.invalid/", false), Is.EqualTo(1000UL));
            await ExpectFailure<ArgumentException>(async () => await rpc.HistoricalBlockHeight((string)fixture["inputs"]["router"], false));
            await ExpectFailure<InvalidOperationException>(async () => await rpc.ReadEr("https://old-er.zkube.invalid/", address));
        }
    }
}
