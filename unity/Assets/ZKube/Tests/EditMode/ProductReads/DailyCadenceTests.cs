using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;
using ZKube.Integration.Tests;
using ZKube.Integration.Transport;

namespace ZKube.Tests.ProductReads
{
    // The cadence a player's own transaction carries. Every account here is
    // the program's: yesterday's Daily and today's, before and after the
    // program finalized one into the other.
    public sealed class DailyCadenceTests
    {
        private sealed class World
        {
            public readonly JObject Plans = ProgramScenarios.Load("plans"), Cadence = (JObject)ProgramScenarios.Load("economy")["cadence"];
            public readonly ProtocolBindings Protocol = new ProtocolBindings(TestBootstrap.ProtocolJson);
            public readonly SessionTokenBindings Tokens = new SessionTokenBindings(TestBootstrap.TokenJson);
            public readonly AccountBindings Accounts = new AccountBindings(TestBootstrap.ProtocolJson,
                ZKube.Core.Generated.Protocol.PlayerStateAccountVersion, ZKube.Core.Generated.Protocol.ProtocolAccountVersion);
            public readonly TransactionPlanner Planner;
            public readonly SolanaRpcTransport Rpc;
            public readonly Dictionary<string, JToken> Chain = new Dictionary<string, JToken>();
            public readonly uint Day; public readonly long Now; public readonly string Owner;
            public World()
            {
                Planner = new TransactionPlanner(Protocol, Tokens);
                Day = (uint)Plans["inputs"]["day"]; Now = (long)Plans["inputs"]["now"]; Owner = (string)Plans["inputs"]["owner"];
                var http = new TestHttp { Reply = async (endpoint, request, token) => {
                    await Task.Yield();
                    JToken Account(string address) => Chain.TryGetValue(address, out var row) ? new JObject { ["owner"] = row["owner"],
                        ["executable"] = false, ["lamports"] = 1000000000, ["data"] = new JArray(row["data"], "base64") } : JValue.CreateNull();
                    switch ((string)request["method"])
                    {
                        case "getGenesisHash": return new JValue((string)ProgramScenarios.Load("transport")["inputs"]["expectedGenesis"]);
                        case "getAccountInfo": return TestHttp.Context(Account((string)request["params"][0]));
                        case "getMultipleAccounts": return TestHttp.Context(new JArray(request["params"][0].Values<string>().Select(Account)));
                        default: throw new InvalidOperationException("Unexpected offline RPC " + request["method"]);
                    }
                } };
                Rpc = new SolanaRpcTransport(http, "https://base.invalid/", "https://router.invalid/",
                    (string)ProgramScenarios.Load("transport")["inputs"]["expectedGenesis"], Protocol.ProgramId);
            }
            public void Put(params JToken[] rows) { foreach (var row in rows) Chain[(string)row["address"]] = row; }
            public AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
                (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
            public JObject Daily(string name) => Accounts.ArenaDaily(Envelope(Cadence[name]));
            public JObject Config(JToken row) => Accounts.ProtocolConfig(Envelope(row));
            // The moment yesterday's last unresolved run can no longer score.
            public long YesterdayRecovered => (long)NativeEngine.Daily(Day - 1).FreezesAt + (long)ZKube.Core.Generated.Protocol.RunRecoverySeconds;
            public Task<CadenceObservation> Read(JToken protocol, string today, long now) => CadenceObservation.Read(Accounts, Planner, Rpc,
                Config(protocol), today == null ? null : Daily(today), Day, now, null, CancellationToken.None);
            public PlannerActor Device() => PlannerActor.Device(Owner, (string)Plans["inputs"]["device"], Envelope(Plans["accounts"]["session"]),
                Tokens, Protocol.ProgramId, Now);
        }

