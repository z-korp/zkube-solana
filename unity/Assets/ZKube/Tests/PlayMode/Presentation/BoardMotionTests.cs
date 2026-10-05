using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;
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
        private SpriteRenderer Guardian() => board.View.GetComponentsInChildren<SpriteRenderer>().Single(sprite => sprite.name == "Calm realm guardian");

        // Every visible block rests exactly on its native cell, at its full size and colour.
        private void AssertResting()
        {
            var grid = NativeEngine.Summary(board.Session.Accepted).Grid;
            Assert.IsTrue(ZKube.Tests.Presentation.BoardTestState.Settled(board.View, grid));
            var cell = board.View.Layout.Cell;
            foreach (var pair in Blocks())
            {
                var size = pair.Value.bounds.size;
                Assert.AreEqual(grid[pair.Key] * cell - .06f * cell, size.x, .05f, pair.Value.name + " keeps no squash");
                Assert.AreEqual(.94f * cell, size.y, .05f, pair.Value.name + " keeps no squash");
                Assert.AreEqual(Color.white, pair.Value.color, pair.Value.name + " is fully drawn");
            }
        }

        [UnityTest] public IEnumerator AnimatedClearsFallsAndInsertsEndOnTheNativeGridAndReleaseTheirEffects()
        {
            yield return Load("mayan-combo-2", false);
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

        [UnityTest] public IEnumerator TheIncomingRowNeverCrossesAVisibleNextRowLabel()
        {
            yield return Load("mayan-combo-2", false);
            var label = board.View.GetComponentsInChildren<TMPro.TMP_Text>().Single(t => t.name == "Next row label");
            float resting = label.color.a; int crossings = 0;
            var zone = SkinUi.ScreenRect(label.rectTransform);
            evidence.StartCoroutine(evidence.PlayNextInput());
            for (float end = Time.realtimeSinceStartup + 3; Time.realtimeSinceStartup < end; )
            {
                yield return null;
                foreach (var block in board.View.GetComponentsInChildren<SpriteRenderer>().Where(r => r.name.StartsWith("Incoming block")))
                {
                    var b = block.bounds;
                    if (!new Rect(b.min.x, b.min.y, b.size.x, b.size.y).Overlaps(zone)) continue;
                    crossings++;
                    Assert.Less(label.color.a, .05f, "The label steps aside while the row crosses it");
                }
                if (ZKube.Tests.Presentation.BoardTestState.Idle(board) && crossings > 0) break;
            }
            Assert.Greater(crossings, 0, "The fixture's row crosses the label");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.AreEqual(resting, label.color.a, .001f, "The label returns once the row lands");
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
            yield return Load("mayan-combo-2", true);
            var guardianScale = Guardian().transform.localScale; var guardianPosition = Guardian().transform.position;
            for (int i = 0; i < Inputs(); i++)
            {
                yield return evidence.PlayNextInput();
                yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                AssertResting();
                Assert.AreEqual(guardianScale, Guardian().transform.localScale, "Reduced motion does not breathe or bounce");
                Assert.AreEqual(guardianPosition, Guardian().transform.position, "The guardian's body never moves");
            }
            Assert.AreEqual(0, board.View.Effects.Created, "Reduced motion throws no particles");
        }

        [UnityTest] public IEnumerator AClearStormDrawsFewerPiecesInsteadOfGrowingThePool()
        {
            var fx = board.View.Effects;
            var center = (Vector2)board.View.Layout.Board.center; float cell = board.View.Layout.Cell;
            var block = Blocks().Values.First();
            int per = fx.ChunksPerBlock(80);
            Assert.Less(per, 6, "Eighty blocks at once share the pool");
            for (int i = 0; i < 80; i++) fx.Break(block, 1, cell, Color.white, per, 1, i);
            // Even more blocks than the pool can draw leave the reserve untouched.
            for (int i = 0; i < 40; i++) fx.Break(block, 1, cell, Color.white, BoardFx.MaxChunks, 1, i);
            Assert.LessOrEqual(fx.Live, BoardFx.PoolSize - BoardFx.CelebrationReserve, "Clears leave the celebration reserve");
            int beforeBurst = fx.Live;
            fx.Burst(center, cell, Color.white, 8 * BoardView.PerfectClearScale / 2);
            Assert.AreEqual(beforeBurst + 2, fx.Live, "A perfect-clear burst still gets its burst and ring");
            yield return Seconds(1.2f);
            Assert.AreEqual(0, fx.Live);
            Assert.AreEqual(BoardFx.MaxChunks, fx.ChunksPerBlock(1), "An empty pool gives one block its full break");
        }

        [UnityTest] public IEnumerator ABlockShattersFromItsWholeLengthAndIsGoneBy600Ms()
        {
            var fx = board.View.Effects; float cell = board.View.Layout.Cell;
            var block = Blocks().Values.First();
            Assert.AreEqual(8, BoardFx.ChunksFor(1, 1)); Assert.AreEqual(12, BoardFx.ChunksFor(4, 1));
            Assert.Greater(BoardFx.ChunksFor(2, BoardView.ComboStrength(3)), BoardFx.ChunksFor(2, 1), "Combos throw more chunks");
            fx.Break(block, 4, cell, Color.red, BoardFx.ChunksFor(4, 1), 1, 5);
            yield return null;
            var effects = board.View.GetComponentsInChildren<SpriteRenderer>().Where(r => r.name == "Board effect").ToArray();
            Assert.IsTrue(effects.Any(r => r.sprite == block.sprite && r.sharedMaterial.shader.name == "ZKube/SpriteFlash"),
                "The block's own shape flashes");
            yield return Seconds(.1f);
            var chunks = effects.Where(r => r.gameObject.activeSelf && r.sprite.name.StartsWith("fx-shard-")).ToArray();
            Assert.AreEqual(12, chunks.Length);
            float spread = chunks.Max(r => r.transform.position.x) - chunks.Min(r => r.transform.position.x);
            Assert.Greater(spread, 2.5f * cell, "Chunks come from the whole block, not its centre");
            yield return Seconds(.35f);
            float centre = block.transform.position.x;
            foreach (var chunk in chunks.Where(r => r.gameObject.activeSelf))
            {
                Assert.LessOrEqual(Mathf.Abs(chunk.transform.position.x - centre), 2 * cell + 1.05f * cell, "Chunks stay within a cell of their block");
                Assert.LessOrEqual(Mathf.Abs(chunk.transform.position.y - block.transform.position.y), 1.2f * cell);
                Assert.Less(chunk.color.a, .6f, "Chunks are fading well before 600 ms");
            }
            foreach (var chunk in chunks)
            {
                Assert.AreEqual(Color.red.r, chunk.color.r, "Chunks take the block's width colour");
                Assert.That(chunk.transform.localScale.y * chunk.sprite.bounds.size.y / cell, Is.InRange(.3f, .46f), "Chunks are 35-45% of a cell");
            }
            yield return Seconds(.2f);
            Assert.AreEqual(0, fx.Live, "Every piece is gone by 600 ms");
        }

        [UnityTest] public IEnumerator ShardsReadAtArmsLengthAndCombosBreakHarderBelowThePerfectClear()
        {
            var fx = board.View.Effects;
            float cell = board.View.Layout.Cell;
            fx.Break(Blocks().Values.First(), 1, cell, Color.red, BoardFx.ChunksFor(1, 1), 1, 0);
            yield return Seconds(.06f);
            var shards = board.View.GetComponentsInChildren<SpriteRenderer>().Where(r => r.name == "Board effect" && r.sprite.name.StartsWith("fx-shard-")).ToArray();
            Assert.AreEqual(8, shards.Length, "A single cleared block throws eight chunks");
            foreach (var shard in shards)
            {
                // The drawn sprite's own size, whatever its spin.
                float size = shard.transform.localScale.y * shard.sprite.bounds.size.y / cell;
                Assert.That(size, Is.InRange(.3f, .46f), "A chunk is 35-45% of a cell");
                Assert.AreEqual(Color.red.r, shard.color.r, .01f, "Shards take the block's colour");
            }
            for (int clears = 1; clears < 6; clears++) Assert.Less(BoardView.ComboStrength(clears), BoardView.ComboStrength(clears + 1) + 1e-4f);
            Assert.Greater(BoardView.ComboStrength(2), BoardView.ComboStrength(1), "A combo breaks harder than a single clear");
            Assert.Less(BoardView.ComboStrength(99) + .3f, BoardView.PerfectClearScale, "The perfect clear stays the biggest burst");
        }

        [UnityTest] public IEnumerator ScoreCountsUpToTheAcceptedValueAndNeverPastIt()
        {
            yield return Load("mayan-combo-2", false);
            var score = board.View.GetComponentsInChildren<TMPro.TMP_Text>().Single(text => text.name == "Score");
            uint before = board.State.DailyScore;
            uint highest = 0;
            for (int i = 0; i < Inputs() && board.State.DailyScore == before; i++)
            {
                var input = evidence.PlayNextInput();
                while (input.MoveNext()) { highest = Math.Max(highest, uint.Parse(score.text, System.Globalization.NumberStyles.AllowThousands, System.Globalization.CultureInfo.InvariantCulture)); yield return input.Current; }
            }
            Assert.Greater(board.State.DailyScore, before, "The fixture's action scores");
            for (float end = Time.realtimeSinceStartup + 1.5f; Time.realtimeSinceStartup < end;)
            {
                highest = Math.Max(highest, uint.Parse(score.text, System.Globalization.NumberStyles.AllowThousands, System.Globalization.CultureInfo.InvariantCulture));
                yield return null;
            }
            Assert.AreEqual(board.State.DailyScore.ToString("N0", System.Globalization.CultureInfo.InvariantCulture), score.text);
            Assert.LessOrEqual(highest, board.State.DailyScore);
            Assert.AreEqual(Vector3.one, score.rectTransform.localScale);
        }

        // Owner, 2026-10-05: once the stack reaches row 9 of 10 a glowing line
        // marks the limit along the top of the board, with embers rising from it,
        // steady. With no row free the line turns whiter and beats like a heart,
        // with more embers. It follows the stack in the frame the stack changes,
        // both ways: two free rows are calm, one warns, none is critical, and
        // back. No light sits on the rim or the glass. The guardian looks worried
        // and calms again. Reduced motion holds the line still, brighter when
        // critical, without embers or beat.
        private static byte[] Stack(int height) { var grid = new byte[80]; for (int row = 0; row < height; row++) grid[row * 8] = 1; return grid; }
        private static SpriteRenderer Piece(BoardView view, string name) => view.GetComponentsInChildren<SpriteRenderer>(true).Single(sprite => sprite.name == name);
        private static SpriteRenderer[] Embers(BoardView view) =>
            view.GetComponentsInChildren<SpriteRenderer>(true).Where(sprite => sprite.name.StartsWith("Danger ember") && sprite.enabled).ToArray();
        [UnityTest] public IEnumerator TheLimitLineShowsAtRowNineBeatsAtRowTenAndStopsTheFrameTheBoardRecovers()
        {
            Assert.AreEqual(1, BoardView.PressureRows);
            for (int free = 0; free <= 10; free++)
                Assert.AreEqual(free == 0 ? 2 : free == 1 ? 1 : 0, BoardView.PressureLevel(free), free + " free rows");
            yield return Load("realm-8-daily", false);
            var view = board.View; var original = (byte[])board.State.Grid.Clone();
            for (int height = 0; height <= 10; height++) Assert.AreEqual(10 - height, BoardView.FreeRows(Stack(height)), "A stack " + height + " high");
            Assert.AreEqual(0, view.Pressure, "The fixture opens calm");
            Assert.IsEmpty(view.GetComponentsInChildren<SpriteRenderer>(true).Where(sprite => sprite.name.StartsWith("Pressure")), "No light on the rim or the glass");
            var line = Piece(view, "Danger line"); var band = Piece(view, "Danger band");
            var top = new Vector2(view.Layout.Board.center.x, view.Layout.Board.yMax);
            float warningWhite = 0;
            foreach (var (height, level) in new[] { (7, 0), (8, 0), (9, 1), (10, 2), (9, 1), (8, 0), (10, 2), (3, 0) })
            {
                string at = "a stack " + height + " high";
                // The same frame: nothing is waited for.
                view.SetBoard(Stack(height));
                Assert.AreEqual(level, view.Pressure, at);
                Assert.AreEqual(level > 0, line.enabled, at + ": the line");
                Assert.AreEqual(level > 0, band.enabled, at + ": its glow");
                Assert.AreEqual(level == 0 ? 0 : level == 1 ? BoardView.WarningEmbers : BoardView.CriticalEmbers, Embers(view).Length, at + ": its embers");
                yield return null;
                if (level == 0)
                {
                    yield return Seconds(.2f);
                    Assert.IsFalse(line.enabled || band.enabled || Embers(view).Length != 0, at + ": it stays off");
                    Assert.AreEqual("idle", view.GuardianFace.Replace("blink", "idle"), at + ": the guardian is calm");
                    continue;
                }
                Assert.AreEqual(top.x, line.bounds.center.x, .5f, at + ": centred on the board");
                Assert.AreEqual(top.y, line.bounds.center.y, .5f, at + ": along the top of the board");
                Assert.GreaterOrEqual(line.bounds.size.x, view.Layout.Board.width, at + ": across the board");
                // Two beats of it: the warning is steady, the critical step beats in brightness and thickness.
                float lowLine = 1, highLine = 0, lowBand = 1, highBand = 0, thin = float.MaxValue, thick = 0, white = 1;
                var start = Embers(view).ToDictionary(ember => ember, ember => ember.transform.position);
                bool rose = false;
                for (float end = Time.realtimeSinceStartup + 2 * BoardView.BeatSeconds; Time.realtimeSinceStartup < end;)
                {
                    lowLine = Mathf.Min(lowLine, line.color.a); highLine = Mathf.Max(highLine, line.color.a);
                    lowBand = Mathf.Min(lowBand, band.color.a); highBand = Mathf.Max(highBand, band.color.a);
                    thin = Mathf.Min(thin, line.bounds.size.y); thick = Mathf.Max(thick, line.bounds.size.y);
                    white = Mathf.Min(white, line.color.b);
                    foreach (var ember in Embers(view))
                    {
                        Assert.GreaterOrEqual(ember.bounds.center.y, top.y - .5f, at + ": embers rise from the line");
                        rose |= start.TryGetValue(ember, out var from) && ember.transform.position.y > from.y;
                    }
                    yield return null;
                }
                Assert.IsTrue(rose, at + ": the embers rise");
                if (level == 1)
                {
                    Assert.AreEqual(lowLine, highLine, 1e-4f, at + ": the line is steady");
                    Assert.AreEqual(lowBand, highBand, 1e-4f, at + ": its glow is steady");
                    Assert.AreEqual(thin, thick, 1e-3f, at + ": its thickness is steady");
                    warningWhite = white;
                }
                else
                {
                    Assert.Greater(highBand - lowBand, .3f, at + ": the glow beats");
                    Assert.Greater(highLine - lowLine, .15f, at + ": the line beats in brightness");
                    Assert.Greater(thick / thin, 1.5f, at + ": and in thickness");
                    Assert.Greater(white, warningWhite, at + ": the critical line is whiter");
                }
                Assert.AreEqual(BoardView.PressureFace, view.GuardianFace.Replace("blink", BoardView.PressureFace), at + ": the guardian is worried");
            }
            // Reduced motion: the still line, brighter when critical, no embers and no beat.
            board.SetReducedMotion(true);
            var held = new List<(float alpha, float glow, float thickness, float white)>();
            foreach (int height in new[] { 9, 10 })
            {
                view.SetBoard(Stack(height)); yield return null;
                var now = (line.color.a, band.color.a, line.bounds.size.y, line.color.b); held.Add(now);
                yield return Seconds(1.2f * BoardView.BeatSeconds);
                Assert.AreEqual(now, (line.color.a, band.color.a, line.bounds.size.y, line.color.b), "Reduced motion holds the line still at a stack " + height + " high");
                Assert.IsEmpty(Embers(view), "Reduced motion shows no embers");
            }
            Assert.Greater(held[1].alpha, held[0].alpha, "The critical line is brighter");
            Assert.Greater(held[1].glow, held[0].glow); Assert.Greater(held[1].thickness, held[0].thickness); Assert.Greater(held[1].white, held[0].white);
            view.SetBoard(original);
            Assert.AreEqual(0, view.Pressure); Assert.IsFalse(line.enabled || band.enabled);
            // Evidence on each phone.
            board.SetReducedMotion(false);
            var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
            view.gameObject.SetActive(false);
            foreach (var (phone, screen, inset, bottom) in new[] { ("compact", ZKube.Tests.Presentation.Phones.CompactScreen, ZKube.Tests.Presentation.Phones.CompactTopInsetDp, 0f),
                ("emulator", ZKube.Tests.Presentation.Phones.EmulatorScreen, ZKube.Tests.Presentation.Phones.EmulatorTopInsetDp, ZKube.Tests.Presentation.Phones.EmulatorBottomInsetDp),
                ("seeker", ZKube.Tests.Presentation.Phones.SeekerScreen, ZKube.Tests.Presentation.Phones.SeekerTopInsetDp, 0f) })
                foreach (int height in new[] { 9, 10 })
                {
                    var ui = new SkinUi(art, 1, 1);
                    var child = new GameObject("Pressure view"); child.transform.SetParent(root.transform);
                    var shown = child.AddComponent<BoardView>();
                    shown.Create(board, art, HudLayout.Build(ui, board.State, board.Session, new Rect(0, bottom, screen.width, screen.height - inset - bottom), 1, screen), ui);
                    var grid = new byte[80]; for (int row = 0; row < height; row++) for (int col = 0; col < 6; col += 2) { grid[row * 8 + col + row % 2] = 2; grid[row * 8 + col + row % 2 + 1] = 2; }
                    shown.SetBoard(grid); shown.SetPreview(board.State.HasNextRow, board.State.NextRow); shown.Summary(board.State, board.Session, true);
                    yield return null;
                    var limit = Piece(shown, "Danger line");
                    Assert.IsTrue(limit.enabled, phone);
                    Assert.AreEqual(shown.Layout.Board.yMax, limit.bounds.center.y, .5f, phone + ": the line is the top of this phone's board");
                    Assert.AreEqual(shown.Layout.Board.center.x, limit.bounds.center.x, .5f, phone);
                    // The critical step is captured at a stroke of its beat.
                    if (height == 10) while (Piece(shown, "Danger band").color.a < .95f) yield return null;
                    yield return ZKube.Tests.Presentation.Captures.Snap(screen, "pressure-" + (height == 10 ? "critical-" : "warning-") + phone);
                    UnityEngine.Object.Destroy(child); yield return null;
                }
            view.gameObject.SetActive(true);
        }

        // The danger state moves no block, at the warning or the critical step.
        [UnityTest] public IEnumerator NoBlockMovesBecauseOfTheDangerState()
        {
            yield return Load("realm-8-daily", false);
            foreach (int height in new[] { 9, 10 })
            {
                var grid = new byte[80];
                for (int row = 0; row < height; row++) for (int col = 0; col < 6; col += 2) { grid[row * 8 + col + row % 2] = 2; grid[row * 8 + col + row % 2 + 1] = 2; }
                board.View.SetBoard(grid);
                Assert.AreEqual(height == 10 ? 2 : 1, board.View.Pressure);
                var rest = Blocks().ToDictionary(pair => pair.Key, pair => (pair.Value.transform.position, pair.Value.transform.localScale, pair.Value.transform.rotation));
                Assert.Greater(rest.Count, 20);
                for (float end = Time.realtimeSinceStartup + 2 * BoardView.BeatSeconds; Time.realtimeSinceStartup < end;)
                {
                    yield return null;
                    foreach (var pair in Blocks())
                        Assert.AreEqual(rest[pair.Key], (pair.Value.transform.position, pair.Value.transform.localScale, pair.Value.transform.rotation),
                            pair.Value.name + " moved at a stack " + height + " high");
                }
            }
        }

        // The heartbeat is a double beat, the second stroke softer, quicker than a
        // resting pulse of seventy a minute and at rest between beats.
        [Test] public void TheHeartbeatIsADoubleBeatQuickerThanARestingPulse()
        {
            Assert.Less(BoardView.BeatSeconds, 60f / 70); Assert.Greater(BoardView.BeatSeconds, .5f);
            var strokes = new List<(float at, float strength)>();
            const float step = .001f;
            for (float t = step; t < BoardView.BeatSeconds - step; t += step)
            {
                float here = BoardView.Heartbeat(t);
                if (here > .3f && here >= BoardView.Heartbeat(t - step) && here > BoardView.Heartbeat(t + step)) strokes.Add((t, here));
            }
            Assert.AreEqual(2, strokes.Count, "Two strokes a beat");
            Assert.AreEqual(BoardView.FirstStroke, strokes[0].at, .002f); Assert.AreEqual(1, strokes[0].strength, .01f);
            Assert.AreEqual(BoardView.SecondStroke, strokes[1].at, .002f); Assert.AreEqual(BoardView.SecondStrength, strokes[1].strength, .01f);
            for (float t = BoardView.SecondStroke + .15f; t < BoardView.BeatSeconds - .05f; t += .01f) Assert.Less(BoardView.Heartbeat(t), .02f, "At rest between beats");
            Assert.AreEqual(BoardView.Heartbeat(.1f), BoardView.Heartbeat(.1f + 3 * BoardView.BeatSeconds), 1e-3f, "Every beat is the same");
            Assert.Greater(BoardView.StillBeat, 0); Assert.Less(BoardView.StillBeat, 1);
        }

        [UnityTest] public IEnumerator EarnedStarsPopAndTheGuardianCheersThenReturnsToItsCalmFace()
        {
            yield return Load("realm-8-campaign", false);
            var star = board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Star 0 glyph");
            var origin = star.rectTransform.anchoredPosition;
            var position = Guardian().transform.position; var scale = Guardian().transform.localScale;
            board.View.Celebrate(0, 1, 0, false);
            yield return Seconds(.1f);
            var flight = board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Star 0 flight");
            Assert.AreEqual(SkinSlots.StarSocket, star.sprite.name.Replace("(Clone)", ""), "The socket waits for the star flying from its plate");
            Assert.AreEqual(SkinSlots.StarLit, flight.sprite.name.Replace("(Clone)", ""));
            yield return Seconds(BoardView.FlightSeconds + .1f);
            Assert.IsTrue(flight == null, "The star has landed");
            Assert.AreEqual(SkinSlots.StarLit, star.sprite.name.Replace("(Clone)", ""));
            Assert.Greater(star.rectTransform.localScale.x, 1.05f, "A newly earned star ignites in its socket");
            Assert.AreEqual("celebrate", board.View.GuardianFace);
            Assert.AreEqual("boss__idle", Guardian().sprite.name.Replace("(Clone)", ""), "The body stays the idle frame");
            var face = board.View.GetComponentsInChildren<SpriteRenderer>().Single(sprite => sprite.name == SkinUi.GuardianFaceName);
            Assert.IsTrue(face.enabled); Assert.AreEqual("boss__celebrate", face.sprite.name);
            yield return Seconds(1);
            Assert.AreEqual(Vector3.one, star.rectTransform.localScale);
            Assert.AreEqual(origin, star.rectTransform.anchoredPosition);
            Assert.AreEqual("idle", board.View.GuardianFace); Assert.IsFalse(face.enabled, "The calm face is the idle frame alone");

            // A later goal's star flies from its own plate to the next empty socket.
            board.View.Celebrate(1, 5, 0, false);
            yield return Seconds(.1f);
            var second = board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Star 1 flight");
            var plate = board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Goal plate 2 face");
            Assert.Less(Vector2.Distance(second.rectTransform.position, plate.rectTransform.position), plate.rectTransform.rect.width, "It leaves the met goal's plate");
            yield return Seconds(BoardView.FlightSeconds + 1);

            board.SetReducedMotion(true);
            board.View.Celebrate(0, 2, 0, false);
            yield return Seconds(.15f);
            Assert.AreEqual(Vector3.one, board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Star 1 glyph").rectTransform.localScale);
            Assert.AreEqual(position, Guardian().transform.position, "Reduced motion changes the face, never moves the body");
            Assert.AreEqual(scale, Guardian().transform.localScale);
        }
    }
}
