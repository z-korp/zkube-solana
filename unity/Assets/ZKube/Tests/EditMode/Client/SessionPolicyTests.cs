using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;

namespace ZKube.Integration.Tests
{
    public sealed class SessionPolicyTests
    {
        private static JObject Fixture(string name) => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/" + name))));
        [Test]
        public void ReadinessAndFundingMatchActualTypeScriptDecisionBoundaries()
        {
            var fixture = Fixture("unity-session-decisions-v1.json");
            foreach (var row in fixture["expiry"])
            {
                string status = SessionReadiness.Status((long)row["validUntil"], (long)row["now"]);
                Assert.That(status, Is.EqualTo((string)row["status"]));
                Assert.That(status == "expiring" || status == "live", Is.EqualTo((bool)row["current"]));
            }
            foreach (var row in fixture["funding"])
            {
                var envelope = !(bool)row["present"] ? null : new AccountEnvelope(PlanningConstants.SystemProgram,
                    (string)row["owner"], (bool)row["executable"], new byte[(int)row["bytes"]]);
                if ((string)row["outcome"] == "invalid")
                    Assert.Throws<FormatException>(() => SessionReadiness.Funding(envelope, (ulong)row["lamports"], (ulong)row["rent"]));
                else Assert.That(SessionReadiness.Funding(envelope, (ulong)row["lamports"], (ulong)row["rent"]), Is.EqualTo((string)row["outcome"]));
            }
        }
        [Test]
        public void RenewalMessagesAndSignaturesMatchLiveTypeScriptCompositionAtBothExpiryBoundaries()
        {
            var fixture = Fixture("unity-session-plans-v1.json"); var input = fixture["inputs"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(generated, "solana.json")));
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            var planner = new TransactionPlanner(protocol, tokens);
            using var owner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            using var previous = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            using var candidate = new DeviceSigner(Enumerable.Repeat((byte)3, 32).ToArray());
            foreach (var row in fixture["cases"])
            {
                var source = row["oldToken"];
                var token = new AccountEnvelope((string)source["address"], (string)source["owner"], (bool)source["executable"], Convert.FromBase64String((string)source["data"]));
                var plan = planner.RenewSession(owner.Address, candidate.Address, (long)input["now"], token, previous.Address, (ulong)row["balance"]);
                var message = plan.CompileMessage((string)input["blockhash"]);
                Assert.That(message, Is.EqualTo(Convert.FromBase64String((string)row["message"])));
                Assert.That(plan.DeviceSigners.Contains(previous.Address), Is.EqualTo((bool)row["previousSignerRequired"]));
                byte[] transaction = SolanaWire.UnsignedTransaction(message);
                foreach (var key in plan.DeviceSigners) transaction = (key == previous.Address ? previous : candidate).PartialSign(transaction);
                transaction = owner.PartialSign(transaction);
                Assert.That(transaction, Is.EqualTo(Convert.FromBase64String((string)row["signedTransaction"])));
                TransactionSignatures.ValidateFullySigned(transaction);
            }
        }
    }
}
