using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    // DECISIONS 2026-10-02: every block move and every line break has its
    // sound, and a result sounds by the stars it kept.
    public sealed class BoardSoundTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        private readonly List<string> played = new List<string>();

        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Board sound tests");
            board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            board.SetMuted(true); board.SoundPlayed += played.Add;
        }
        [UnityTearDown] public IEnumerator TearDown()
        { UnityEngine.Object.Destroy(root); yield return null; }
        private IEnumerator Wait(Func<bool> predicate)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!predicate())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Board sound timed out: " + "Board is still busy or loading");
                yield return null;
            }
        }
        private static string[] Cues() => typeof(SoundCues).GetFields(BindingFlags.Public | BindingFlags.Static).Select(field => (string)field.GetValue(null)).ToArray();
        private int Count(string cue) => played.Count(name => name == cue);
        private bool Terminal => board.State.Phase == (byte)CorePhase.Finished || board.State.Phase == (byte)CorePhase.LevelComplete;

        // The codegen imports the clips and names the cues from one list; a cue
        // whose clip is missing would play nothing.
        [Test] public void EverySoundCueHasItsImportedClip()
        {
            Assert.GreaterOrEqual(Cues().Length, 7);
            foreach (string cue in Cues())
                Assert.IsNotNull(Resources.Load<AudioClip>("ZKube/Audio/common/sounds__effects__" + cue), cue + " has no imported clip");
        }

        // Each accepted action, through whole native trajectories at both motion
        // settings: a move plays the move sound once, a guardian bonus its sound
        // once, each line break of the action (as the core's trace lists them)
        // the break sound once, a newly earned star the star sound once, and the
        // run's end exactly one result sound. Nothing else plays.
        [UnityTest] public IEnumerator EveryMoveLineBreakBonusStarAndResultSoundsExactlyOnce()
        {
            int moves = 0, breaks = 0;
            foreach (bool reduced in new[] { false, true })
                foreach (string fixture in new[] { "realm-1-campaign", "mayan-combo-2", "daily-pressure-crossing", "move-perfect-clear-grant",
                    "Wave-perfect-clear-continuation", "score-latch", "all-star-completion", "blocked-eleventh-row", "move-budget-exhaustion" })
                {
                    board.SetReducedMotion(reduced); evidence.Load(fixture);
                    yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
                    yield return null; // A new view takes input once drawn.
                    int index = 0;
                    foreach (var step in evidence.Current.steps.Where(step => step.operation != NativeOperation.ApplyVrf))
                    {
                        if (Terminal || step.operation == NativeOperation.Finish && step.reason != 3) break;
                        // A trajectory the pointer could not follow has no block to drag here.
                        if (step.operation == NativeOperation.PlayMove && board.View.DisplayGrid[step.row * 8 + step.start] == 0) break;
                        string at = fixture + (reduced ? " (reduced motion)" : "") + " action " + index++;
                        var token = board.Session.Accepted; var state = board.State;
                        RunTransition expected = step.operation == NativeOperation.PlayMove ? NativeEngine.PlayMove(token, state.ActionCounter, state.Moves, step.row, step.start, step.destination)
                            : step.operation == NativeOperation.ApplyBonus ? NativeEngine.ApplyBonus(token, state.ActionCounter, step.row, step.column) : null;
                        int lineBreaks = expected == null ? 0 : expected.Events.Count(e => e.Kind == PresentationKind.RowsCleared);
                        byte stars = state.LatchedStarSources;
                        played.Clear();
                        yield return evidence.PlayNextInput();
                        yield return Wait(() => !board.Busy);
                        // A critical stack's heartbeat keeps its own time; it has its own test.
                        played.RemoveAll(cue => cue == SoundCues.Heartbeat);
                        // The core lets a block pass its neighbours; a drag stops against
                        // them. Such a trajectory ends here for the pointer.
                        if (step.operation == NativeOperation.PlayMove && board.State.ActionCounter == state.ActionCounter) { Assert.IsEmpty(played, at + ": a refused drag is silent"); break; }
                        Assert.AreEqual(step.operation == NativeOperation.PlayMove ? 1 : 0, Count(SoundCues.Move), at + ": the move sound");
                        Assert.AreEqual(step.operation == NativeOperation.ApplyBonus ? 1 : 0, Count(SoundCues.Bonus), at + ": the bonus sound");
                        Assert.AreEqual(lineBreaks, Count(SoundCues.LineBreak), at + ": one sound per line break");
                        Assert.AreEqual(HudLayout.NewStars(stars, board.State.LatchedStarSources).Any() ? 1 : 0, Count(SoundCues.Star), at + ": the star sound");
                        var results = played.Where(cue => cue == SoundCues.Loss || cue == SoundCues.SmallWin || cue == SoundCues.BigWin).ToArray();
                        CollectionAssert.AreEqual(Terminal ? new[] { BoardController.ResultCue(board.Session, board.State) } : new string[0], results, at + ": the result sound");
                        Assert.AreEqual(played.Count, Count(SoundCues.Move) + Count(SoundCues.Bonus) + Count(SoundCues.LineBreak) + Count(SoundCues.Star) + results.Length,
                            at + ": nothing else plays: " + string.Join(", ", played));
                        if (step.operation == NativeOperation.PlayMove) moves++;
                        breaks += lineBreaks;
                    }
                }
            Debug.Log("Sound test: " + moves + " moves, " + breaks + " line breaks");
            Assert.GreaterOrEqual(moves, 8, "The trajectories move blocks"); Assert.GreaterOrEqual(breaks, 6, "The trajectories break lines");
        }

        // The heartbeat sounds once a beat, from the frame the stack turns critical,
        // whether or not the line moves, and only while the run is in play: the
        // warning, a pause and a recovered board are silent.
        [UnityTest] public IEnumerator TheHeartbeatSoundsOnceABeatWhileTheStackIsCriticalAndTheRunIsInPlay()
        {
            byte[] Stack(int height) { var grid = new byte[80]; for (int row = 0; row < height; row++) grid[row * 8] = 1; return grid; }
            IEnumerator Beats(float beats) { float end = Time.unscaledTime + beats * BoardView.BeatSeconds; while (Time.unscaledTime < end) yield return null; }
            played.Clear();
            board.View.SetBoard(Stack(9)); yield return Beats(1.5f);
            Assert.AreEqual(0, Count(SoundCues.Heartbeat), "The warning is silent");
            board.View.SetBoard(Stack(10));
            Assert.AreEqual(1, Count(SoundCues.Heartbeat), "The first beat sounds as the stack turns critical");
            yield return Beats(2.5f);
            Assert.AreEqual(3, Count(SoundCues.Heartbeat), "One sound a beat");
            CollectionAssert.AreEqual(new[] { SoundCues.Heartbeat }, played.Distinct().ToArray());
            board.Pause(); yield return null; played.Clear(); yield return Beats(2.2f);
            Assert.IsEmpty(played, "A paused run is silent");
            board.Resume(); board.SetReducedMotion(true); yield return null; played.Clear(); yield return Beats(2.2f);
            Assert.GreaterOrEqual(Count(SoundCues.Heartbeat), 2, "It sounds when reduced motion holds the line still");
            board.SetReducedMotion(false);
            board.View.SetBoard(Stack(9)); played.Clear(); yield return Beats(1.5f);
            Assert.IsEmpty(played, "A recovered board is silent");
        }

        // Owner, 2026-10-06: reduced motion only stills the line. The heartbeat
        // sounds once a beat all the same, through the board's effects source,
        // and the Effects level alone says how loud: turning reduced motion on
        // changes neither that level nor the mute.
        [UnityTest] public IEnumerator ReducedMotionStillsTheLineAndTheHeartbeatStillSoundsAtTheEffectsLevel()
        {
            var grid = new byte[80]; for (int row = 0; row < 10; row++) grid[row * 8] = 1;
            var source = root.GetComponents<AudioSource>().Single(value => !value.loop);
            var line = board.View.GetComponentsInChildren<SpriteRenderer>(true).Single(sprite => sprite.name == "Danger line");
            float level = source.volume; bool mute = source.mute;
            Assert.AreEqual((float)board.EffectsVolume, level, "The cue's source plays at the Effects level");
            board.SetReducedMotion(true); yield return null;
            try
            {
                Assert.AreEqual(level, source.volume, "Reduced motion leaves the Effects level alone"); Assert.AreEqual(mute, source.mute);
                played.Clear(); board.View.SetBoard(grid); yield return null;
                float alpha = line.color.a, thickness = line.bounds.size.y;
                for (float end = Time.unscaledTime + 2.5f * BoardView.BeatSeconds - Time.unscaledDeltaTime; Time.unscaledTime < end;)
                {
                    Assert.AreEqual(alpha, line.color.a, 1e-4f, "The line is still"); Assert.AreEqual(thickness, line.bounds.size.y, 1e-3f, "The line is still");
                    yield return null;
                }
                Assert.AreEqual(3, Count(SoundCues.Heartbeat), "One sound a beat, as with motion");
                CollectionAssert.AreEqual(new[] { SoundCues.Heartbeat }, played.Distinct().ToArray());
                Assert.AreEqual(level, source.volume); Assert.AreEqual(mute, source.mute);
            }
            finally { board.SetReducedMotion(false); }
        }

        // No stars is the loss, one or two a small win, three a big win; an ended
        // Campaign run keeps none. A Daily with no score is the loss.
        [UnityTest] public IEnumerator AResultSoundsByTheStarsItKept()
        {
            evidence.Load("realm-1-campaign");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            var state = board.State; byte latched = state.LatchedStarSources, reason = state.EndReason;
            try
            {
                for (byte sources = 0; sources < 8; sources++)
                {
                    state.LatchedStarSources = sources; state.EndReason = 2;
                    int stars = HudLayout.StarCount(sources);
                    Assert.AreEqual(stars == 0 ? SoundCues.Loss : stars == 3 ? SoundCues.BigWin : SoundCues.SmallWin, BoardController.ResultCue(board.Session, state), "sources " + sources);
                    state.EndReason = 3;
                    Assert.AreEqual(SoundCues.Loss, BoardController.ResultCue(board.Session, state), "An ended run keeps no stars");
                }
            }
            finally { state.LatchedStarSources = latched; state.EndReason = reason; }
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            uint score = board.State.DailyScore;
            try
            {
                board.State.DailyScore = 0; Assert.AreEqual(SoundCues.Loss, BoardController.ResultCue(board.Session, board.State));
                board.State.DailyScore = 12; Assert.AreNotEqual(SoundCues.Loss, BoardController.ResultCue(board.Session, board.State));
                // The big win is a score over the best that was read; an unread best is beaten by nothing.
                BoardSession With(ulong? best) => new BoardSession(board.Session.Accepted, board.Session.Rules, board.Session.Actions, board.Session.RealmId, new DailyContext { Best = best });
                Assert.AreEqual(SoundCues.BigWin, BoardController.ResultCue(With(11), board.State));
                Assert.AreEqual(SoundCues.SmallWin, BoardController.ResultCue(With(12), board.State));
                Assert.AreEqual(SoundCues.SmallWin, BoardController.ResultCue(With(null), board.State));
            }
            finally { board.State.DailyScore = score; }
        }
    }
}
