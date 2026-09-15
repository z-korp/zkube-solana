using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Integration.Planning.Tests
{
    public sealed class PlannerAgreementTests
    {
        private JObject fixture;
        private AccountBindings accounts;
        private SessionTokenBindings sessions;
        private ProtocolBindings protocol;
        private TransactionPlanner planner;
        private string owner, device;
        private long now;
        private static string PathFromRoot(string path) => Path.GetFullPath(Path.Combine(Application.dataPath, "../..", path));
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(PathFromRoot("fixtures/unity-plans-v1.json")));

        public static IEnumerable<TestCaseData> Plans()
        {
            var data = Fixture();
            Assert.That((int)data["schemaVersion"], Is.EqualTo(1));
            var operations = new HashSet<string>(data["plans"].Select(row => (string)row["input"]["operation"]));
            foreach (var required in new[] { "purchase", "enable", "refill", "revoke", "revokeExpired", "claim", "featured", "campaign", "daily",
                "delegate", "vrf", "move", "bonus", "reroll", "finish", "commit", "consume" })
                Assert.That(operations, Does.Contain(required));
            foreach (var row in data["plans"]) yield return new TestCaseData((string)row["id"]).SetName("Planner_" + row["id"]);
        }

        [SetUp]
        public void SetUp()
        {
            fixture = Fixture();
            string idl = File.ReadAllText(PathFromRoot("unity/Assets/ZKube/Integration/Generated/solana.json"));
            protocol = new ProtocolBindings(idl);
            accounts = new AccountBindings(idl, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            sessions = new SessionTokenBindings(File.ReadAllText(PathFromRoot("unity/Assets/ZKube/Integration/Generated/session.json")));
            planner = new TransactionPlanner(protocol, sessions);
            owner = (string)fixture["inputs"]["owner"]; device = (string)fixture["inputs"]["device"]; now = (long)fixture["inputs"]["now"];
        }
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        private AccountEnvelope Account(string name) => Envelope(fixture["accounts"][name]);
        private PlannerActor Actor(bool wallet = false) => wallet ? PlannerActor.Wallet(owner) :
            PlannerActor.Device(owner, device, Account("session"), sessions, protocol.ProgramId, now);
        private PlayerPlanSnapshot Player() => PlayerPlanSnapshot.Decode(accounts, Account("player"), owner);
        private DailyEntrySnapshot Daily() => DailyEntrySnapshot.Decode(accounts, Account("protocol"), Account("arcade"), Account("daily"),
            Account("following"), Account("credit"), (uint)fixture["inputs"]["day"], now);
        private RunPlanSnapshot Run(string mode, bool terminal = false) => RunPlanSnapshot.Decode(accounts, Envelope(fixture[terminal ? "terminalRuns" : "runs"][mode]), owner);

        [TestCaseSource(nameof(Plans))]
        public void HighLevelInputsProduceActualTypescriptPlans(string id)
        {
            var row = fixture["plans"].Single(item => (string)item["id"] == id);
            var input = row["input"]; var actor = Actor((bool?)input["ownerSigner"] == true);
            TransactionPlan plan;
            string operation = (string)input["operation"];
            switch (operation)
            {
                case "purchase": plan = planner.Purchase(owner, (uint)input["count"]); break;
                case "featured": plan = planner.SetFeaturedIdentity(actor, (byte)input["emblem"], (byte)input["frame"]); break;
                case "enable": plan = planner.EnableSession(owner, device, now); break;
                case "refill": plan = planner.RefillSession(owner, device, (ulong)input["balance"]); break;
                case "revoke": plan = planner.RevokeSession(owner, device, (ulong)input["balance"]); break;
                case "revokeExpired": plan = planner.RevokeExpiredSession(owner, Account("expiredSession"), now); break;
                case "claim": plan = planner.Claim(actor, (uint)input["day"], (string)input["board"], (uint)input["position"]); break;
                case "campaign": plan = planner.PrepareCampaign(actor, Player(), ContentPlanSnapshot.Decode(accounts, Account("protocol")),
                    (byte)input["map"], (byte)input["level"]); break;
                case "daily":
                    var selected = input["boards"].Values<string>().ToHashSet();
                    var observations = fixture["boards"].Where(b => selected.Contains((string)b["id"]))
                        .Select(b => new BoardObservation((uint)b["day"], (string)b["kind"], b["envelope"].Type == JTokenType.Null ? null : Envelope(b["envelope"])));
                    var candidates = TransactionPlanner.ReadEntryClaims(accounts, observations, owner, (uint)fixture["inputs"]["day"], now);
                    plan = planner.PrepareDaily(actor, Player(), Daily(), candidates, now); break;
                case "delegate": plan = planner.Delegate(actor, (ulong)fixture["inputs"]["nextRunId"], (string)fixture["inputs"]["validator"]); break;
                case "commit": plan = planner.Commit(actor, Run((string)input["mode"], true)); break;
                case "consume": plan = planner.Consume(actor, Run((string)input["mode"], !(bool)input["abandonFirst"]), (bool)input["abandonFirst"]); break;
                default: plan = planner.RunAction(actor, Run((string)input["mode"]), operation, Enumerable.Repeat((byte)7, 32).ToArray(),
                    (byte)input["row"], (byte)input["start"], (byte)input["destination"], (byte)input["column"]); break;
            }
            if ((bool?)input["delegate"] == true) plan = planner.PrepareAndDelegate(plan, actor, (string)fixture["inputs"]["validator"]);
            var expected = row["expected"];
            if (expected.Type == JTokenType.Null) { Assert.That(plan, Is.Null); return; }
            Assert.That(plan.Route == PlanRoute.Base ? "solana-base" : "magicblock-er", Is.EqualTo((string)expected["route"]));
            Assert.That(plan.FeePayer, Is.EqualTo((string)expected["feePayer"]));
            Assert.That(plan.OwnerSignatureRequired, Is.EqualTo((bool)expected["ownerRequired"]));
            Assert.That(plan.DeviceSigners, Is.EquivalentTo(expected["deviceSigners"].Values<string>()));
            Assert.That(plan.VersionZero, Is.EqualTo((bool)expected["versionZero"]));
            Assert.That(plan.PostFeeReserveLamports, Is.EqualTo((ulong)expected["reserve"]));
            Assert.That(plan.Instructions.Count, Is.EqualTo(expected["instructions"].Count()));
            for (int i = 0; i < plan.Instructions.Count; i++)
            {
                var actual = plan.Instructions[i]; var instruction = expected["instructions"][i];
                Assert.That(actual.ProgramId, Is.EqualTo((string)instruction["programId"]));
                Assert.That(actual.Data, Is.EqualTo(Convert.FromBase64String((string)instruction["data"])));
                Assert.That(actual.Accounts.Select(key => key.Address + ":" + key.Signer + ":" + key.Writable),
                    Is.EqualTo(instruction["accounts"].Select(key => (string)key["address"] + ":" + (bool)key["signer"] + ":" + (bool)key["writable"])));
            }
            Assert.That(plan.CompileMessage((string)fixture["inputs"]["blockhash"]), Is.EqualTo(Convert.FromBase64String((string)expected["message"])));
        }

        [Test]
        public void FeaturedIdentityRejectsValuesOutsideTheGeneratedCatalog()
        {
            Assert.That(() => planner.SetFeaturedIdentity(Actor(), checked((byte)(PlanningConstants.MaxEmblemId + 1)), 0),
                Throws.TypeOf<ArgumentOutOfRangeException>());
            Assert.That(() => planner.SetFeaturedIdentity(Actor(), 0, checked((byte)(PlanningConstants.MaxFrameTier + 1))),
                Throws.TypeOf<ArgumentOutOfRangeException>());
        }

        [Test]
        public void BothSlotsShareMonotonicIdsAndBlockOnlyTheirOwnActiveRun()
        {
            foreach (var row in fixture["slotCases"])
            {
                var player = PlayerPlanSnapshot.Decode(accounts, Envelope(row["player"]), owner);
                TransactionPlan Prepare() => (string)row["mode"] == "campaign"
                    ? planner.PrepareCampaign(Actor(), player, ContentPlanSnapshot.Decode(accounts, Account("protocol")), 1, 1)
                    : planner.PrepareDaily(Actor(), player, Daily(), Array.Empty<ValidatedBoardReward>(), now);
                if ((bool)row["accepted"]) Assert.That(Prepare().RunId, Is.EqualTo((ulong)fixture["inputs"]["nextRunId"]));
                else Assert.That(() => Prepare(), Throws.TypeOf<InvalidOperationException>());
            }
            Assert.That(() => planner.PrepareCampaign(Actor(), Player(), ContentPlanSnapshot.Decode(accounts, Account("protocol")), 1, 1,
                Envelope(fixture["runs"]["campaign"])), Throws.TypeOf<InvalidOperationException>());
        }

        [Test]
        public void ExactFeeChecksKeepTheSettlementReserveAndOwnerCannotBeSubstituted()
        {
            var plan = planner.Delegate(Actor(), (ulong)fixture["inputs"]["nextRunId"], (string)fixture["inputs"]["validator"]);
            foreach (var row in fixture["funding"])
            {
                void Check() => plan.RequireDeviceFunding((ulong)row["balance"], (ulong)row["rent"], (ulong)row["fee"]);
                if ((bool)row["accepted"]) Assert.DoesNotThrow(Check); else Assert.That(Check, Throws.TypeOf<InvalidOperationException>());
            }
            Assert.That(() => PlannerActor.Device(device, owner, Account("session"), sessions, protocol.ProgramId, now), Throws.TypeOf<ArgumentException>());
            Assert.That(() => planner.PrepareCampaign(PlannerActor.Wallet(device), Player(), ContentPlanSnapshot.Decode(accounts, Account("protocol")), 1, 1), Throws.TypeOf<ArgumentException>());
        }

        [Test]
        public void DeviceReadinessUsesTheSharedPolicyAtItsExactBoundary()
        {
            var envelope = Account("session");
            long boundary = sessions.Decode(envelope).ValidUntil - ClientPolicy.SessionReadySkewSeconds;
            Assert.That(() => PlannerActor.Device(owner, device, envelope, sessions, protocol.ProgramId, boundary), Throws.TypeOf<ArgumentException>());
            Assert.DoesNotThrow(() => PlannerActor.Device(owner, device, envelope, sessions, protocol.ProgramId, boundary - 1));
        }

        [Test]
        public void OwnerWalletIsNeverAskedToSupplyAMissingDeviceSignature()
        {
            var plan = planner.EnableSession(owner, device, now);
            var original = SolanaWire.UnsignedTransaction(plan.CompileMessage((string)fixture["inputs"]["blockhash"]));
            Assert.That(() => WalletSignatureVerifier.VerifyBeforeWallet(original, owner), Throws.TypeOf<FormatException>());
        }

        [Test]
        public void NonterminalRunsCannotSkipTheirAcceptedFinishAndCopyback()
        {
            foreach (var mode in new[] { "campaign", "daily" })
            {
                Assert.That(() => planner.Commit(Actor(), Run(mode)), Throws.TypeOf<InvalidOperationException>());
                Assert.That(() => planner.Consume(Actor(), Run(mode)), Throws.TypeOf<InvalidOperationException>());
            }
        }
    }
}
