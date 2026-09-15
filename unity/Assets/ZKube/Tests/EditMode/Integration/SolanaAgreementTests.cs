using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Core;

namespace ZKube.Integration.Tests
{
    public sealed class SolanaAgreementTests
    {
        private JObject fixture, idl;
        private ProtocolBindings protocol;
        private SessionTokenBindings session;
        [OneTimeSetUp]
        public void LoadCheckedInOracles()
        {
            fixture = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/unity-solana-v1.json"))));
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            string idlText = File.ReadAllText(Path.Combine(generated, "solana.json"));
            idl = JObject.Parse(idlText); protocol = new ProtocolBindings(idlText);
            session = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
        }

        [Test]
        public void DailyPublicationMatchesTypeScriptWasmAndGeneratedNativeBindings()
        {
            var expected = fixture["dailyAuthority"];
            var coreFixture = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(
                Application.dataPath, "../../fixtures/native-run-trajectories.json"))));
            Assert.That(JToken.DeepEquals(expected, coreFixture["dailyPublication"]), Is.True,
                "Actual TS/WASM publication must equal the checked Rust codegen output");
            uint day = (uint)expected["day"];
            Assert.That(day, Is.EqualTo(20705U), "Retain the day that exposed the publication fixture defect");
            uint pair = NativeEngine.DailyPairIndex(day);
            Assert.That(pair, Is.EqualTo((uint)expected["pairIndex"]));
            Assert.That(Protocol.CatalogVersion, Is.EqualTo((uint)expected["contentVersion"]));
            Assert.That(Protocol.DailyMaxMoves, Is.EqualTo((uint)expected["maxMoves"]));
            Assert.That(pair / Protocol.DailyThemes.Length + 1, Is.EqualTo((uint)expected["realm"]));
            var objective = Protocol.DailyThemes[pair % Protocol.DailyThemes.Length];
            Assert.That(objective[0], Is.EqualTo((byte)expected["objective"]["kind"]));
            Assert.That(objective[1], Is.EqualTo((byte)expected["objective"]["value"]));
        }

        [Test]
        public void AllProtocolAddressesMatchWeb3IncludingU64AboveJavascriptSafeRange()
        {
            foreach (var row in fixture["pdas"])
            {
                string actual = SolanaAddress.Derive((string)row["program"], row["seeds"].Values<string>().Select(Convert.FromBase64String), out byte bump);
                Assert.That(actual, Is.EqualTo((string)row["address"]), (string)row["id"]);
                Assert.That(bump, Is.EqualTo((byte)row["bump"]), (string)row["id"]);
            }
        }

        [TestCase("en-US")]
        [TestCase("tr-TR")]
        [TestCase("fr-FR")]
        public void BothMessageFormatsMatchActualPlannersRegardlessOfDeviceCulture(string culture)
        {
            var prior = CultureInfo.CurrentCulture;
            try
            {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo(culture);
                foreach (var row in fixture["transactions"])
                {
                    var instructions = row["instructions"].Select(ReadInstruction).ToArray();
                    var message = SolanaWire.CompileMessage((string)row["feePayer"], (string)row["blockhash"], instructions, (string)row["version"] == "v0");
                    Assert.That(Convert.ToBase64String(message), Is.EqualTo((string)row["message"]), (string)row["id"]);
                    Assert.That(SolanaWire.UnsignedTransaction(message).Length, Is.LessThanOrEqualTo(SolanaWire.PacketBytes));
                }
            }
            finally { CultureInfo.CurrentCulture = prior; }
        }

        [Test]
        public void GeneratedIdlEncodesActualPlannerArgumentsAndAccountRoles()
        {
            foreach (var row in fixture["transactions"])
            {
                string name = (string)row["instructionName"];
                var expected = ReadInstruction(row["instructions"].Last());
                SolanaInstruction actual;
                if (name == "create_session_v2")
                {
                    var inputs = fixture["inputs"];
                    actual = session.Create((string)inputs["owner"], (string)inputs["device"], (string)inputs["owner"],
                        protocol.ProgramId, (bool?)row["args"]["top_up"], (long?)row["args"]["valid_until"], (ulong?)row["args"]["lamports"]);
                }
                else
                {
                    var descriptor = idl["instructions"].Single(item => (string)item["name"] == name);
                    var accounts = descriptor["accounts"].Select((item, index) => new { Name = (string)item["name"], Address = expected.Accounts[index].Address })
                        .ToDictionary(item => item.Name, item => item.Address);
                    actual = protocol.Instruction(name, (JObject)row["args"], accounts);
                }
                Assert.That(actual.ProgramId, Is.EqualTo(expected.ProgramId), name);
                Assert.That(actual.Data, Is.EqualTo(expected.Data), name);
                Assert.That(actual.Accounts.Select(Key), Is.EqualTo(expected.Accounts.Select(Key)), name);
            }
        }

        [Test]
        public void SessionDecoderRejectsMalformedEnvelopesBeforeTrustingFields()
        {
            foreach (var row in fixture["accounts"].Where(item => (string)item["kind"] == "session_token_v2"))
            {
                var envelope = new AccountEnvelope((string)row["address"], (string)row["owner"], (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
                if (row["error"].Type != JTokenType.Null)
                {
                    Assert.That(() => session.Decode(envelope), Throws.TypeOf<FormatException>().With.Message.EqualTo((string)row["error"]), (string)row["id"]);
                    continue;
                }
                var decoded = session.Decode(envelope); var expected = row["decoded"];
                Assert.That(decoded.Authority, Is.EqualTo((string)expected["authority"]));
                Assert.That(decoded.TargetProgram, Is.EqualTo((string)expected["targetProgram"]));
                Assert.That(decoded.SessionSigner, Is.EqualTo((string)expected["sessionSigner"]));
                Assert.That(decoded.FeePayer, Is.EqualTo((string)expected["feePayer"]));
                Assert.That(decoded.ValidUntil, Is.EqualTo((long)expected["validUntil"]));
            }
        }

        [Test]
        public void FixedAccountDecodingMatchesAnchorAndRejectsInvalidPlayerRelationships()
        {
            var bindings = new AccountBindings(idl.ToString(), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            foreach (var row in fixture["accounts"].Where(item => (string)item["kind"] != "session_token_v2"))
            {
                var envelope = ReadEnvelope(row);
                Func<JObject> decode = () => (string)row["kind"] == "PlayerState"
                    ? bindings.PlayerState(envelope, (string)row["expectedAuthority"])
                    : bindings.ActiveRun(envelope, (string)row["expectedAuthority"]);
                if (row["error"].Type != JTokenType.Null)
                    Assert.That(() => decode(), Throws.TypeOf<FormatException>(), (string)row["id"]);
                else Assert.That(JToken.DeepEquals(decode(), row["decoded"]), Is.True, (string)row["id"]);
            }
        }

        [Test]
        public void ActualChainSnapshotsReconcileThroughNativeToExactTypescriptTokens()
        {
            var bindings = new AccountBindings(idl.ToString(), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var reconciler = new ActiveRunReconciler(bindings);
            foreach (var row in fixture["accounts"].Where(item => item["token"] != null))
            {
                var token = reconciler.Reconcile(ReadEnvelope(row), (string)row["expectedAuthority"]);
                Assert.That(Convert.ToBase64String(token.Config), Is.EqualTo((string)row["token"]["config"]), (string)row["id"]);
                Assert.That(Convert.ToBase64String(token.State), Is.EqualTo((string)row["token"]["state"]), (string)row["id"]);
            }
        }

        [Test]
        public async Task RecoveryMatchesReferenceRoutingSessionAndCopybackDecisions()
        {
            var bindings = new AccountBindings(idl.ToString(), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            string owner = (string)fixture["inputs"]["owner"], device = (string)fixture["inputs"]["device"];
            string active = (string)fixture["pdas"].Single(row => (string)row["id"] == "run-high-u64")["address"];
            string tokenAddress = (string)fixture["pdas"].Single(row => (string)row["id"] == "session")["address"];
            foreach (var row in fixture["recovery"])
            {
                var transport = new FixtureRecoveryTransport(row, fixture);
                var marker = (bool?)row["marker"] == false ? null : new RunMarker(owner, (ulong)row["runId"],
                    (string)row["mode"], active, device, tokenAddress, (long)row["validUntil"]);
                var resolver = new RunRecovery(protocol.ProgramId, (string)fixture["inputs"]["delegationProgramId"], session,
                    (envelope, authority) => row["run"] == null ? bindings.ActiveRun(envelope, authority) : new JObject {
                        ["owner"] = owner, ["run_id"] = ((ulong)row["runId"] + ((bool?)row["wrongRun"] == true ? 1UL : 0UL)).ToString(CultureInfo.InvariantCulture),
                        ["mode"] = new JObject { [Title((string)row["mode"])] = new JObject() },
                        ["lifecycle"] = new JObject { [Title((string)row["run"])] = new JObject() },
                    });
                if (row["output"]["error"].Type != JTokenType.Null)
                {
                    Assert.That(async () => await resolver.Resolve(marker, transport, (long)fixture["inputs"]["nowUnix"]),
                        Throws.TypeOf<FormatException>().With.Message.EqualTo((string)row["output"]["error"]), (string)row["id"]);
                    continue;
                }
                var result = await resolver.Resolve(marker, transport, (long)fixture["inputs"]["nowUnix"]);
                Assert.That(result.Phase, Is.EqualTo((string)row["output"]["phase"]), (string)row["id"]);
                Assert.That(result.SessionAuthorized, Is.EqualTo((bool)row["output"]["sessionAuthorized"]), (string)row["id"]);
                Assert.That(result.Endpoint, Is.EqualTo((string)row["output"]["connection"]), (string)row["id"]);
                Assert.That(result.Marker, Is.SameAs(marker), "Recovery preserves the locator until consumed: " + row["id"]);
            }
        }

        [Test]
        public void ProductionRecoveryRejectsRealAccountBytesThatTheCoreCannotReconcile()
        {
            var row = fixture["accounts"].Single(item => item["nativeError"] != null);
            var bindings = new AccountBindings(idl.ToString(), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var resolver = new RunRecovery(protocol.ProgramId, (string)fixture["inputs"]["delegationProgramId"], session, bindings);
            var active = ReadEnvelope(row);
            var token = ReadEnvelope(fixture["accounts"].Single(item => (string)item["id"] == "session-valid"));
            var marker = new RunMarker((string)fixture["inputs"]["owner"], (ulong)fixture["inputs"]["runId"], "daily",
                active.Address, (string)fixture["inputs"]["device"], token.Address, (long)fixture["inputs"]["nowUnix"] + 3600);
            var transport = new RealAccountRecoveryTransport(active, token);
            Assert.That(async () => await resolver.Resolve(marker, transport, (long)fixture["inputs"]["nowUnix"]),
                Throws.TypeOf<NativeEngineException>());
        }

        private sealed class RealAccountRecoveryTransport : IRecoveryTransport
        {
            private readonly AccountEnvelope active, session;
            public string BaseEndpoint => "https://base.invalid/";
            public RealAccountRecoveryTransport(AccountEnvelope active, AccountEnvelope session) { this.active = active; this.session = session; }
            public Task<AccountEnvelope> ReadBase(string address) => Task.FromResult(address == session.Address ? session : active);
            public Task<DelegationPlacement> Placement(string activeRun) => Task.FromResult(new DelegationPlacement { IsDelegated = true, Endpoint = "https://er.invalid/" });
            public Task<AccountEnvelope> ReadEr(string endpoint, string activeRun) => Task.FromResult(active);
        }

        private sealed class FixtureRecoveryTransport : IRecoveryTransport
        {
            private readonly JToken row;
            private readonly JObject fixture;
            public string BaseEndpoint => "https://base.invalid/";
            public FixtureRecoveryTransport(JToken row, JObject fixture) { this.row = row; this.fixture = fixture; }
            public Task<AccountEnvelope> ReadBase(string address)
            {
                var session = fixture["accounts"].Single(item => (string)item["id"] == "session-valid");
                if (address == (string)session["address"])
                    return Task.FromResult(new AccountEnvelope(address,
                        (bool?)row["invalidSession"] == true ? (string)fixture["inputs"]["owner"] : (string)session["owner"], false,
                        Convert.FromBase64String((string)session["data"])));
                return Task.FromResult(Info(address, (string)row["base"]));
            }
            public Task<DelegationPlacement> Placement(string activeRun) => Task.FromResult(new DelegationPlacement {
                IsDelegated = (bool?)row["delegated"] == true,
                Endpoint = (bool?)row["delegated"] == true ? "https://er.invalid/" : null,
            });
            public Task<AccountEnvelope> ReadEr(string endpoint, string activeRun)
            {
                Assert.That(endpoint, Is.EqualTo("https://er.invalid/"));
                return Task.FromResult(Info(activeRun, (string)row["er"]));
            }
            private AccountEnvelope Info(string address, string kind) => kind == null ? null : new AccountEnvelope(address,
                (string)fixture["inputs"][kind == "delegation" ? "delegationProgramId" : kind == "other" ? "owner" : "programId"],
                false, Array.Empty<byte>());
        }
        private static string Title(string value) => char.ToUpperInvariant(value[0]) + value.Substring(1);

        [Test]
        public void WalletOutputNeedsRealOwnerSignatureAndUnchangedMessageAndDeviceSignature()
        {
            foreach (var row in fixture["walletCases"])
            {
                var original = Convert.FromBase64String((string)row["before"]);
                var output = Convert.FromBase64String((string)row["output"]);
                if ((bool)row["accept"])
                    Assert.That(WalletSignatureVerifier.VerifySignedTransaction(original, output, (string)row["owner"]), Is.EqualTo(output));
                else Assert.That(() => WalletSignatureVerifier.VerifySignedTransaction(original, output, (string)row["owner"]), Throws.TypeOf<FormatException>(), (string)row["id"]);
            }
        }

        [Test]
        public void TruncatedWalletPacketsAndNoncanonicalLengthsAreRejected()
        {
            var row = fixture["walletCases"][0];
            var original = Convert.FromBase64String((string)row["before"]);
            var output = Convert.FromBase64String((string)row["output"]);
            for (int length = 0; length < output.Length; length++)
                Assert.That(() => WalletSignatureVerifier.VerifySignedTransaction(original, output.Take(length).ToArray(), (string)row["owner"]), Throws.TypeOf<FormatException>(), "length " + length);
            var overlongCount = new[] { (byte)(output[0] | 128), (byte)0 }.Concat(output.Skip(1)).ToArray();
            Assert.That(() => WalletSignatureVerifier.VerifySignedTransaction(original, overlongCount, (string)row["owner"]), Throws.TypeOf<FormatException>());
        }

        private static string Key(AccountMeta key) => key.Address + ":" + key.Signer + ":" + key.Writable;
        private static AccountEnvelope ReadEnvelope(JToken row) => new AccountEnvelope((string)row["address"],
            (string)row["owner"], (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        private static SolanaInstruction ReadInstruction(JToken row) => new SolanaInstruction((string)row["programId"],
            row["accounts"].Select(key => new AccountMeta((string)key["address"], (bool)key["signer"], (bool)key["writable"])),
            Convert.FromBase64String((string)row["data"]));
    }
}
