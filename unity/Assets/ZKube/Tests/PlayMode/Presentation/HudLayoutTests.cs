using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class HudLayoutTests
    {
        private GameObject root;
        private BoardController board;
        private BoardHarness evidence;
        private int previousTextSize;
        [UnitySetUp] public IEnumerator SetUp()
        {
            previousTextSize = PlayerPrefs.GetInt("zkube.text.larger", 0);
            PlayerPrefs.SetInt("zkube.text.larger", 0);
            root = new GameObject("Typography test board"); board = root.AddComponent<BoardController>();
            evidence = root.AddComponent<BoardHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-8-daily");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board) && !board.Busy);
            board.SetMuted(true); board.SetReducedMotion(true);
        }
        [UnityTearDown] public IEnumerator TearDown()
        {
            UnityEngine.Object.Destroy(root); yield return null;
            PlayerPrefs.SetInt("zkube.text.larger", previousTextSize);
        }
        private IEnumerator Wait(Func<bool> condition)
        {
            float deadline = Time.realtimeSinceStartup + 20;
            while (!condition())
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for native board readiness: " + "Board is still busy or loading");
                yield return null;
            }
        }
        private TMP_Text Label(string name) => board.View.GetComponentsInChildren<TMP_Text>().Single(t => t.name == name);
        private BoardArt Art() => (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
        private static string SpriteName(Image image) => image.sprite.name.Replace("(Clone)", "");
        private void AssertStars(BoardView view)
        {
            var plates = view.GetComponentsInChildren<Button>().Where(b => b.name.StartsWith("Goal plate ", StringComparison.Ordinal)).ToArray();
            Assert.AreEqual(3, plates.Length, "Each star's goal has its plate");
            for (int i = 0; i < 3; i++)
            {
                var glyph = view.GetComponentsInChildren<Image>().Single(image => image.name == "Star " + i + " glyph");
                bool earned = (board.State.LatchedStarSources & (1 << i)) != 0;
                Assert.AreEqual(earned ? SkinSlots.StarLit : SkinSlots.StarSocket, SpriteName(glyph));
            }
        }
        // Each glyph's ink from its metrics, without the quad's sampling padding.
        private static System.Collections.Generic.IEnumerable<Rect> Glyphs(TMP_Text text)
        {
            var info = text.textInfo;
            for (int i = 0; i < info.characterCount; i++)
            {
                var c = info.characterInfo[i];
                if (!c.isVisible) continue;
                var metrics = c.textElement.glyph.metrics; float scale = c.scale;
                float left = c.origin + metrics.horizontalBearingX * scale, top = c.baseLine + metrics.horizontalBearingY * scale;
                var low = text.transform.TransformPoint(new Vector3(left, top - metrics.height * scale));
                var high = text.transform.TransformPoint(new Vector3(left + metrics.width * scale, top));
                yield return Rect.MinMaxRect(low.x, low.y, high.x, high.y);
            }
        }
        private static Rect Ink(TMP_Text text)
        {
            var glyphs = Glyphs(text).ToArray();
            return Rect.MinMaxRect(glyphs.Min(g => g.xMin), glyphs.Min(g => g.yMin), glyphs.Max(g => g.xMax), glyphs.Max(g => g.yMax));
        }
        private void Fits(TMP_Text text)
        {
            text.ForceMeshUpdate();
            Assert.IsFalse(text.enableAutoSizing, text.name + " must retain the requested size");
            Assert.IsFalse(text.isTextTruncated, text.name + " must not hide text with ellipsis");
            Assert.LessOrEqual(text.GetPreferredValues(text.text, text.rectTransform.rect.width, float.PositiveInfinity).y,
                text.rectTransform.rect.height + .5f, text.name + " must have enough height at its real width");
        }

        // Every piece of the header and the thumb row, in screen pixels.
        private static Rect[] Header(HudLayout plan) =>
            new[] { plan.Crown, plan.Moves }.Concat(plan.Plates).Concat(plan.Medal.width > 0 ? new[] { plan.Medal } : new Rect[0]).ToArray();
        private static void Apart(Rect[] pieces, string what)
        {
            for (int a = 0; a < pieces.Length; a++) for (int b = a + 1; b < pieces.Length; b++)
                Assert.IsFalse(pieces[a].Overlaps(pieces[b]), what + ": pieces " + a + " " + pieces[a] + " and " + b + " " + pieces[b] + " overlap");
        }
        private static bool Inside(Rect outer, Rect inner, float slack = .5f) =>
            inner.xMin >= outer.xMin - slack && inner.xMax <= outer.xMax + slack && inner.yMin >= outer.yMin - slack && inner.yMax <= outer.yMax + slack;
        // The Seeker and the smallest mainstream phone, each in its measured safe area.
        private static (string name, Rect screen, Rect safe, float density)[] Screens(float density = 1)
        {
            var seeker = ZKube.Tests.Presentation.Phones.SeekerScreen; var compact = ZKube.Tests.Presentation.Phones.CompactScreen;
            Rect Scaled(Rect r) => new Rect(r.x * density, r.y * density, r.width * density, r.height * density);
            Rect Safe(Rect r, float inset) => new Rect(r.x, r.y, r.width, r.height - inset * density);
            return new[] {
                ("Seeker", Scaled(seeker), Safe(Scaled(seeker), ZKube.Tests.Presentation.Phones.SeekerTopInsetDp), density),
                ("360 x 640", Scaled(compact), Safe(Scaled(compact), ZKube.Tests.Presentation.Phones.CompactTopInsetDp), density) };
        }
        [UnityTest] public IEnumerator EveryCatalogGoalFitsTheCampaignHudOnTheSeekerAndA360x640Phone()
        {
            evidence.Load("realm-8-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var art = Art(); var rules = board.Session.Rules;
            var captions = PageCatalog.Load().constraintCaptions.Where(goal => goal.kind != 0).ToArray();
            var saved = (rules.PrimaryKind, rules.PrimaryValue, rules.PrimaryCount, rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount);
            board.View.gameObject.SetActive(false);
            try
            {
                foreach (var (name, screen, safe, density) in Screens())
                    foreach (float scale in new[] { 1f, 1.3f })
                        for (int i = 0; i < captions.Length; i += 2)
                        {
                            var first = captions[i]; var second = captions[Math.Min(i + 1, captions.Length - 1)];
                            rules.PrimaryKind = first.kind; rules.PrimaryValue = first.value; rules.PrimaryCount = first.count;
                            rules.SecondaryKind = second.kind; rules.SecondaryValue = second.value; rules.SecondaryCount = second.count;
                            var host = new GameObject("Goal view"); host.transform.SetParent(root.transform);
                            try
                            {
                                var ui = new SkinUi(art, density, scale);
                                var plan = HudLayout.Build(ui, board.State, board.Session, safe, density, screen);
                                var view = host.AddComponent<BoardView>(); view.Create(board, art, plan, ui);
                                view.Summary(board.State, board.Session, true);
                                Canvas.ForceUpdateCanvases();
                                var layout = plan.Layout; float d = layout.Density;
                                string at = $"{name} at {scale}, goals {first.kind}/{first.value} and {second.kind}/{second.value}: cell {layout.Cell / d} dp";
                                Assert.GreaterOrEqual(layout.Cell / d, name == "Seeker" ? scale == 1 ? 46 : 44 : scale == 1 ? HudLayout.MinCompactCellDp : 30, at + " keeps a playable board");
                                // The header sits in the safe area over the frame, its pieces apart.
                                Apart(Header(plan), at);
                                foreach (var piece in Header(plan))
                                {
                                    Assert.IsTrue(Inside(safe, piece), at + " keeps " + piece + " inside the safe area " + safe);
                                    Assert.GreaterOrEqual(piece.yMin, layout.Rim.yMax - .5f, at + " keeps " + piece + " above the frame");
                                }
                                foreach (var socket in plan.Sockets) Assert.IsTrue(Inside(plan.Crown, socket), at + " keeps its sockets on the pill");
                                // Each plate holds its pictogram, chip and counter.
                                for (int plate = 0; plate < 3; plate++)
                                    foreach (var image in view.GetComponentsInChildren<Image>().Where(image => image.name.StartsWith("Goal plate " + plate + " ", StringComparison.Ordinal)))
                                        Assert.IsTrue(Inside(plan.Plates[plate], WorldRect(image.rectTransform)), at + " keeps " + image.name + " on its plate");
                                foreach (var label in view.GetComponentsInChildren<TMP_Text>().Where(t => t.name == "Score" || t.name == "Theme" || t.name == "Secondary" ||
                                    t.name == "Moves remaining" || t.name == "Earn caption" || t.name.EndsWith(" chip label", StringComparison.Ordinal)))
                                {
                                    Fits(label);
                                    label.ForceMeshUpdate();
                                    var ink = Ink(label); var owner = label.name == "Moves remaining" ? plan.Moves : label.name.StartsWith("Earn ", StringComparison.Ordinal) ? layout.EarnPanel
                                        : plan.Plates[label.name == "Score" || label.name.StartsWith("Goal plate 0", StringComparison.Ordinal) ? 0 : label.name == "Theme" || label.name.StartsWith("Goal plate 1", StringComparison.Ordinal) ? 1 : 2];
                                    Assert.IsTrue(Inside(owner, ink, 1), at + " keeps " + label.name + " '" + label.text + "' " + ink + " inside " + owner);
                                }
                                // The thumb row: apart, under the tray, inside the safe area, 48 dp to touch.
                                var row = new[] { layout.PauseButton, layout.EarnPanel, layout.GuardianButton, layout.RerollButton };
                                Apart(row, at + " thumb row");
                                foreach (var piece in row)
                                {
                                    Assert.IsTrue(Inside(safe, piece), at + " keeps " + piece + " inside the safe area");
                                    Assert.LessOrEqual(piece.yMax, layout.Tray.yMin, at + " keeps " + piece + " under the tray");
                                }
                                foreach (var touch in new[] { layout.PauseButton, layout.GuardianButton, layout.RerollButton })
                                    Assert.GreaterOrEqual(touch.width / d, 48 - .01f, at + " keeps 48 dp touch targets");
                                Assert.IsTrue(plan.NextLabel.yMax <= layout.Rim.yMin + .5f && plan.NextLabel.yMin >= layout.Tray.yMax - .5f, at + " keeps NEXT ROW between the frame and the tray");
                            }
                            finally { UnityEngine.Object.Destroy(host); }
                            yield return null;
                        }
            }
            finally
            {
                (rules.PrimaryKind, rules.PrimaryValue, rules.PrimaryCount, rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount) = saved;
                board.View.gameObject.SetActive(true);
            }
        }
        [UnityTest] public IEnumerator AtA360x640PhoneTheBoardKeeps34DpCellsInEveryRealm()
        {
            // The board has priority: the header gives way until the cells reach 34 dp.
            var (_, screen, safe, density) = Screens()[1];
            foreach (string fixture in Enumerable.Range(1, 10).Select(realm => "realm-" + realm + "-campaign").Concat(new[] { "realm-1-daily", "realm-8-daily" }))
            {
                evidence.Load(fixture); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                var plan = HudLayout.Build(new SkinUi(Art(), density, 1), board.State, board.Session, safe, density, screen);
                var layout = plan.Layout;
                Assert.IsTrue(layout.Compact);
                Assert.GreaterOrEqual(layout.Cell / density, HudLayout.MinCompactCellDp, fixture + " keeps playable cells");
                Assert.GreaterOrEqual(plan.Guardian.width / density, 72, fixture + " keeps its guardian");
                Apart(Header(plan), fixture);
                foreach (var piece in Header(plan))
                {
                    Assert.IsTrue(Inside(safe, piece), fixture + " keeps " + piece + " in the safe area");
                    Assert.GreaterOrEqual(piece.yMin, layout.Rim.yMax - .5f, fixture + " keeps " + piece + " above the frame");
                }
                Assert.IsTrue(layout.PauseButton.yMin >= safe.yMin && layout.GuardianButton.yMin >= safe.yMin, fixture + " keeps its thumb row on screen");
            }
        }
        [UnityTest] public IEnumerator TheCampaignHudHasItsWireframeGeometry()
        {
            // ux/src/index.src.html section 1, drawn at 400 x 890 dp and 3 px/dp.
            evidence.Load("realm-1-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var plan = HudLayout.Build(new SkinUi(Art(), 3, 1), board.State, board.Session, new Rect(0, 0, 1200, 2670), 3);
            Rect Dp(Rect r) => new Rect(r.x / 3, (2670 - r.yMax) / 3, r.width / 3, r.height / 3);
            void Near(Rect expected, Rect actual, string what)
            {
                var dp = Dp(actual);
                Assert.AreEqual(expected.x, dp.x, .6f, what + " x " + dp); Assert.AreEqual(expected.y, dp.y, .6f, what + " y " + dp);
                Assert.AreEqual(expected.width, dp.width, .6f, what + " width " + dp); Assert.AreEqual(expected.height, dp.height, .6f, what + " height " + dp);
            }
            Assert.AreEqual(222, Dp(plan.Layout.Rim).y, .6f, "The frame's top");
            for (int i = 0; i < 3; i++) Near(new Rect(288, 72 + 52 * i, 104, 46), plan.Plates[i], "plate " + i);
            Near(new Rect(8, 92, 104, 112), plan.Moves, "moves tablet");
            Near(new Rect(16, 30, 46, 46), plan.Medal, "level medal");
            // 44 dp sockets 12.32 dp apart, the side ones 6.16 dp lower.
            Near(new Rect(121.68f, 34.16f, 44, 44), plan.Sockets[0], "first socket");
            Near(new Rect(178, 28, 44, 44), plan.Sockets[1], "middle socket");
            Near(new Rect(234.32f, 34.16f, 44, 44), plan.Sockets[2], "last socket");
            Assert.AreEqual(186, Dp(plan.Guardian).width, .6f, "The guardian is drawn 186 dp");
            Assert.AreEqual(plan.Layout.Rim.center.x, plan.Guardian.center.x, .5f, "The guardian is centred on the frame");
            // The thumb row: 14 dp under the tray, pause, the Earn panel and the two tablets.
            float rowTop = Dp(plan.Layout.Tray).yMax + 14;
            Near(new Rect(10, rowTop + 3, 44, 44), plan.Layout.PauseFace, "pause");
            Assert.AreEqual(rowTop, Dp(plan.Layout.EarnPanel).y, .6f, "The Earn panel starts the row");
            Assert.AreEqual(170, Dp(plan.Layout.EarnPanel).width, .6f);
            Assert.AreEqual(60, Dp(plan.Layout.GuardianButton).width, .6f); Assert.AreEqual(rowTop - 5, Dp(plan.Layout.GuardianButton).y, .6f);
            Assert.AreEqual(72, Dp(plan.Layout.RerollButton).x - Dp(plan.Layout.GuardianButton).x, .6f, "The tablets are 72 dp apart");
        }
        [UnityTest] public IEnumerator NothingEntersTheTopInset()
        {
            evidence.Load("realm-1-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var screen = new Rect(0, 0, 1200, 2670);
            float Dp(float y) => (2670 - y) / 3;
            foreach (float inset in new[] { 0f, 20f, 47f, 70f })
            {
                var safe = new Rect(0, 0, 1200, 2670 - 3 * inset);
                var plan = HudLayout.Build(new SkinUi(Art(), 3, 1), board.State, board.Session, safe, 3, screen);
                foreach (var piece in Header(plan).Concat(plan.Sockets))
                    Assert.GreaterOrEqual(Dp(piece.yMax), inset, "A " + inset + " dp inset leaves " + piece + " clear");
                // The drawing moves down only as far as the inset needs.
                Assert.AreEqual(Mathf.Max(222, inset + 2 + 222 - (28 - 4.4f)), Dp(plan.Layout.Rim.yMax), .6f, "The frame at a " + inset + " dp inset");
            }
        }
        [UnityTest] public IEnumerator APlateOpensItsCaptionAndProgressAndTheNextTouchClosesIt()
        {
            evidence.Load("realm-1-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var rules = board.Session.Rules; var view = board.View;
            evidence.Click("Goal plate 2"); yield return null;
            Assert.IsTrue(view.BubbleOpen);
            Assert.AreEqual(BoardView.ObjectiveName(rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount), Label("Bubble caption").text);
            Assert.AreEqual("0 / " + Math.Max((byte)1, rules.SecondaryCount), Label("Bubble progress").text);
            Fits(Label("Bubble caption")); Fits(Label("Bubble progress"));
            var bubble = WorldRect(view.GetComponentsInChildren<Image>().Single(image => image.name == "Bubble").rectTransform);
            var plate = board.View.GetComponentsInChildren<Button>().Single(b => b.name == "Goal plate 2");
            Assert.LessOrEqual(bubble.xMax, WorldRect(plate.GetComponent<RectTransform>()).xMin, "The bubble opens beside its plate");
            Assert.IsTrue(Inside(view.Layout.Frame, bubble), "The bubble stays on screen");
            // The next touch anywhere closes it, and does not reach the board.
            uint actions = board.State.ActionCounter;
            evidence.Tap(view.Layout.Board.center);
            Assert.IsFalse(view.BubbleOpen);
            Assert.AreEqual(actions, board.State.ActionCounter);
            // A long press opens it too; letting go leaves it open.
            var e = new UnityEngine.EventSystems.PointerEventData(UnityEngine.EventSystems.EventSystem.current);
            UnityEngine.EventSystems.ExecuteEvents.Execute(plate.gameObject, e, UnityEngine.EventSystems.ExecuteEvents.pointerDownHandler);
            yield return new WaitForSecondsRealtime(LongPress.HoldSeconds + .1f);
            Assert.IsTrue(view.BubbleOpen, "A long press opens the bubble"); yield return null;
            Assert.AreEqual(BoardView.ObjectiveName(rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount), Label("Bubble caption").text);
            UnityEngine.EventSystems.ExecuteEvents.Execute(plate.gameObject, e, UnityEngine.EventSystems.ExecuteEvents.pointerUpHandler);
            Assert.IsTrue(view.BubbleOpen);
            evidence.Tap(view.Layout.Board.center);
            Assert.IsFalse(view.BubbleOpen);
            // The score plate names the score and its target.
            evidence.Click("Goal plate 0"); yield return null;
            Assert.AreEqual("Score", Label("Bubble caption").text);
            Assert.AreEqual(Math.Min(board.State.Score, rules.PointsRequired) + " / " + rules.PointsRequired, Label("Bubble progress").text);
            view.CloseBubble();
        }
        [UnityTest] public IEnumerator TheMovesTabletWarmsAtFiveAndTurnsEmberAtThreeAndUnearnedSocketsBreathe()
        {
            evidence.Load("realm-1-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.SetReducedMotion(false);
            var view = board.View; var art = Art();
            var tablet = view.GetComponentsInChildren<Image>().Single(image => image.name == "Moves tablet");
            var glow = view.GetComponentsInChildren<Image>().Single(image => image.name == "Moves glow");
            var state = board.State; ushort max = board.Session.Rules.MaxMoves, played = state.Moves;
            try
            {
                foreach (var (left, slot, token) in new[] { (6, SkinSlots.MovesCalm, SkinTokens.Score), (5, SkinSlots.MovesWarm, SkinTokens.Accent),
                    (4, SkinSlots.MovesWarm, SkinTokens.Accent), (3, SkinSlots.MovesEmber, SkinTokens.Negative), (1, SkinSlots.MovesEmber, SkinTokens.Negative) })
                {
                    state.Moves = (ushort)(max - left); view.Summary(state, board.Session, true);
                    Assert.AreEqual(slot, SpriteName(tablet), left + " moves left");
                    Assert.AreEqual(art.Token(token), Label("Moves remaining").color, left + " moves left");
                    Assert.AreEqual(slot != SkinSlots.MovesCalm, glow.enabled);
                    // Unearned sockets breathe only in the last three moves.
                    float lowest = 1;
                    for (float t = 0; t < 1.3f; t += Time.unscaledDeltaTime) { lowest = Mathf.Min(lowest, Stars(view).Min(star => star.color.a)); yield return null; }
                    if (left <= 3) Assert.Less(lowest, .7f, left + " moves left: unearned sockets breathe");
                    else Assert.AreEqual(1, lowest, .001f, left + " moves left: the sockets hold still");
                }
                board.SetReducedMotion(true); yield return null; yield return null;
                Assert.IsTrue(Stars(view).All(star => Mathf.Approximately(star.color.a, 1)), "Reduced motion holds the sockets still");
            }
            finally { state.Moves = played; view.Summary(state, board.Session, true); board.SetReducedMotion(true); }
        }
        private static Image[] Stars(BoardView view) => view.GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" glyph", StringComparison.Ordinal) && image.name.StartsWith("Star ", StringComparison.Ordinal)).ToArray();
        [UnityTest] public IEnumerator EachGoalPlateShowsItsPictogramChipAndCounter()
        {
            evidence.Load("realm-1-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var rules = board.Session.Rules; var catalog = PageCatalog.Load();
            Image Named(string name) => board.View.GetComponentsInChildren<Image>(true).Single(image => image.name == name);
            Assert.AreEqual(SkinSlots.GoalScore, SpriteName(Named("Goal plate 0 pictogram")));
            var primary = catalog.Goal(rules.PrimaryKind, rules.PrimaryValue, rules.PrimaryCount);
            var secondary = catalog.Goal(rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount);
            Assert.AreEqual(primary.Pictogram(rules.BonusType), SpriteName(Named("Goal plate 1 pictogram")));
            Assert.AreEqual(secondary.Pictogram(rules.BonusType), SpriteName(Named("Goal plate 2 pictogram")));
            Assert.AreEqual(secondary.chip, Label("Goal plate 2 chip label").text);
            Assert.AreEqual(Math.Min(board.State.Score, rules.PointsRequired) + "/" + rules.PointsRequired, StripTags(Label("Score").text));
            Assert.AreEqual(board.State.PrimaryProgress + "/" + rules.PrimaryCount, StripTags(Label("Theme").text));
            Assert.AreEqual("ring", secondary.counter);
            Assert.IsTrue(Named("Secondary ring").enabled); Assert.IsFalse(Named("Secondary tick").enabled);
            Assert.AreEqual(board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Earn trigger").sprite.name.Replace("(Clone)", ""),
                PageCatalog.Load().guardianRules.Single(rule => rule.bonus == rules.BonusType && rule.trigger == rules.Trigger && rule.threshold == rules.TriggerThreshold).pictogram);
            Fits(Label("Earn caption"));
        }
        [UnityTest] public IEnumerator AMetGoalReadsItsTargetWithItsTickAndAnOpenOneNeverTicks()
        {
            evidence.Load("realm-1-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var rules = board.Session.Rules; var state = board.State; var view = board.View;
            Image Named(string name) => view.GetComponentsInChildren<Image>(true).Single(image => image.name == name);
            var saved = (state.LatchedStarSources, state.PrimaryProgress, state.Score);
            try
            {
                // Every mix of met and open goals, with counts below their targets.
                for (byte latched = 0; latched < 8; latched++)
                {
                    state.LatchedStarSources = latched; state.PrimaryProgress = 0; state.Score = 0;
                    view.Summary(state, board.Session, true);
                    bool primary = (latched & 2) != 0, secondary = (latched & 4) != 0;
                    Assert.AreEqual(Named("Theme tick").enabled, primary, "The lines plate ticks only when met");
                    Assert.AreEqual(primary ? rules.PrimaryCount + "/" + rules.PrimaryCount : "0/" + rules.PrimaryCount, StripTags(Label("Theme").text),
                        latched + ": a ticked plate reads its target");
                    Assert.AreEqual(Named("Secondary tick").enabled, secondary);
                    Assert.AreEqual(!secondary, Named("Secondary ring").enabled);
                }
                // The score plate ticks when its count reaches the target.
                state.LatchedStarSources = 1; state.Score = rules.PointsRequired + 5;
                view.Summary(state, board.Session, true);
                Assert.IsTrue(Named("Score tick").enabled);
                Assert.AreEqual(rules.PointsRequired + "/" + rules.PointsRequired, StripTags(Label("Score").text));
            }
            finally { (state.LatchedStarSources, state.PrimaryProgress, state.Score) = saved; view.Summary(state, board.Session, true); }
            yield return null;
        }
        [UnityTest] public IEnumerator HudNumeralsAreLilitaOneAndCaptionsNunito()
        {
            foreach (string fixture in new[] { "realm-1-campaign", "realm-8-daily" })
            {
                evidence.Load(fixture); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                var display = SkinUi.FontName(SkinUi.Type.Display);
                Assert.AreEqual("LilitaOne-Regular", display);
                var labels = board.View.GetComponentsInChildren<TMP_Text>();
                foreach (var label in labels.Where(t => t.name == "Moves remaining" || t.name == "Score" || t.name == "Theme" || t.name == "Pressure" ||
                    t.name.EndsWith(" chip label", StringComparison.Ordinal)))
                    Assert.AreEqual(display, label.font.name, label.name + " is a display numeral");
                if (!board.Session.Daily) Assert.IsTrue(labels.Any(t => t.name.EndsWith(" chip label", StringComparison.Ordinal)), fixture + " draws a chip");
                Assert.AreEqual(SkinUi.FontName(SkinUi.Type.Caption), Label("Earn caption").font.name);
                Assert.AreEqual(SkinUi.FontName(SkinUi.Type.Label), Label("Next row label").font.name);
            }
        }
        // A Daily bound with the player's best and its close, as both products bind it.
        private IEnumerator BindDaily(string fixture, ulong best, long closesAt, long now)
        {
            evidence.Load(fixture); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var session = board.Session;
            board.Bind(new BoardSession(session.Accepted, session.Rules, session.Actions, "", session.RealmId,
                new DailyContext { Best = best, ClosesAt = closesAt, Now = () => now }));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
        }
        [UnityTest] public IEnumerator TheDailyHudShowsItsScoreBestMultiplierObjectiveAndTimeLeftWithoutStars()
        {
            yield return BindDaily("realm-8-daily", 1240, 100000 + 7 * 3600 + 42 * 60 + 30, 100000);
            var view = board.View; var state = board.State; var rules = board.Session.Rules;
            Image Named(string name) => view.GetComponentsInChildren<Image>(true).Single(image => image.name == name);
            Assert.IsFalse(view.GetComponentsInChildren<Image>().Any(image => image.name.StartsWith("Star ", StringComparison.Ordinal)), "The Daily has no stars");
            Assert.IsFalse(view.GetComponentsInChildren<Image>().Any(image => image.name == "Level medal"));
            Assert.AreEqual(state.DailyScore.ToString("N0", System.Globalization.CultureInfo.InvariantCulture), Label("Score").text);
            Assert.AreEqual("1,240", Label("Best").text, "The badge holds the best so far");
            Assert.AreEqual(HudLayout.PressureValue(state), Label("Pressure").text);
            Assert.AreEqual(HudLayout.PressureProgress(state), Named("Pressure fill").fillAmount, 1e-4f);
            Assert.AreEqual("7:42", Label("Time left").text);
            Assert.AreEqual(SkinSlots.IconClock, SpriteName(Named("Time icon")));
            if (rules.ObjectiveKind != 0)
            {
                var goal = PageCatalog.Load().Goal(rules.ObjectiveKind, rules.ObjectiveValue);
                Assert.AreEqual(goal.Pictogram(rules.BonusType), SpriteName(Named("Goal plate 1 pictogram")));
                Assert.AreEqual(state.ObjectiveTotal.ToString(), Label("Theme").text);
            }
            foreach (string name in new[] { "Score", "Best", "Pressure", "Time left", "Moves remaining" }) Fits(Label(name));
            // A run past the best lights its crown and carries the badge.
            var plan = HudLayout.Build(new SkinUi(Art(), 1, 1), state, board.Session, view.Layout.Frame, 1);
            Assert.IsTrue(Inside(plan.Crown, new Rect(plan.Best.x, plan.Crown.y, plan.Best.width, 1)), "The badge sits over the score plate");
            ulong saved = state.DailyScore;
            try
            {
                state.DailyScore = 2000; view.Summary(state, board.Session, true);
                Assert.AreEqual("2,000", Label("Best").text);
                Assert.AreEqual(1, Named("Best crown").color.a, 1e-4f, "A new best lights the crown");
            }
            finally { state.DailyScore = (uint)saved; view.Summary(state, board.Session, true); }
            Assert.Less(Named("Best crown").color.a, 1, "An unbeaten best keeps its crown dim");
        }
        [UnityTest] public IEnumerator TheDailyHudFitsTheSeekerAndA360x640PhoneAtBothTextSizes()
        {
            yield return BindDaily("realm-8-daily", 88888, 1000 + 23 * 3600, 1000);
            var art = Art();
            board.View.gameObject.SetActive(false);
            try
            {
                foreach (var (name, screen, safe, density) in Screens())
                    foreach (float scale in new[] { 1f, 1.3f })
                    {
                        var host = new GameObject("Daily view"); host.transform.SetParent(root.transform);
                        try
                        {
                            var ui = new SkinUi(art, density, scale);
                            var plan = HudLayout.Build(ui, board.State, board.Session, safe, density, screen);
                            var view = host.AddComponent<BoardView>(); view.Create(board, art, plan, ui);
                            view.Summary(board.State, board.Session, true);
                            Canvas.ForceUpdateCanvases();
                            var layout = plan.Layout; string at = name + " at " + scale;
                            Assert.GreaterOrEqual(layout.Cell / density, name == "Seeker" ? 44 : scale == 1 ? HudLayout.MinCompactCellDp : 30, at + " keeps a playable board");
                            Apart(new[] { plan.Crown, plan.Moves, plan.Plates[0], plan.Plates[1], plan.Plates[2] }, at);
                            foreach (var piece in new[] { plan.Crown, plan.Best, plan.Moves }.Concat(plan.Plates))
                            {
                                Assert.IsTrue(Inside(safe, piece), at + " keeps " + piece + " inside the safe area");
                                Assert.GreaterOrEqual(piece.yMin, layout.Rim.yMax - .5f, at + " keeps " + piece + " above the frame");
                            }
                            foreach (var label in view.GetComponentsInChildren<TMP_Text>().Where(t => new[] { "Score", "Best", "Pressure", "Theme", "Time left", "Moves remaining" }.Contains(t.name)))
                            {
                                Fits(label); label.ForceMeshUpdate();
                                var owner = label.name == "Score" ? plan.Crown : label.name == "Best" ? plan.Best : label.name == "Moves remaining" ? plan.Moves
                                    : label.name == "Pressure" ? plan.Plates[0] : label.name == "Theme" ? plan.Plates[1] : plan.Plates[board.Session.Rules.ObjectiveKind != 0 ? 2 : 1];
                                Assert.IsTrue(Inside(owner, Ink(label), 1), at + " keeps " + label.name + " '" + label.text + "' inside " + owner);
                            }
                        }
                        finally { UnityEngine.Object.Destroy(host); }
                        yield return null;
                    }
            }
            finally { board.View.gameObject.SetActive(true); }
        }
        private static string StripTags(string text) => System.Text.RegularExpressions.Regex.Replace(text, "<[^>]+>", "");
        [UnityTest] public IEnumerator NativePartialLatchRendersAllThreeClearSocketsInNarrowGeometry()
        {
            evidence.Load("shape-latch"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            yield return evidence.PlayNextInput(); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.Greater(board.State.LatchedStarSources, 0);
            Assert.Less(board.State.LatchedStarSources, 7, "This fixture must contain earned and unearned native sockets");
            var art = Art();
            board.View.gameObject.SetActive(false);
            try
            {
                foreach (float scale in new[] { 1f, 1.3f })
                {
                    // Render the real view at a 360x640 layout inside the test GameView.
                    var narrow = new GameObject("Narrow native latch view"); narrow.transform.SetParent(root.transform);
                    try
                    {
                        var ui = new SkinUi(art, 1, scale);
                        var plan = HudLayout.Build(ui, board.State, board.Session, new Rect(0, 0, 360, 640), 1);
                        var view = narrow.AddComponent<BoardView>(); view.Create(board, art, plan, ui);
                        view.Summary(board.State, board.Session, true);
                        Canvas.ForceUpdateCanvases(); yield return null;
                        var guardian = view.GetComponentsInChildren<SpriteRenderer>().Single(i => i.name == "Calm realm guardian");
                        AssertLeansOnTheRim(view, guardian);
                        AssertStars(view);
                    }
                    finally { UnityEngine.Object.Destroy(narrow); }
                    yield return null;
                }
            }
            finally { board.View.gameObject.SetActive(true); }
        }
        [UnityTest] public IEnumerator RebindingDailyToCampaignReplacesGeometryBeforeDisplayingNativeStars()
        {
            foreach (float scale in new[] { 1f, 1.3f })
            {
                board.SetTextScale(scale);
                evidence.Load("realm-8-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                var daily = board.View;
                evidence.Load("shape-latch"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                Assert.AreNotSame(daily, board.View, "A newly bound run must rebuild its measured layout");
                yield return evidence.PlayNextInput(); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                Assert.Greater(board.State.LatchedStarSources, 0);
                var guardian = board.View.GetComponentsInChildren<SpriteRenderer>().Single(i => i.name == "Calm realm guardian");
                AssertLeansOnTheRim(board.View, guardian);
                AssertStars(board.View);
                var campaign = board.View;
                evidence.Load("realm-8-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                Assert.AreNotSame(campaign, board.View);
                Assert.IsFalse(board.View.GetComponentsInChildren<Image>().Any(image => image.name.StartsWith("Star ", StringComparison.Ordinal)),
                    "Daily must hide the Campaign's star crown after rebinding");
            }
        }
        // The guardian's rail line, from its catalog contact, sits 1 dp below the rim's top.
        private static void AssertLeansOnTheRim(BoardView view, SpriteRenderer guardian)
        {
            var bounds = guardian.bounds; var rim = view.Layout.Rim;
            float rail = bounds.max.y - ZKube.Tests.Presentation.BoardTestState.Art(view).GuardianRailY * bounds.size.y;
            Assert.AreEqual(rim.yMax - view.Layout.Density, rail, .5f, "The guardian leans on the frame's top rim");
            Assert.AreEqual(rim.center.x, bounds.center.x, .5f, "The guardian is centred on the board");
        }
        private static Rect WorldRect(RectTransform transform)
        {
            var corners = new Vector3[4]; transform.GetWorldCorners(corners);
            return Rect.MinMaxRect(corners[0].x, corners[0].y, corners[2].x, corners[2].y);
        }
        [UnityTest] public IEnumerator NativeDailyBoundariesRemainExactAndLargerTextDoesNotShrinkBackDown()
        {
            evidence.Load("display-boundary-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var token = board.Session.Accepted;
            float standardSize = Label("Score").fontSize;
            board.SetTextScale(1.3f); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.AreSame(token, board.Session.Accepted, "Text size must not alter native acceptance");
            Assert.AreEqual(standardSize * 1.3f, Label("Score").fontSize, .01f);
            Assert.AreEqual(board.State.DailyScore.ToString("N0", System.Globalization.CultureInfo.InvariantCulture), Label("Score").text);
            Assert.AreEqual(board.State.ObjectiveTotal.ToString(), Label("Theme").text);
            foreach (string name in new[] { "Score", "Theme", "Earn caption", "Moves remaining" }) Fits(Label(name));
            Assert.Greater(board.View.Layout.Cell, 0);
            var layout = board.View.Layout;
            Assert.GreaterOrEqual(layout.GuardianButton.width / layout.Density, 48);
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton)); Assert.IsFalse(layout.RerollButton.Overlaps(layout.PauseButton));
            Assert.GreaterOrEqual(layout.Board.yMin, layout.Frame.yMin + layout.Footer);
            Assert.LessOrEqual(layout.Board.yMax, layout.Frame.yMax - layout.Header);
        }
        [UnityTest] public IEnumerator PressureUsesThePlayersWordsNotInternalNames()
        {
            evidence.Load("realm-8-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.AreEqual("×" + (Protocol.PressureMultiplierPercent(board.State.CurrentTier) / 100f).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture),
                Label("Pressure").text);
            Assert.AreEqual("×1", HudLayout.PressureValue(new RunSummary { CurrentTier = 0 }));
            Assert.AreEqual("×2.5", HudLayout.PressureValue(new RunSummary { CurrentTier = 3 }));
        }
        [UnityTest] public IEnumerator PublishedCampaignLongConstraintFitsItsDetailDialogAtLargerText()
        {
            evidence.Load("display-long-campaign-constraint"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.SetTextScale(1.3f); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            evidence.Click("Goal plate 2"); yield return null;
            StringAssert.Contains("moves in a row", Label("Bubble caption").text.ToLowerInvariant());
            Fits(Label("Bubble caption")); Fits(Label("Bubble progress"));
            Assert.IsTrue(Inside(board.View.Layout.Frame, WorldRect(board.View.GetComponentsInChildren<Image>().Single(image => image.name == "Bubble").rectTransform)));
            evidence.Tap(board.View.Layout.Board.center); Assert.IsFalse(board.View.BubbleOpen);
            evidence.Click("Pause"); yield return null;
            Fits(Label("Dialog Text size: larger label"));
            evidence.Click("Dialog Text size: larger"); yield return null; yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.AreEqual(1, board.TextScale);
            Assert.IsTrue(board.Paused);
        }
        [UnityTest] public IEnumerator LongTitleEveryNoticeAndWrappedDialogActionsKeepTheirRequestedSize()
        {
            evidence.Load("realm-8-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var session = board.Session;
            board.SetTextScale(1.3f);
            board.Bind(new BoardSession(session.Accepted, session.Rules, session.Actions,
                "Balam daily board presentation with a deliberately long descriptive title", session.RealmId));
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Fits(Label("Moves remaining"));
            var view = board.View;
            foreach (string notice in BoardNotices.All())
            {
                view.Status(notice); Fits(Label("Action status"));
                Assert.AreSame(view, board.View, "Status changes use space reserved before gameplay");
            }
            evidence.Click("Reroll action"); Assert.IsTrue(board.Busy);
            yield return null; Fits(Label("Action status"));
            Assert.AreSame(view, board.View, "Pending feedback must not rebuild the board");
            yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            const string action = "Return to the current board and continue playing from the last accepted position without changing this run";
            bool invoked = false;
            board.Pause();
            board.View.OpenModal("PAUSED", "A long action must wrap without losing its hit area.", (action, () => { invoked = true; board.Resume(); }));
            yield return null;
            var buttonLabel = Label("Dialog " + action + " label"); Fits(buttonLabel);
            Assert.AreEqual(SkinUi.ButtonDp * board.View.Layout.Density * 1.3f, buttonLabel.fontSize, .01f);
            Assert.GreaterOrEqual(buttonLabel.rectTransform.rect.height / board.View.Layout.Density, 48);
            evidence.Click("Dialog " + action); Assert.IsTrue(invoked);
        }
    }
}
