using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        // What a board presents, in order: every transition it moves for as the
        // core listed it, every sound cue, every accepted state and the gains
        // shown for it.
        private sealed class Feel
        {
            public readonly List<string> Lines = new List<string>();
            private readonly BoardController board;
            private bool accepted;
            public Feel(BoardController board)
            {
                this.board = board;
                board.Traced += events => Lines.Add("trace " + string.Join(" ", events.Select(e => e.Kind + ":" + BitConverter.ToString(e.Payload))));
                board.SoundPlayed += cue => Lines.Add("sound " + cue);
                board.Host.Accepted += token => { var state = NativeEngine.Summary(token);
                    Lines.Add("accepted action=" + state.ActionCounter + " phase=" + state.Phase + " score=" + state.DailyScore); accepted = true; };
            }
            // The gains are drawn with the acceptance; they are read on its frame.
            public void Frame()
            {
                if (!accepted) return;
                accepted = false;
                Lines.Add("gains " + string.Join(",", board.View.GetComponentsInChildren<TMP_Text>().Where(text => text.name.StartsWith("Accepted"))
                    .Select(text => text.name + "=" + text.text).OrderBy(text => text)));
            }
            public IEnumerator Until(Func<bool> done, string what)
            {
                float until = Time.realtimeSinceStartup + 15;
                while (!done() && Time.realtimeSinceStartup < until) { Frame(); yield return null; }
                Frame(); Assert.That(done(), Is.True, what + "\n" + string.Join("\n", Lines));
            }
        }
        private IEnumerator DragDailyMove(BoardController board)
        {
            var move = environment.DailyMove; int row = (int)move["row"], start = (int)move["start"], destination = (int)move["destination"];
            int width = board.View.DisplayGrid[row * 8 + start];
            yield return ZKube.Presentation.Tests.TestBoardPointer.Drag(board.View.Layout.CellCenter(row, start, width), board.View.Layout.CellCenter(row, destination, width));
        }
        private IEnumerator OpenEnteredDaily()
        {
            yield return PrepareScenario("daily-entered"); Click("Connect"); yield return Idle();
            yield return SessionClick("Resume run"); yield return BoardReady();
        }
        // The same run on the shared RunBoard, confirmed as a local run is: the
        // core's result at once, then the row when the board asks for it.
        private sealed class LocalTwin : IBoardActionProvider
        {
            public Task<CoreRunToken> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation) => Task.FromResult(action.Play(accepted).Token);
            public Task<CoreRunToken> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation) => Task.FromResult(
                NativeEngine.ApplyVrf(accepted, NativeEngine.Summary(accepted).LastVrfCounter + 1, Enumerable.Repeat((byte)9, 32).ToArray()).Token);
        }

        // The journey twin for the board itself: a Daily move on the Arena, whose
        // row lands on the rollup with the move, presents exactly what the same
        // move presents on the shared RunBoard.
        [UnityTest] public IEnumerator ADailyMoveOnTheArenaPresentsWhatTheSameMovePresentsOnTheSharedRunBoard()
        {
            yield return OpenEnteredDaily();
            var arena = PlayedBoard(); var feel = new Feel(arena);
            var rules = arena.Session.Rules; var opened = arena.Session.Accepted; byte realm = arena.Session.RealmId; var daily = arena.Session.DailyFacts;
            yield return DragDailyMove(arena);
            yield return feel.Until(() => arena.State.ActionCounter == 1 && !arena.Busy, "The Arena's move was accepted");
            Assert.That(arena.State.Phase, Is.EqualTo((byte)CorePhase.Playing));
            Assert.That(arena.View.StatusText, Is.Empty);
            Assert.That(feel.Lines.Count(line => line.StartsWith("trace")), Is.EqualTo(2), "The move, then its row");
            Assert.That(feel.Lines.First(), Does.StartWith("trace " + PresentationKind.BlockMoved), "The board moves before anything is accepted");
            Assert.That(feel.Lines.Any(line => line == "sound " + SoundCues.Move), Is.True);
            yield return Cleanup(); host = null;

            var local = new GameObject("Shared run board");
            try
            {
                var shared = local.AddComponent<RunBoard>(); shared.Initialize();
                shared.Open(new BoardSession(opened, rules, new LocalTwin(), realm, daily), () => false, _ => { }, () => { });
                float until = Time.realtimeSinceStartup + 15;
                while (!ZKube.Tests.Presentation.BoardTestState.Idle(shared.Board) && Time.realtimeSinceStartup < until) yield return null;
                Assert.That(ZKube.Tests.Presentation.BoardTestState.Idle(shared.Board), Is.True, "The shared board opened");
                var twin = new Feel(shared.Board);
                // A board made this frame takes touches from the next.
                yield return null;
                yield return DragDailyMove(shared.Board);
                yield return twin.Until(() => shared.Board.State.ActionCounter == 1 && !shared.Board.Busy, "The shared board's move was accepted");
                Assert.That(feel.Lines, Is.EqualTo(twin.Lines), "Arena:\n" + string.Join("\n", feel.Lines) + "\n\nShared:\n" + string.Join("\n", twin.Lines));
            }
            finally { UnityEngine.Object.Destroy(local); }
        }

        // A row that is late: the move plays and is accepted, the board waits with
        // its quiet indicator, and the row is presented when the rollup has it.
        [UnityTest] public IEnumerator ALateRowIsWaitedForAndPresentedWhenItArrives()
        {
            yield return OpenEnteredDaily();
            var board = PlayedBoard(); var feel = new Feel(board);
            environment.RowsArriveLate = true;
            yield return DragDailyMove(board);
            yield return feel.Until(() => board.State.ActionCounter == 1, "The move was accepted without its row");
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.AwaitingVrf));
            Assert.That(feel.Lines.Count(line => line.StartsWith("trace")), Is.EqualTo(1));
            yield return feel.Until(() => board.View.AwaitingShown, "The board shows that it waits for the row");
            Assert.That(board.Busy, Is.True); Assert.That(board.View.StatusText, Is.Empty);
            environment.DeliverRow();
            yield return feel.Until(() => !board.Busy, "The row arrived");
            Assert.That(board.State.Phase, Is.EqualTo((byte)CorePhase.Playing));
            Assert.That(feel.Lines.Last(line => line.StartsWith("trace")), Does.StartWith("trace " + PresentationKind.PreviewChanged));
            Assert.That(board.View.AwaitingShown, Is.False); Assert.That(board.RecoveryRequired, Is.False);
            Assert.That(Asked("sendTransaction"), Is.EqualTo(2), "The opening request and the move; the row is only read");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Pause, then Home, on the Arena's Daily: the run stays in flight on the
        // rollup, nothing is sent or signed, and the landing page's one action is
        // Resume run, which opens the same run without sending anything.
        [UnityTest] public IEnumerator HomeFromThePauseLeavesTheDailyInFlightAndResumeRunReturnsToIt()
        {
            yield return OpenEnteredDaily();
            var state = (byte[])PlayedBoard().Session.Accepted.State.Clone();
            int sent = Asked("sendTransaction"), signed = Asked("signTransactions");
            Click("Pause"); yield return null; Click(PauseDialog.Home); yield return Idle();
            Assert.That(host.GetComponent<ZKube.Integration.Presentation.MoneyBoardHost>().HasRun, Is.False);
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Home));
            Assert.That(Offers("Resume run"), Is.True); Assert.That(Offers("Enter · 1 Kredit"), Is.False);
            Assert.That(Asked("sendTransaction"), Is.EqualTo(sent)); Assert.That(Asked("signTransactions"), Is.EqualTo(signed));
            yield return SessionClick("Resume run"); yield return BoardReady();
            Assert.That(PlayedBoard().Session.Accepted.State, Is.EqualTo(state)); Assert.That(PlayedBoard().Paused, Is.False);
            Assert.That(Asked("sendTransaction"), Is.EqualTo(sent), "A run that is open is resumed by reading it");
            Assert.That(Asked("signTransactions"), Is.EqualTo(signed));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        // The same on the Arena's Campaign: the run stays saved on the device and
        // its level resumes it.
        [UnityTest] public IEnumerator HomeFromThePauseLeavesTheArenasCampaignRunSavedAndItsLevelResumesIt()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            Click("Campaign"); yield return Idle(); Click("Trial 1"); yield return Idle();
            Click("Play"); yield return BoardReady();
            var runs = environment.Services.Campaign(environment.Owner).Runs;
            string run = runs.Active("campaign").RunId; var state = (byte[])PlayedBoard().Session.Accepted.State.Clone();
            Click("Pause"); yield return null; Click(PauseDialog.Home); yield return Idle();
            var controller = host.GetComponent<ZKube.Integration.App.MoneyIdentity>().Controller;
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Home));
            Assert.That(runs.Active("campaign")?.RunId, Is.EqualTo(run), "The level's run is still saved");
            Click("Campaign"); yield return Idle(); Click("Trial 1"); yield return Idle();
            Click("Resume run"); yield return BoardReady();
            Assert.That(PlayedBoard().Session.Accepted.State, Is.EqualTo(state));
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A move the rollup refuses: the board had moved, so it goes back to the
        // accepted run and says so. Nothing asks for a tap, the move is not sent
        // again, and the next move plays.
        [UnityTest] public IEnumerator ARefusedMoveSettlesTheBoardOnTheAcceptedRunWithANotice()
        {
            yield return OpenEnteredDaily();
            var board = PlayedBoard(); var feel = new Feel(board);
            var opened = board.Session.Accepted; var grid = (byte[])board.View.DisplayGrid.Clone();
            int sent = Asked("sendTransaction");
            // The rollup takes its time, as on a phone: the board moves first.
            environment.RefuseNextRunAction(); delay = environment.HoldNextRead("sendTransaction");
            yield return DragDailyMove(board);
            yield return feel.Until(() => feel.Lines.Any(line => line.StartsWith("trace")), "The board moved for the swipe");
            Assert.That(board.View.DisplayGrid, Is.Not.EqualTo(grid)); Assert.That(board.Busy, Is.True);
            Assert.That(board.Session.Accepted.State, Is.EqualTo(opened.State), "Nothing is accepted while the rollup has not answered");
            delay.Release();
            yield return feel.Until(() => !board.Busy, "The refused move was settled");
            Assert.That(feel.Lines.Any(line => line.StartsWith("accepted")), Is.False, "Nothing the rollup refused is accepted");
            Assert.That(board.Session.Accepted.State, Is.EqualTo(opened.State));
            Assert.That(board.View.DisplayGrid, Is.EqualTo(grid), "The board is back on the accepted run");
            Assert.That(board.View.StatusText, Is.EqualTo(BoardNotices.Text(BoardNotice.Settled)));
            Assert.That(board.RecoveryRequired, Is.False);
            Assert.That(Asked("sendTransaction"), Is.EqualTo(sent + 1), "The refused move was sent once and never again");
            yield return DragDailyMove(board);
            yield return feel.Until(() => board.State.ActionCounter == 1 && !board.Busy, "The next move is accepted");
            Assert.That(board.View.StatusText, Is.Empty);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
