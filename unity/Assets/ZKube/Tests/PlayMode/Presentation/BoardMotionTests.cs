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

        [UnityTest] public IEnumerator TheIncomingRowNeverCrossesAVisibleNextRowLabel()
        {
            yield return Load("balam-combo-2", false);
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
            yield return Load("balam-combo-2", true);
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
            yield return Load("balam-combo-2", false);
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

        // DECISIONS 2026-10-02: with two rows or fewer free the board shows its
        // pressure, as the old client did, and stops when the board recovers. The
        // threshold both ways: three free rows are calm, two and one warn, none is
        // critical, and back. The frame and the glass pulse in the warning colour
        // over the board's own frame; the guardian looks worried and calms again.
        [UnityTest] public IEnumerator PressureShowsAtTwoFreeRowsAndStopsWhenTheBoardRecovers()
        {
            Assert.AreEqual(2, BoardView.PressureRows);
            for (int free = 0; free <= 10; free++)
                Assert.AreEqual(free == 0 ? 2 : free <= 2 ? 1 : 0, BoardView.PressureLevel(free), free + " free rows");
            yield return Load("realm-8-daily", false);
            var view = board.View; var original = (byte[])board.State.Grid.Clone();
            SpriteRenderer Piece(string name) => view.GetComponentsInChildren<SpriteRenderer>(true).Single(sprite => sprite.name == name);
            // A stack of single blocks up the first column, to the given height.
            byte[] Stack(int height) { var grid = new byte[80]; for (int row = 0; row < height; row++) grid[row * 8] = 1; return grid; }
            for (int height = 0; height <= 10; height++) Assert.AreEqual(10 - height, BoardView.FreeRows(Stack(height)), "A stack " + height + " high");
            Assert.AreEqual(0, view.Pressure, "The fixture opens calm");
            foreach (var (height, level) in new[] { (7, 0), (8, 1), (9, 1), (10, 2), (9, 1), (8, 1), (7, 0), (10, 2), (3, 0) })
            {
                string at = "a stack " + height + " high";
                view.SetBoard(Stack(height)); yield return null;
                Assert.AreEqual(level, view.Pressure, at);
                Assert.AreEqual(level > 0, Piece("Pressure frame").enabled, at + ": the frame");
                Assert.AreEqual(level > 0, Piece("Pressure tint").enabled, at + ": the tint");
                if (level > 0)
                {
                    Assert.AreEqual((Vector2)view.Layout.Rim.center, (Vector2)Piece("Pressure frame").bounds.center, at + ": on the board's frame");
                    Assert.AreEqual(view.Layout.Rim.width, Piece("Pressure frame").bounds.size.x, .5f, at);
                    // It pulses: faster and stronger when critical.
                    float low = 1, high = 0;
                    for (float end = Time.realtimeSinceStartup + (level == 2 ? 1.3f : 2.1f); Time.realtimeSinceStartup < end;)
                    { float a = Piece("Pressure frame").color.a; low = Mathf.Min(low, a); high = Mathf.Max(high, a); yield return null; }
                    Assert.Greater(high - low, .3f, at + ": the frame pulses");
                    Assert.AreEqual(level == 2 ? 1 : .9f, high, .08f, at + ": its strength");
                    Assert.AreEqual(BoardView.PressureFace, board.View.GuardianFace.Replace("blink", BoardView.PressureFace), at + ": the guardian is worried");
                }
                else
                {
                    yield return Seconds(.2f);
                    Assert.AreEqual("idle", board.View.GuardianFace.Replace("blink", "idle"), at + ": the guardian is calm");
                }
            }
            // Reduced motion holds the tint.
            board.SetReducedMotion(true); view.SetBoard(Stack(9)); yield return null;
            float held = Piece("Pressure frame").color.a; yield return Seconds(.5f);
            Assert.AreEqual(held, Piece("Pressure frame").color.a, 1e-4f, "Reduced motion does not pulse");
            Assert.Greater(held, .3f);
            view.SetBoard(original); yield return null;
            Assert.AreEqual(0, view.Pressure);
            // Evidence on each phone.
            board.SetReducedMotion(false);
            var art = ZKube.Tests.Presentation.BoardTestState.Art(board);
            view.gameObject.SetActive(false);
            foreach (var (phone, screen, top, bottom) in new[] { ("compact", ZKube.Tests.Presentation.Phones.CompactScreen, ZKube.Tests.Presentation.Phones.CompactTopInsetDp, 0f),
                ("emulator", ZKube.Tests.Presentation.Phones.EmulatorScreen, ZKube.Tests.Presentation.Phones.EmulatorTopInsetDp, ZKube.Tests.Presentation.Phones.EmulatorBottomInsetDp),
                ("seeker", ZKube.Tests.Presentation.Phones.SeekerScreen, ZKube.Tests.Presentation.Phones.SeekerTopInsetDp, 0f) })
                foreach (int height in new[] { 8, 10 })
                {
                    var ui = new SkinUi(art, 1, 1);
                    var child = new GameObject("Pressure view"); child.transform.SetParent(root.transform);
                    var shown = child.AddComponent<BoardView>();
                    shown.Create(board, art, HudLayout.Build(ui, board.State, board.Session, new Rect(0, bottom, screen.width, screen.height - top - bottom), 1, screen), ui);
                    var grid = new byte[80]; for (int row = 0; row < height; row++) for (int col = 0; col < 6; col += 2) { grid[row * 8 + col + row % 2] = 2; grid[row * 8 + col + row % 2 + 1] = 2; }
                    shown.SetBoard(grid); shown.SetPreview(board.State.HasNextRow, board.State.NextRow); shown.Summary(board.State, board.Session, true);
                    yield return null;
                    var frame = shown.GetComponentsInChildren<SpriteRenderer>().Single(sprite => sprite.name == "Pressure frame");
                    Assert.IsTrue(frame.enabled, phone); Assert.AreEqual(shown.Layout.Rim.width, frame.bounds.size.x, .5f, phone + ": the pulse is the board's frame");
                    // Captured at the pulse's peak.
                    while (frame.color.a < (height == 10 ? .95f : .85f)) yield return null;
                    yield return ZKube.Tests.Presentation.Captures.Snap(screen, "pressure-" + (height == 10 ? "critical-" : "warning-") + phone);
                    UnityEngine.Object.Destroy(child); yield return null;
                }
            view.gameObject.SetActive(true);
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
