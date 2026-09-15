using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using Newtonsoft.Json.Linq;
using UnityEngine;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Local.Tests
{
    public sealed class LocalBoardActionProviderTests
    {
        private sealed class Env
        {
            public string Disk;
            public bool Fail;
            public int Writes;
            public Action AfterWrite;
            public readonly LocalProductStore Store;
            public readonly LocalRunClient Client;
            public Env()
            {
                Store = new LocalProductStore(_ => Disk, (_, value) => {
                    Writes++;
                    if (Fail) throw new IOException("disk-full");
                    Disk = value; AfterWrite?.Invoke();
                });
                Client = new LocalRunClient(Store, () => 20705L * 86400 + 123);
            }
        }
        private static readonly CancellationToken None = CancellationToken.None;
        private static readonly BoardAction Reroll = new BoardAction(BoardActionKind.Reroll);
        private static readonly BoardAction Finish = new BoardAction(BoardActionKind.Abandon);
        private static void Same(CoreRunToken expected, CoreRunToken actual)
        { CollectionAssert.AreEqual(expected.Config, actual.Config); CollectionAssert.AreEqual(expected.State, actual.State); }
        private static async Task<T> Reject<T>(Func<Task> action) where T : Exception
        {
            try { await action(); }
            catch (T error) { return error; }
            Assert.Fail("Expected " + typeof(T).Name); return null;
        }

        [TestCase("campaign-action")]
        [TestCase("daily-actions-restart")]
        public async Task BoardGesturesAgreeWithActualTypeScriptBackendTrajectory(string name)
        {
            var fixture = JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath,
                "../../fixtures/unity-local-runs-v1.json"))))["cases"].Single(value => (string)value["name"] == name);
            var env = new Env(); var first = fixture["steps"][0]["command"];
            var start = (string)first["kind"] == "daily" ? env.Client.StartDaily() : env.Client.StartCampaign((byte)first["realm"], (byte)first["level"]);
            var provider = new LocalBoardActionProvider(env.Client, start); var accepted = start.View.Token;
            foreach (var step in fixture["steps"].Skip(1).TakeWhile(value => (string)value["command"]["kind"] == "act"))
            {
                var action = step["command"]["action"]; BoardAction gesture;
                switch ((string)action["_tag"])
                {
                    case "Move": gesture = new BoardAction(BoardActionKind.Move, (byte)action["row"], (byte)action["start"], (byte)action["destination"]); break;
                    case "Bonus": gesture = new BoardAction(BoardActionKind.Guardian, (byte)action["row"], (byte)action["column"]); break;
                    case "Reroll": gesture = Reroll; break;
                    case "Finish": gesture = Finish; break;
                    default: throw new ArgumentException("Unknown fixture action");
                }
                if ((bool)step["rejected"])
                {
                    var error = await Reject<Exception>(() => provider.Submit(accepted, gesture, None));
                    Assert.That(error is NativeEngineException || error is InvalidOperationException, Is.True);
                }
                else
                {
                    var result = await provider.Submit(accepted, gesture, None);
                    Assert.That(result.IsSnapshot, Is.False); accepted = result.Token;
                    while (NativeEngine.Summary(accepted).Phase == (byte)CorePhase.AwaitingVrf)
                    { result = await provider.ResolveVrf(accepted, None); Assert.That(result.IsSnapshot, Is.False); accepted = result.Token; }
                    Assert.That(string.Concat(accepted.State.Select(value => value.ToString("x2"))), Is.EqualTo((string)step["result"]["tokenHex"]));
                }
                Assert.That(JToken.DeepEquals(JObject.Parse(env.Disk ?? LocalProductCodec.Encode(new LocalProductState())), step["persisted"]), Is.True);
                Assert.That(provider.PersistenceFailure, Is.Null);
            }
        }

        [TestCase(false)] [TestCase(true)]
        public async Task RerollDeliversOnlyItsAlreadyAcceptedNativeTransitions(bool daily)
        {
            var env = new Env(); var oracle = new Env();
            var start = daily ? env.Client.StartDaily() : env.Client.StartCampaign(1, 1);
            var reference = daily ? oracle.Client.StartDaily() : oracle.Client.StartCampaign(1, 1);
            var expected = oracle.Client.Act(reference.View.RunId, new LocalRunAction(LocalActionKind.Reroll));
            var provider = new LocalBoardActionProvider(env.Client, start);
            Assert.That(provider.Bind("Local").Daily, Is.EqualTo(daily));
            var first = await provider.Submit(start.View.Token, Reroll, None);
            Assert.That(first.IsSnapshot, Is.False);
            Same(expected.Transitions[0].Token, first.Token);
            Assert.That(NativeEngine.Summary(first.Token).Phase, Is.EqualTo((byte)CorePhase.AwaitingVrf));
            Same(expected.View.Token, env.Client.Observe(start.View.RunId).Token);
            await Reject<InvalidOperationException>(() => provider.Submit(first.Token, Reroll, None));
            var last = await provider.ResolveVrf(first.Token, None);
            Same(expected.Transitions[1].Token, last.Token);
            Assert.That(last.IsSnapshot, Is.False);
            await Reject<InvalidOperationException>(() => provider.ResolveVrf(last.Token, None));
            await Reject<InvalidOperationException>(() => provider.Submit(start.View.Token, Reroll, None));
            Same(expected.View.Token, env.Client.Observe(start.View.RunId).Token);
            Assert.That(provider.PersistenceFailure, Is.Null);
        }

        [Test]
        public async Task NativeRejectionLeavesSameRunAvailableForAnotherGesture()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            await Reject<NativeEngineException>(() => provider.Submit(start.View.Token, new BoardAction(BoardActionKind.Guardian), None));
            Same(start.View.Token, provider.AcceptedSnapshot); Assert.That(provider.PersistenceFailure, Is.Null);
            Assert.That((await provider.Submit(start.View.Token, Reroll, None)).IsSnapshot, Is.False);
        }

        [Test]
        public async Task CancellationBeforeEffectsAndRowDeliveryDoesNotLoseOrRepeatAcceptance()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            using var cancelled = new CancellationTokenSource(); cancelled.Cancel();
            await Reject<OperationCanceledException>(() => provider.Submit(start.View.Token, Reroll, cancelled.Token));
            Same(start.View.Token, provider.AcceptedSnapshot);
            var first = await provider.Submit(start.View.Token, Reroll, None); var final = provider.AcceptedSnapshot;
            await Reject<OperationCanceledException>(() => provider.ResolveVrf(first.Token, cancelled.Token));
            await Reject<InvalidOperationException>(() => provider.ResolveVrf(start.View.Token, None));
            Same(final, (await provider.ResolveVrf(first.Token, None)).Token);
            Same(final, provider.AcceptedSnapshot);
        }

        [Test]
        public async Task RecoverSkipsMissedCascadesAndReturnsSameSnapshotWithoutWrites()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            await provider.Submit(start.View.Token, Reroll, None); var accepted = provider.AcceptedSnapshot; int writes = env.Writes;
            var recovered = await provider.Recover(None); Assert.That(recovered.IsSnapshot, Is.True); Same(accepted, recovered.Token);
            Same(accepted, (await provider.Recover(None)).Token); Assert.That(env.Writes, Is.EqualTo(writes));
            await Reject<InvalidOperationException>(() => provider.ResolveVrf(recovered.Token, None));
            Assert.That((await provider.Submit(recovered.Token, Finish, None)).IsSnapshot, Is.False);
        }

        [Test]
        public async Task SuccessorCannotSatisfyStaleBoardOrConsumeItsQueuedDelivery()
        {
            var env = new Env(); var start = env.Client.StartCampaign(1, 1); var provider = new LocalBoardActionProvider(env.Client, start);
            var first = await provider.Submit(start.View.Token, Reroll, None);
            env.Client.Act(start.View.RunId, new LocalRunAction(LocalActionKind.Finish));
            var successor = env.Client.StartCampaign(1, 1);
            await Reject<InvalidOperationException>(() => provider.ResolveVrf(first.Token, None));
            Assert.That(await provider.Recover(None), Is.Null);
            await Reject<InvalidOperationException>(() => provider.Submit(first.Token, Finish, None));
            Same(successor.View.Token, env.Client.Active("campaign").Token);
            Assert.That(provider.PersistenceFailure, Is.Null);
        }

        [Test]
        public async Task GuardedActRejectsExternalAdvanceAndRecoveryRebindsOnlySameRun()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            var advanced = env.Client.Act(start.View.RunId, new LocalRunAction(LocalActionKind.Reroll));
            await Reject<InvalidOperationException>(() => provider.Submit(start.View.Token, Finish, None));
            Same(advanced.View.Token, env.Client.Active("arcade").Token);
            var recovered = await provider.Recover(None); Same(advanced.View.Token, recovered.Token);
            await provider.Submit(recovered.Token, Finish, None);
        }

        [Test]
        public async Task ExternalSuccessfulCompletionIsNotMisreportedAsSaveFailure()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            var completed = env.Client.Act(start.View.RunId, new LocalRunAction(LocalActionKind.Finish));
            await Reject<InvalidOperationException>(() => provider.Submit(start.View.Token, Reroll, None));
            Assert.That(provider.PersistenceFailure, Is.Null);
            Same(completed.View.Token, (await provider.Recover(None)).Token);
            var successor = env.Client.StartCampaign(1, 1);
            Assert.That(await provider.Recover(None), Is.Not.Null, "The other mode must not replace this run");
            Same(successor.View.Token, env.Client.Active("campaign").Token);
        }

        [Test]
        public async Task DurableWriteFailureRetainsAcceptedTerminalTokenAndNeverLabelsItSaved()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            string disk = env.Disk; env.Fail = true;
            var error = await Reject<InvalidOperationException>(() => provider.Submit(start.View.Token, Finish, None));
            Assert.That(error.InnerException, Is.TypeOf<LocalRunPersistenceException>());
            Assert.That(provider.PersistenceFailure, Is.TypeOf<IOException>());
            var terminal = provider.AcceptedSnapshot;
            Assert.That(NativeEngine.Summary(terminal).Phase, Is.EqualTo((byte)CorePhase.Finished));
            Assert.That(env.Client.Active("arcade"), Is.Null); Assert.That(env.Disk, Is.EqualTo(disk));
            int writes = env.Writes;
            await Reject<InvalidOperationException>(() => provider.Submit(start.View.Token, Finish, None));
            var snapshot = await provider.Recover(None); Assert.That(snapshot.IsSnapshot, Is.True); Same(terminal, snapshot.Token);
            Same(terminal, (await provider.Recover(None)).Token);
            Assert.That(env.Writes, Is.EqualTo(writes), "Recovery must not silently retry the failed save");
            Assert.That(env.Disk, Is.EqualTo(disk)); Assert.That(provider.PersistenceFailure, Is.TypeOf<IOException>());
        }

        [Test]
        public async Task FailedReservationCanBindExistingAcceptedRunWithExplicitUnsavedState()
        {
            var env = new Env { Fail = true }; var error = Assert.Throws<IOException>(() => env.Client.StartDaily());
            var view = env.Client.Active("arcade"); Assert.That(view, Is.Not.Null);
            var provider = new LocalBoardActionProvider(env.Client, view, error);
            Same(view.Token, provider.Bind("Daily").Accepted);
            Same(view.Token, (await provider.Recover(None)).Token);
            Assert.That(provider.PersistenceFailure, Is.SameAs(error)); Assert.That(env.Disk, Is.Null); Assert.That(env.Writes, Is.EqualTo(1));
        }

        [Test]
        public async Task CancellationAfterDurableAcceptanceDoesNotTurnSuccessIntoRejection()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            using var cancellation = new CancellationTokenSource(); env.AfterWrite = cancellation.Cancel;
            var result = await provider.Submit(start.View.Token, Finish, cancellation.Token);
            Assert.That(cancellation.IsCancellationRequested, Is.True);
            Same(env.Client.Observe(start.View.RunId).Token, result.Token); Assert.That(provider.PersistenceFailure, Is.Null);
        }

        [Test]
        public async Task ReturnedCopiesCannotCorruptAcceptedOrQueuedNativeState()
        {
            var env = new Env(); var start = env.Client.StartDaily(); var provider = new LocalBoardActionProvider(env.Client, start);
            provider.Bind("Daily").Accepted.State[0] ^= 1;
            var first = await provider.Submit(start.View.Token, Reroll, None); var before = first.Token; var expected = provider.AcceptedSnapshot;
            first.Token.State[0] ^= 1; first.Transition.Token.State[0] ^= 1;
            provider.AcceptedSnapshot.State[0] ^= 1; env.Client.Observe(start.View.RunId).Token.Config[0] ^= 1;
            Same(expected, (await provider.ResolveVrf(before, None)).Token);
            Same(expected, provider.AcceptedSnapshot);
        }
    }
}
