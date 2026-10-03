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
            }
            finally { board.State.DailyScore = score; }
        }
    }
}
