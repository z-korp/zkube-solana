using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Newtonsoft.Json.Linq;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration;
using ZKube.Integration.Planning;

namespace ZKube.Tests.MoneyPlayableTrajectory
{
    public sealed class MoneyPlayableTrajectoryTests
    {
        private static readonly string Root = Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(Path.Combine(Root,
            "fixtures/unity-money-daily-playable-v1.json")));
        private static string Generated(string file) => File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated", file));
        private static byte[] Bytes(JToken value) => Convert.FromBase64String((string)value);
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Bytes(row["data"]));
        private static AccountBindings Accounts() => new AccountBindings(Generated("solana.json"), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);

        [Test] public void EveryDailySnapshotAndTraceAgreesAcrossWasmNativeAndValidatedAccounts()
        {
            var fixture = Fixture(); var inputs = fixture["inputs"];
            var native = new ActiveRunReconciler(Accounts());
            var token = new CoreRunToken(Bytes(inputs["config"]), Bytes(fixture["initial"]["token"]["state"]));
            foreach (var step in fixture["steps"])
            {
                var command = step["command"]; RunTransition transition = null;
                switch ((string)command["kind"])
                {
                    case "entry": case "requestVrf": break;
                    case "oracleVrf": transition = NativeEngine.ApplyVrf(token, (uint)command["requestCounter"], Bytes(command["output"])); break;
                    case "reroll": transition = NativeEngine.RequestReroll(token, (uint)command["expectedAction"]); break;
                    case "bonus": transition = NativeEngine.ApplyBonus(token, (uint)command["expectedAction"], (byte)command["row"], (byte)command["column"]); break;
                    case "move": transition = NativeEngine.PlayMove(token, (uint)command["expectedAction"], (ushort)command["expectedMove"],
                        (byte)command["row"], (byte)command["start"], (byte)command["destination"]); break;
                    default: Assert.Fail("Unknown trajectory command"); break;
                }
                if (transition != null)
                {
                    CollectionAssert.AreEqual(NativeEngine.Summary(transition.Token).Grid,
                        PresentationTrace.ProjectBoard(NativeEngine.Summary(token).Grid, transition.Events), "Native presentation must reach the accepted board");
                    token = transition.Token;
                }
                CollectionAssert.AreEqual(Bytes(step["account"]["token"]["state"]), token.State, command.ToString());
                var decoded = native.Reconcile(Envelope(step["account"]), (string)inputs["owner"]);
                CollectionAssert.AreEqual(token.State, decoded.State);
                CollectionAssert.AreEqual(Bytes(step["account"]["token"]["config"]), decoded.Config);
            }
            Assert.That(NativeEngine.Summary(token).Phase, Is.EqualTo((byte)CorePhase.Finished));
            Assert.That(NativeEngine.Summary(token).LatchedStarSources, Is.Zero);
        }

        [Test] public void ActualCSharpPlansMatchEveryTypeScriptActionAndSettlementMessage()
        {
            var fixture = Fixture(); var inputs = fixture["inputs"];
            var protocol = new ProtocolBindings(Generated("solana.json"));
            var sessions = new SessionTokenBindings(Generated("session.json"));
            var accounts = Accounts(); var planner = new TransactionPlanner(protocol, sessions);
            var plans = JObject.Parse(File.ReadAllText(Path.Combine(Root, "fixtures/unity-plans-v1.json")));
            var actor = PlannerActor.Device((string)inputs["owner"], (string)inputs["device"], Envelope(plans["accounts"]["session"]),
                sessions, protocol.ProgramId, (long)inputs["now"]);
            var accepted = fixture["initial"];
            foreach (var step in fixture["steps"])
            {
                var command = step["command"]; string kind = (string)command["kind"];
                if (kind != "oracleVrf" && kind != "entry")
                {
                    var run = RunPlanSnapshot.Decode(accounts, Envelope(accepted), actor.Owner);
                    var plan = planner.RunAction(actor, run, kind == "requestVrf" ? "vrf" : kind, Bytes(inputs["clientSeed"]),
                        (byte?)command["row"] ?? 0, (byte?)command["start"] ?? 0, (byte?)command["destination"] ?? 0, (byte?)command["column"] ?? 0);
                    CollectionAssert.AreEqual(Bytes(step["transaction"]["message"]), plan.CompileMessage((string)inputs["blockhash"]), kind);
                }
                accepted = step["account"];
            }
            var terminal = RunPlanSnapshot.Decode(accounts, Envelope(accepted), actor.Owner);
            CollectionAssert.AreEqual(Bytes(fixture["settlement"]["commit"]["message"]), planner.Commit(actor, terminal).CompileMessage((string)inputs["blockhash"]));
            CollectionAssert.AreEqual(Bytes(fixture["settlement"]["consume"]["message"]), planner.Consume(actor, terminal).CompileMessage((string)inputs["blockhash"]));
        }
    }
}