        [Test]
        public async Task TheLobbyPotDoesNotJumpWhenTheDailyBeforeItFinalizes()
        {
            var world = new World(); ulong forwarded = ulong.Parse((string)world.Cadence["forwarded"]);
            ulong before = DailyCadence.Pot(world.Daily("today"), world.Daily("yesterday"));
            ulong after = DailyCadence.Pot(world.Daily("todayReceived"), world.Daily("yesterdayFinalized"));
            Assert.That(before, Is.EqualTo(after));
            Assert.That(before, Is.EqualTo(DailyCadence.Pool(world.Daily("today")) + forwarded));
            Assert.That(DailyCadence.Pool(world.Daily("todayReceived")), Is.EqualTo(after), "after finalization the pot is today's own pool");
            // Today's own entries' share is never in today's pot.
            Assert.That(after, Is.LessThan(after + (ulong)world.Daily("today")["ledger"]["next_pot_lamports"]));
            // On a quiet day nobody has entered yet: the pot is what yesterday will send.
            Assert.That(DailyCadence.Pot(null, world.Daily("yesterday")), Is.EqualTo(forwarded));

            // The lobby reads exactly that figure on each side of the boundary.
            var lobby = new PublicDailyQuery(world.Accounts, world.Planner, world.Rpc, () => world.Now);
            world.Put(world.Plans["accounts"]["protocol"], world.Cadence["today"], world.Cadence["yesterday"]);
            var waiting = await lobby.Current();
            world.Put(world.Cadence["todayReceived"], world.Cadence["yesterdayFinalized"]);
            var received = await lobby.Current();
            Assert.That(waiting.PotLamports, Is.EqualTo(before)); Assert.That(received.PotLamports, Is.EqualTo(before));
            Assert.That(waiting.Status, Is.EqualTo("open")); Assert.That(received.Status, Is.EqualTo("open"));
            world.Chain.Remove((string)world.Cadence["today"]["address"]);
            world.Put(world.Cadence["quietProtocol"], world.Cadence["yesterday"]);
            var quiet = await lobby.Current();
            Assert.That(quiet.Status, Is.EqualTo("open"), "a day nobody has entered yet is open by the clock");
            Assert.That(quiet.PotLamports, Is.EqualTo(forwarded));
        }

        [Test]
        public async Task TheCadenceIsReadFromTheChainOfPreparedDailiesOldestFirst()
        {
            var world = new World(); long late = world.YesterdayRecovered;
            world.Put(world.Cadence["yesterday"]);
            // A quiet day: today's Daily is prepared and yesterday finalizes into it.
            var quiet = await world.Read(world.Cadence["quietProtocol"], null, late);
            Assert.That(quiet.PrepareDay, Is.EqualTo(world.Day));
            Assert.That(quiet.Steps.Select(step => (step.Day, step.Following)), Is.EqualTo(new[] { (world.Day - 1, world.Day) }));
            // Someone entered today already: only the finalization is left.
            var played = await world.Read(world.Plans["accounts"]["protocol"], "today", late);
            Assert.That(played.PrepareDay, Is.Null);
            Assert.That(played.Steps.Select(step => (step.Day, step.Following)), Is.EqualTo(new[] { (world.Day - 1, world.Day) }));
            Assert.That((uint)played.Predecessor["day_id"], Is.EqualTo(world.Day - 1));
            // One run is still unresolved: until its recovery deadline the day waits for it.
            var early = await world.Read(world.Plans["accounts"]["protocol"], "today", late - 1);
            Assert.That(early.Steps, Is.Empty); Assert.That(early.Due, Is.False);
            // Once it is done there is nothing to carry.
            world.Put(world.Cadence["yesterdayFinalized"]);
            var done = await world.Read(world.Plans["accounts"]["protocol"], "todayReceived", late);
            Assert.That(done.Due, Is.False);
        }

