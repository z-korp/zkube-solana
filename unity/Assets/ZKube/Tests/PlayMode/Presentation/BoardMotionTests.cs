using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardMotionTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        [UnitySetUp] public IEnumerator SetUp()
        {
            root = new GameObject("Motion test board"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.SetMuted(true);
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            board.SetReducedMotion(false);
            UnityEngine.Object.Destroy(root); yield return null;
        }
        private static IEnumerator Wait(Func<bool> condition)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!condition())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for the board");
                yield return null;
            }
        }
        private static IEnumerator Seconds(float seconds)
        {
            float end = Time.realtimeSinceStartup + seconds;
            while (Time.realtimeSinceStartup < end) yield return null;
        }
        private IEnumerator Load(string fixture, bool reduced)
        {
            board.SetReducedMotion(reduced); evidence.Load(fixture);
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
        }
        // The fixture's player inputs; its deadline, if any, is bound separately.
        private int Inputs() => evidence.Current.steps.Count(step => step.operation != ZKube.Core.Generated.NativeOperation.ApplyVrf &&
            !(step.operation == ZKube.Core.Generated.NativeOperation.Finish && step.reason != 3));
        private Dictionary<int, SpriteRenderer> Blocks() => (Dictionary<int, SpriteRenderer>)typeof(BoardView)
            .GetField("blocks", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board.View);
        private Image Guardian() => board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Calm realm guardian");

        // Every visible block rests exactly on its native cell, at its full size and colour.
        private void AssertResting()
        {
            var grid = NativeEngine.Summary(board.Session.Accepted).Grid;
            Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Settled(board.View, grid));
            var cell = board.View.Layout.Cell;
            foreach (var pair in Blocks())
            {
                var size = pair.Value.bounds.size;
                Assert.AreEqual(grid[pair.Key] * cell - 2, size.x, .05f, pair.Value.name + " keeps no squash");
                Assert.AreEqual(cell - 2, size.y, .05f, pair.Value.name + " keeps no squash");
                Assert.AreEqual(Color.white, pair.Value.color, pair.Value.name + " is fully drawn");
            }
        }

        [UnityTest] public IEnumerator AnimatedClearsFallsAndInsertsEndOnTheNativeGridAndReleaseTheirEffects()
        {
            yield return Load("balam-combo-2", false);
            for (int i = 0; i < Inputs(); i++)
            {
                yield return evidence.PlayNextInput();
                yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                AssertResting();
            }
            Assert.Greater(board.View.Effects.Created, 0, "The fixture's clears threw particles");
            yield return Seconds(1.2f);
            Assert.AreEqual(0, board.View.Effects.Live, "Every effect finishes and returns to the pool");
            Assert.AreEqual(board.State.Grid.Length, board.View.DisplayGrid.Length);
        }

        [UnityTest] public IEnumerator BlockAndEffectSpritesArePooledRatherThanRecreated()
        {
            yield return Load("realm-8-daily", false);
            yield return evidence.PlayNextInput();
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            int afterFirst = board.View.BlockSpritesCreated;
            Assert.GreaterOrEqual(Inputs(), 4, "The fixture has several actions to replay");
            for (int i = 1; i < Inputs(); i++)
            {
                yield return evidence.PlayNextInput();
                yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            }
            // A board holds at most 80 blocks, 8 more wait in the tray and 8 rise from it.
            Assert.LessOrEqual(board.View.BlockSpritesCreated, 96);
            Assert.LessOrEqual(board.View.BlockSpritesCreated, afterFirst + 16, "Later actions reuse the first action's sprites");
            Assert.LessOrEqual(board.View.Effects.Created, BoardFx.PoolSize);
        }

        [UnityTest] public IEnumerator ReducedMotionThrowsNoParticlesKeepsTheGuardianStillAndSettles()
        {
            yield return Load("balam-combo-2", true);
            for (int i = 0; i < Inputs(); i++)
            {
                yield return evidence.PlayNextInput();
                yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                AssertResting();
                Assert.AreEqual(Vector3.one, Guardian().rectTransform.localScale, "Reduced motion does not breathe or bounce");
            }
            Assert.AreEqual(0, board.View.Effects.Created, "Reduced motion throws no particles");
        }

        [UnityTest] public IEnumerator AClearStormDrawsFewerPiecesInsteadOfGrowingThePool()
        {
            var fx = board.View.Effects;
            var center = (Vector2)board.View.Layout.Board.center; float cell = board.View.Layout.Cell;
            int per = fx.ShardsPerBlock(80);
            Assert.Less(per, 6, "Eighty blocks at once share the pool");
            for (int i = 0; i < 80; i++) fx.BlockClear(center, 1, cell, Color.white, per, 1, i);
            // Even more blocks than the pool can draw leave the reserve untouched.
            for (int i = 0; i < 40; i++) fx.BlockClear(center, 1, cell, Color.white, BoardFx.MaxShards, 1, i);
            Assert.LessOrEqual(fx.Live, BoardFx.PoolSize - BoardFx.CelebrationReserve, "Clears leave the celebration reserve");
            int beforeBurst = fx.Live;
            fx.Celebrate(center, cell, Color.white, 36, BoardView.PerfectClearScale);
            Assert.AreEqual(beforeBurst + 38, fx.Live, "A perfect-clear burst still gets its glow, ring and pieces");
            yield return Seconds(1.2f);
            Assert.AreEqual(0, fx.Live);
            Assert.AreEqual(8, fx.ShardsPerBlock(1), "An empty pool gives one block its full break");
        }

        [UnityTest] public IEnumerator ShardsReadAtArmsLengthAndCombosBreakHarderBelowThePerfectClear()
        {
            var fx = board.View.Effects;
            var center = (Vector2)board.View.Layout.Board.center; float cell = board.View.Layout.Cell;
            fx.BlockClear(center, 1, cell, Color.red, 8, 1, 0);
            yield return Seconds(.06f);
            var shards = board.View.GetComponentsInChildren<SpriteRenderer>().Where(r => r.name == "Board effect" && r.sprite.name.Replace("(Clone)", "") == "fx-shard").ToArray();
            Assert.AreEqual(8, shards.Length, "A single cleared block throws eight shards");
            foreach (var shard in shards)
            {
                // The drawn sprite's own size, whatever its spin.
                float size = shard.transform.localScale.y * shard.sprite.bounds.size.y / cell;
                Assert.That(size, Is.InRange(.28f, .5f), "A shard is about a third of a cell");
                Assert.AreEqual(Color.red.r, shard.color.r, .01f, "Shards take the block's colour");
            }
            for (int clears = 1; clears < 6; clears++) Assert.Less(BoardView.ComboStrength(clears), BoardView.ComboStrength(clears + 1) + 1e-4f);
            Assert.Greater(BoardView.ComboStrength(2), BoardView.ComboStrength(1), "A combo breaks harder than a single clear");
            Assert.Less(BoardView.ComboStrength(99) + .3f, BoardView.PerfectClearScale, "The perfect clear stays the biggest burst");
        }

        [UnityTest] public IEnumerator ScoreCountsUpToTheAcceptedValueAndNeverPastIt()
        {
            yield return Load("balam-combo-2", false);
            var score = board.View.GetComponentsInChildren<TMPro.TMP_Text>().Single(text => text.name == "Score");
            uint before = board.State.DailyScore;
            uint highest = 0;
            for (int i = 0; i < Inputs() && board.State.DailyScore == before; i++)
            {
                var input = evidence.PlayNextInput();
                while (input.MoveNext()) { highest = Math.Max(highest, uint.Parse(score.text)); yield return input.Current; }
            }
            Assert.Greater(board.State.DailyScore, before, "The fixture's action scores");
            for (float end = Time.realtimeSinceStartup + 1.5f; Time.realtimeSinceStartup < end;)
            {
                highest = Math.Max(highest, uint.Parse(score.text));
                yield return null;
            }
            Assert.AreEqual(board.State.DailyScore.ToString(), score.text);
            Assert.LessOrEqual(highest, board.State.DailyScore);
            Assert.AreEqual(Vector3.one, score.rectTransform.localScale);
        }

        [UnityTest] public IEnumerator EarnedStarsPopAndTheGuardianCheersThenReturnsToItsCalmFace()
        {
            yield return Load("realm-8-campaign", false);
            var star = board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Star 0 glyph");
            var origin = star.rectTransform.anchoredPosition;
            board.View.Celebrate(0, 1, 0, false);
            yield return Seconds(.15f);
            Assert.Greater(star.rectTransform.localScale.x, 1.05f, "A newly earned star pops");
            Assert.AreEqual("boss__celebrate", Guardian().sprite.name.Replace("(Clone)", ""));
            yield return Seconds(1);
            Assert.AreEqual(Vector3.one, star.rectTransform.localScale);
            Assert.AreEqual(origin, star.rectTransform.anchoredPosition);
            Assert.AreEqual("boss__idle", Guardian().sprite.name.Replace("(Clone)", ""));

            board.SetReducedMotion(true);
            board.View.Celebrate(0, 2, 0, false);
            yield return Seconds(.15f);
            Assert.AreEqual(Vector3.one, board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Star 1 glyph").rectTransform.localScale);
            Assert.AreEqual(Vector3.one, Guardian().rectTransform.localScale);
        }
    }
}
