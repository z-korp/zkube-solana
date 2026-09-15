using System;
using System.Collections;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core;

namespace ZKube.Local.Tests
{
    public sealed class LocalRunTests
    {
        private static JObject Fixture => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../fixtures/unity-local-runs-v1.json"
        ))));
        public static IEnumerable Cases() { foreach (var item in Fixture["cases"]) yield return new TestCaseData((string)item["name"]); }
        [TestCaseSource(nameof(Cases))]
        public void ActualBackendTrajectoryAndDecisions(string name)
        {
            var fixture = Fixture["cases"].Single(item => (string)item["name"] == name);
            string saved = fixture["initial"].ToString(); bool failWrites = false; int writes = 0; long now = (long)fixture["now"];
            LocalProductStore store = null; LocalRunClient client = null;
            void Restart() { store = new LocalProductStore(_ => saved, (_, value) => { if (failWrites) throw new IOException("disk-full"); saved = value; writes++; }); client = new LocalRunClient(store, () => now); }
            Restart();
            int index = 0;
            foreach (var step in fixture["steps"])
            {
                var command = step["command"]; string kind = (string)command["kind"]; LocalRunUpdate result = null; bool rejected = false;
                try
                {
                    switch (kind)
                    {
                        case "campaign": result = client.StartCampaign((byte)command["realm"], (byte)command["level"]); break;
                        case "daily": result = client.StartDaily(); break;
                        case "time": now = (long)command["now"]; break;
                        case "storage": failWrites = (bool)command["fail"]; break;
                        case "restart": Restart(); break;
                        case "billing": if ((bool)command["fail"]) throw new IOException("billing-offline"); client.ApplyCampaignEntitlement((bool)command["owned"], (string)command["price"]); break;
                        case "act": result = client.Act((string)command["id"], Action(command["action"])); break;
                        default: Assert.Fail("Unknown command " + kind); break;
                    }
                }
                catch (Exception error) when (error is NativeEngineException || error is InvalidOperationException || error is IOException || error is ArgumentException) { rejected = true; }
                string label = name + " step " + index++ + " " + kind;
                Assert.That(rejected, Is.EqualTo((bool)step["rejected"]), label);
                AssertView(result?.View, step["result"], label);
                AssertView(client.Active("campaign"), step["campaign"], label);
                AssertView(client.Active("arcade"), step["daily"], label);
                Assert.That(JToken.DeepEquals(JObject.Parse(saved), step["persisted"]), Is.True, label + " persistence");
                Assert.That(writes, Is.EqualTo((int)step["writes"]), label + " writes");
                var today = client.Today();
                Assert.That(today.DayId, Is.EqualTo((uint)step["today"]["dayId"]), label);
                Assert.That(today.Realm, Is.EqualTo((byte)step["today"]["realm"]), label);
                Assert.That(today.ObjectiveKind, Is.EqualTo((byte)step["today"]["kind"]), label);
                Assert.That(today.ObjectiveValue, Is.EqualTo((byte)step["today"]["value"]), label);
                Assert.That(today.OpensAt, Is.EqualTo((long)step["today"]["opensAt"]), label);
                Assert.That(today.FreezesAt, Is.EqualTo((long)step["today"]["freezesAt"]), label);
                if (result != null)
                {
                    var accepted = result.Transitions.Last();
                    CollectionAssert.AreEqual(result.View.Token.State, accepted.Token.State, label + " accepted transition");
                    var original = result.View.Token.State; result.View.Token.State[0] ^= 1; accepted.Token.State[0] ^= 1;
                    CollectionAssert.AreEqual(original, result.View.Token.State, label + " view isolation");
                    CollectionAssert.AreEqual(original, result.Transitions.Last().Token.State, label + " transition isolation");
                }
            }
        }
        private static LocalRunAction Action(JToken action)
        {
            switch ((string)action["_tag"])
            {
                case "Move": return new LocalRunAction(LocalActionKind.Move, (byte)action["row"], (byte)action["start"], (byte)action["destination"]);
                case "Bonus": return new LocalRunAction(LocalActionKind.Bonus, (byte)action["row"], (byte)action["column"]);
                case "Reroll": return new LocalRunAction(LocalActionKind.Reroll);
                case "Finish": return new LocalRunAction(LocalActionKind.Finish);
                default: throw new ArgumentException("Unknown action");
            }
        }
        private static void AssertView(LocalRunView actual, JToken expected, string label)
        {
            if (expected.Type == JTokenType.Null) { Assert.That(actual, Is.Null, label); return; }
            Assert.That(actual, Is.Not.Null, label); Assert.That(actual.RunId, Is.EqualTo((string)expected["id"]), label);
            Assert.That(actual.Mode, Is.EqualTo((string)expected["mode"]), label);
            Assert.That(string.Concat(actual.Token.State.Select(value => value.ToString("x2"))), Is.EqualTo((string)expected["tokenHex"]), label);
        }
    }
}