        [Test]
        public void AWinnerBackOnAQuietDayFinalizesTheirDayThemselves()
        {
            var world = new World(); var actor = world.Device();
            var plan = world.Planner.SettleDailies(actor, world.Day, new[] { new CadenceStep(world.Day - 1, world.Day) });
            var calls = plan.Instructions.Select(world.Protocol.DecodeInstruction).ToArray();
            Assert.That(calls.Select(call => call.Name), Is.EqualTo(new[] { "prepare_arena_daily", "finalize_arena_daily" }));
            Assert.That((uint)calls[0].Arguments["day_id"], Is.EqualTo(world.Day));
            Assert.That(calls[1].Accounts["arena_daily"], Is.EqualTo(world.Planner.Daily(world.Day - 1)));
            Assert.That(calls[1].Accounts["following_daily"], Is.EqualTo(world.Planner.Daily(world.Day)));
            // The device pays only the fee: it signs alone and no owner approval is asked.
            Assert.That(plan.FeePayer, Is.EqualTo(actor.Signer)); Assert.That(plan.OwnerSignatureRequired, Is.False);
            Assert.That(calls.All(call => call.Accounts["caller"] == actor.Signer && call.Accounts["cadence_funding"] == world.Planner.CadenceFundingAddress));
            Assert.Throws<InvalidOperationException>(() => world.Planner.SettleDailies(actor, null, Array.Empty<CadenceStep>()));
        }

        private static (TransactionPlan Plan, string[] Names) Entry(World world, bool quiet, CadenceStep[] steps)
        {
            var actor = world.Device();
            var player = PlayerPlanSnapshot.Decode(world.Accounts, world.Envelope(ProgramScenarios.Load("runs")["initialPlayers"]["daily"]), world.Owner);
            var daily = DailyEntrySnapshot.Decode(world.Accounts, world.Envelope(quiet ? world.Cadence["quietProtocol"] : world.Plans["accounts"]["protocol"]),
                quiet ? null : world.Envelope(world.Plans["accounts"]["daily"]), world.Envelope(world.Plans["accounts"]["credit"]), world.Day, world.Now);
            var rewards = TransactionPlanner.ReadEntryClaims(world.Accounts, world.Plans["boards"].Where(board => board["envelope"].Type == JTokenType.Object)
                .Select(board => new BoardObservation((uint)board["day"], (string)board["kind"], world.Envelope(board["envelope"]), world.Envelope(board["daily"]))).Take(6), world.Owner);
            var plan = world.Planner.PrepareAndDelegate(world.Planner.PrepareDaily(actor, player, daily, rewards, world.Now, null, steps),
                actor, (string)world.Plans["inputs"]["validator"]);
            return (plan, plan.Instructions.Select(world.Protocol.DecodeInstruction).Select(call => call.Name).ToArray());
        }

        [Test]
        public void AnEntryCarryingCadenceLeavesItsOptionalClaimsOut()
        {
            var world = new World();
            Assert.That(Entry(world, false, null).Names, Is.EqualTo(new[] { "claim_daily_prize", "claim_daily_prize", "enter_arena", "delegate_active_run" }));
            Assert.That(Entry(world, false, new[] { new CadenceStep(world.Day - 1, world.Day) }).Names,
                Is.EqualTo(new[] { "finalize_arena_daily", "enter_arena", "delegate_active_run" }));
            Assert.That(Entry(world, true, null).Names, Is.EqualTo(new[] { "prepare_arena_daily", "enter_arena", "delegate_active_run" }));
        }

        [Test]
        public void TheLargestCadenceCarryingEntryFitsOnePacket()
        {
            var world = new World();
            // The first entry of a day after two finished days nobody finalized:
            // today's preparation, both finalizations, the entry and its delegation.
            var steps = new[] { new CadenceStep(world.Day - 2, world.Day - 1), new CadenceStep(world.Day - 1, world.Day) };
            var (plan, names) = Entry(world, true, steps);
            Assert.That(names, Is.EqualTo(new[] { "prepare_arena_daily", "finalize_arena_daily", "finalize_arena_daily", "enter_arena", "delegate_active_run" }));
            Assert.That(plan.ComputeUnitLimit, Is.EqualTo(PlanningConstants.CadenceComputeUnitLimit));
            int packet = SolanaWire.UnsignedTransaction(plan.CompileMessage((string)world.Plans["inputs"]["blockhash"])).Length;
            TestContext.WriteLine("Largest cadence-carrying entry packet: " + packet + " bytes");
            Assert.That(packet, Is.LessThanOrEqualTo(SolanaWire.PacketBytes));
            Assert.Throws<ArgumentException>(() => Entry(world, true, steps.Append(new CadenceStep(world.Day - 3, world.Day - 2)).ToArray()));
        }
    }
}
