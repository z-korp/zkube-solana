using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Core.Tests
{
    public sealed class NativeEngineTests
    {
        [Serializable] public sealed class Trajectories { public int schemaVersion; public string coreVersion; public Trajectory[] cases; public LocalRandomness[] localRandomness; }
        [Serializable] public sealed class LocalRandomness { public string seedHex, outputHex; public uint counter; }
        [Serializable] public sealed class Trajectory { public string name; public string origin; public string configHex; public string initialStateHex; public string finalStateHex; public string finalReplayHex; public Step[] steps; }
        [Serializable] public sealed class Step { public uint operation; public string requestHex; public string responseHex; }
        [Serializable] public sealed class LadderFixture { public string coreVersion; public LadderVector[] vectors; }
        [Serializable] public sealed class LadderVector { public uint qualifiedEntrants; public uint rank; public uint points; }
        [Serializable] public sealed class GameFixture { public PhaseOne phase1Core; }
        [Serializable] public sealed class PhaseOne { public Draw dailyPairDraw; public Split dailyBoardSplit; public Payout rankPayout; }
        [Serializable] public sealed class Draw { public uint startsDay; public uint[] pairIndicesByDay; }
        [Serializable] public sealed class Split { public ulong poolLamports; public uint themeQualifiedWinners; public ulong scoreLamports; public ulong themeLamports; }
        [Serializable] public sealed class Payout { public ulong poolLamports; public uint qualifiedWinners; public ulong entryPriceLamports; public uint winnerCount; public ulong paidLamports; public ulong rolloverLamports; public ulong[] payoutsLamports; }
        [Serializable] public sealed class Continuation { public uint request_counter; public string vrf_output_hex; public string rules_hash_hex; public ushort[] weights; public byte[] seed_row; public byte[] preview_row; }

        private static string FixturePath(string file) => Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures", file));
        private static T Read<T>(string file) => JsonUtility.FromJson<T>(File.ReadAllText(FixturePath(file)));
        private static byte[] Hex(string value)
        {
            if (value == null || value.Length % 2 != 0) throw new ArgumentException("Invalid hex");
            var result = new byte[value.Length / 2];
            for (int i = 0; i < result.Length; i++) result[i] = Convert.ToByte(value.Substring(i * 2, 2), 16);
            return result;
        }

        public static IEnumerable<TestCaseData> Cases()
        {
            var fixture = Read<Trajectories>("native-run-trajectories.json");
            Assert.AreEqual(1, fixture.schemaVersion);
            Assert.AreEqual(Protocol.CoreVersion, fixture.coreVersion);
            var names = new HashSet<string>(fixture.cases.Select(c => c.name));
            foreach (var realm in Protocol.Realms)
                foreach (var mode in new[] { "campaign", "daily" })
                    Assert.IsTrue(names.Contains("realm-" + realm.MapId + "-" + mode), "Missing published realm/mode coverage");
            foreach (var required in new[] {
                "Hammer-perfect-clear-continuation", "Totem-perfect-clear-continuation", "Wave-perfect-clear-continuation",
                "move-perfect-clear-grant", "move-perfect-clear-cap", "Hammer-perfect-clear-cap",
                "score-latch", "shape-latch", "blow-latch", "all-star-completion",
                "accepted-reroll-deadline", "move-budget-exhaustion", "blocked-eleventh-row"
            }) Assert.IsTrue(names.Contains(required), "Missing native scenario: " + required);
            foreach (var trajectory in fixture.cases) yield return new TestCaseData(trajectory).SetName("NativeParity_" + trajectory.name);
        }

        [TestCaseSource(nameof(Cases))]
        public void ActualManagedNativeCallsMatchEveryTransitionAndTrace(Trajectory trajectory)
        {
            var config = Hex(trajectory.configHex);
            var state = Hex(trajectory.initialStateHex);
            foreach (var step in trajectory.steps)
            {
                var request = Hex(step.requestHex);
                if (step.operation == BuildConfigRequest.Operation)
                    CollectionAssert.AreEqual(request, BuildConfigRequest.Decode(request).Encode(), "Generated config request round-trip");
                var actual = NativeEngine.Call(step.operation, request);
                CollectionAssert.AreEqual(Hex(step.responseHex), actual, trajectory.name + " operation " + step.operation);
                if (step.operation == InitializeRequest.Operation || step.operation == ReconcileRequest.Operation) state = actual;
                if (step.operation >= ApplyVrfRequest.Operation && step.operation <= FinishRequest.Operation)
                {
                    var result = RunTransition.Decode(config, actual);
                    if (result.TraceIncluded)
                    {
                        var before = NativeEngine.Summary(state).Grid;
                        var rendered = PresentationTrace.ProjectBoard(before, result.Events);
                        CollectionAssert.AreEqual(NativeEngine.Summary(result.Token).Grid, rendered,
                            trajectory.name + ": explicit presentation facts must end at the native board");
                    }
                    state = result.Token.State;
                }
            }
            CollectionAssert.AreEqual(Hex(trajectory.finalStateHex), state);
            CollectionAssert.AreEqual(Hex(trajectory.finalReplayHex), NativeEngine.Summary(state).ReplayHash);
        }

        [Test] public void LocalRowRandomnessMatchesRustForSavedSeedsAndCounterBounds()
        {
            foreach (var vector in Read<Trajectories>("native-run-trajectories.json").localRandomness)
                CollectionAssert.AreEqual(Hex(vector.outputHex), NativeEngine.LocalRowRandomness(Hex(vector.seedHex), vector.counter));
            Assert.Throws<ArgumentException>(() => NativeEngine.LocalRowRandomness(new byte[33], 1));
            var error = Assert.Throws<NativeEngineException>(() => NativeEngine.Call(LocalRowRandomnessRequest.Operation,
                new LocalRowRandomnessRequest { Seed = new byte[32], SeedLength = 33, Counter = 1 }.Encode()));
            Assert.That(error.Status, Is.EqualTo(NativeStatus.InvalidEncoding));
        }

        [Test]
        public void PerfectClearFactsDecodeFromActualNativeMovesAndBonusesAtAndBelowTheCap()
        {
            foreach (var scenario in new[] {
                ("move-perfect-clear-grant", true), ("move-perfect-clear-cap", false),
                ("Hammer-perfect-clear-continuation", true), ("Hammer-perfect-clear-cap", false)
            })
            {
                var trajectory = Read<Trajectories>("native-run-trajectories.json").cases.Single(c => c.name == scenario.Item1);
                var action = trajectory.steps.First(s => s.operation == PlayMoveRequest.Operation || s.operation == ApplyBonusRequest.Operation);
                var traced = RunTransition.Decode(Hex(trajectory.configHex), NativeEngine.Call(action.operation, Hex(action.requestHex)));
                var fact = traced.Events.Single(e => e.Kind == PresentationKind.PerfectClear);
                Assert.AreEqual(scenario.Item2 ? 1 : 0, fact.Payload.Single());
                CollectionAssert.AreEqual(NativeEngine.Summary(traced.Token).Grid,
                    PresentationTrace.ProjectBoard(NativeEngine.Summary(Hex(trajectory.initialStateHex)).Grid, traced.Events));
                var plain = trajectory.steps.SkipWhile(s => s != action).Skip(1).First();
                var untraced = RunTransition.Decode(Hex(trajectory.configHex), NativeEngine.Call(plain.operation, Hex(plain.requestHex)));
                CollectionAssert.AreEqual(untraced.Token.State, traced.Token.State, "Trace does not alter state or replay");
                Assert.IsEmpty(untraced.Events);
                Assert.AreEqual(scenario.Item2 ? 2 : 3, NativeEngine.Summary(traced.Token).RerollCharges);
            }
            var malformed = new byte[10];
            NativeWire.Write(malformed, 0, 2, NativeSchema.TraceVersion);
            NativeWire.Write(malformed, 2, 4, 1);
            malformed[6] = (byte)PresentationKind.PerfectClear;
            NativeWire.Write(malformed, 7, 2, 1); malformed[9] = 2;
            Assert.Throws<ArgumentException>(() => PresentationTrace.Decode(malformed));
        }

        [Test]
        public void ManagedTypedWrappersUseTheSameConfigAndTokenContract()
        {
            var realm = Protocol.Realms[7];
            var config = new BuildConfigRequest {
                RulesHash = Enumerable.Repeat((byte)8, 32).ToArray(), InitialReplay = Enumerable.Repeat((byte)9, 32).ToArray(),
                MaxMoves = checked((ushort)Protocol.DailyMaxMoves), BonusType = (byte)realm.GuardianAndHeight[0],
                Trigger = (byte)realm.GuardianAndHeight[1], TriggerThreshold = realm.GuardianAndHeight[2],
                StartingHeight = (byte)realm.GuardianAndHeight[3], TierPolicy = 1,
                ObjectiveKind = Protocol.DailyThemes[8][0], ObjectiveValue = Protocol.DailyThemes[8][1]
            };
            var token = NativeEngine.Initialize(config);
            Assert.AreEqual(CorePhase.AwaitingVrf, (CorePhase)NativeEngine.Summary(token).Phase);
            token = NativeEngine.ApplyVrf(token, 1, Enumerable.Repeat((byte)8, 32).ToArray()).Token;
            var summary = NativeEngine.Summary(token);
            Assert.AreEqual(CorePhase.Playing, (CorePhase)summary.Phase);
            Assert.AreEqual(0, summary.BonusCharges);
            Assert.AreEqual(1, summary.RerollCharges);
            token = NativeEngine.RequestReroll(token, 0).Token;
            Assert.AreEqual(1, NativeEngine.Summary(token).ActionCounter);
            token = NativeEngine.Finish(token, 4).Token;
            Assert.AreEqual(1, NativeEngine.Summary(token).ScoreEligible);
            Assert.AreEqual(4, NativeEngine.Summary(token).EndReason);
        }

        [Test]
        public void ManagedBoundaryRejectsBadInputsWithoutPublishingPartialBytes()
        {
            var request = new DailyPairIndexRequest { Day = 42 }.Encode();
            var output = Enumerable.Repeat((byte)0xa5, 8).ToArray();
            uint written = 991;
            var undersized = Enumerable.Repeat((byte)0xa5, 3).ToArray();
            Assert.AreEqual(NativeStatus.OutputTooSmall, NativeEngine.TryCall(DailyPairIndexRequest.Operation, request, undersized, ref written));
            CollectionAssert.AreEqual(Enumerable.Repeat((byte)0xa5, 3), undersized);
            Assert.AreEqual(991, written);
            request[0] = 255;
            Assert.AreEqual(NativeStatus.UnsupportedVersion, NativeEngine.TryCall(DailyPairIndexRequest.Operation, request, output, ref written));
            Assert.AreEqual(991, written);
            CollectionAssert.AreEqual(Enumerable.Repeat((byte)0xa5, 8), output);
            request[0] = (byte)NativeSchema.AbiVersion;
            Assert.AreEqual(NativeStatus.InvalidLength, NativeEngine.TryCall(DailyPairIndexRequest.Operation, request.Take(request.Length - 1).ToArray(), output, ref written));
            Assert.AreEqual(NativeStatus.UnknownOperation, NativeEngine.TryCall(uint.MaxValue, request, output, ref written));
            Assert.AreEqual(991, written);
            CollectionAssert.AreEqual(Enumerable.Repeat((byte)0xa5, 8), output);
            Assert.AreEqual(NativeStatus.Success, NativeEngine.TryCall(DailyPairIndexRequest.Operation, request, null, ref written));
            Assert.AreEqual(4, written);
            Assert.Throws<ArgumentException>(() => NativeEngine.TryCall(DailyPairIndexRequest.Operation, request, request, ref written));
            Assert.Throws<ArgumentException>(() => new SummaryRequest { State = new byte[3] }.Encode());
            Assert.Throws<ArgumentException>(() => BuildConfigRequest.Decode(new byte[NativeSchema.RunConfigLength]));
            var configRequest = new BuildConfigRequest().Encode();
            configRequest[0] ^= 0x80;
            Assert.Throws<ArgumentException>(() => BuildConfigRequest.Decode(configRequest));
        }

        [Test]
        public void InvalidActionOrderAndCorruptTokensPreserveCallerState()
        {
            var fixture = Read<Trajectories>("native-run-trajectories.json").cases.First(c => c.origin == "opening");
            var token = new CoreRunToken(Hex(fixture.configHex), Hex(fixture.initialStateHex));
            token = NativeEngine.ApplyVrf(token, 1, Enumerable.Repeat((byte)1, 32).ToArray()).Token;
            var before = (byte[])token.State.Clone();
            var error = Assert.Throws<NativeEngineException>(() => NativeEngine.RequestReroll(token, 999));
            Assert.AreEqual(NativeStatus.InvalidActionOrder, error.Status);
            CollectionAssert.AreEqual(before, token.State);
            token.State[0] = 255;
            error = Assert.Throws<NativeEngineException>(() => NativeEngine.Summary(token));
            Assert.AreEqual(NativeStatus.InvalidEncoding, error.Status);
        }

        [Test]
        public void IntegerProtocolQueriesMatchCommittedGoldenFixtures()
        {
            var ladder = Read<LadderFixture>("ladder-points.json");
            foreach (var vector in ladder.vectors)
                Assert.AreEqual(vector.points, NativeEngine.LadderPoints(vector.qualifiedEntrants, vector.rank));
            var core = Read<GameFixture>("game-parity.json").phase1Core;
            for (uint i = 0; i < core.dailyPairDraw.pairIndicesByDay.Length; i++)
                Assert.AreEqual(core.dailyPairDraw.pairIndicesByDay[i], NativeEngine.DailyPairIndex(core.dailyPairDraw.startsDay + i));
            var pools = NativeEngine.BoardPools(core.dailyBoardSplit.poolLamports, core.dailyBoardSplit.themeQualifiedWinners);
            Assert.AreEqual(core.dailyBoardSplit.scoreLamports, NativeWire.Read(pools, 0, 8));
            Assert.AreEqual(core.dailyBoardSplit.themeLamports, NativeWire.Read(pools, 8, 8));
            var payout = core.rankPayout;
            Assert.AreEqual(Protocol.EntryLamports, payout.entryPriceLamports);
            var width = NativeEngine.BoardWidth(payout.poolLamports, payout.qualifiedWinners);
            Assert.AreEqual(payout.winnerCount, NativeWire.Read(width, 0, 4));
            var denominator = NativeWire.Bytes(width, 4, 16);
            ulong paid = 0;
            for (uint rank = 1; rank <= payout.winnerCount; rank++)
            {
                var amount = NativeEngine.PayoutForRank(payout.poolLamports, denominator, rank);
                Assert.AreEqual(payout.payoutsLamports[rank - 1], amount);
                paid += amount;
            }
            Assert.AreEqual(payout.paidLamports, paid);
            Assert.AreEqual(payout.rolloverLamports, payout.poolLamports - paid);
            var continuation = Read<Continuation>("replays/golden-perfect-clear-continuation-v1.json");
            var weights = new byte[10];
            for (int i = 0; i < continuation.weights.Length; i++) NativeWire.Write(weights, i * 2, 2, continuation.weights[i]);
            var rows = NativeEngine.Call(EmptyContinuationRequest.Operation, new EmptyContinuationRequest {
                Counter = continuation.request_counter, Output = Hex(continuation.vrf_output_hex),
                RulesHash = Hex(continuation.rules_hash_hex), Weights = weights
            }.Encode());
            CollectionAssert.AreEqual(continuation.seed_row.Concat(continuation.preview_row), rows);
        }

        [Test]
        public void TraceDecoderRejectsUnknownTruncatedAndTrailingPayloads()
        {
            Assert.Throws<ArgumentException>(() => PresentationTrace.Decode(new byte[] { 2, 0, 0, 0, 0, 0 }));
            Assert.Throws<ArgumentException>(() => PresentationTrace.Decode(new byte[] { 1, 0, 1, 0, 0, 0, 255, 1, 0, 0 }));
            Assert.Throws<ArgumentException>(() => PresentationTrace.Decode(new byte[] { 1, 0, 1, 0, 0, 0, 7, 1, 0 }));
            Assert.Throws<ArgumentException>(() => PresentationTrace.Decode(new byte[] { 1, 0, 0, 0, 0, 0, 0 }));
        }
    }
}
