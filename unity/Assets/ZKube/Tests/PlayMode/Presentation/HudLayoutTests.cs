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
        [UnityTest] public IEnumerator NormalNarrowBoardsKeepPlayableAreaWithActualFontsAtBothTextSizes()
        {
            // The smallest mainstream Android phone is 360x640 dp. An earlier
            // regression shrank cells to 20px standard and 13px larger-text. Require at least 30px / 26px cells and 75% / 65%
            // board width, measured with the actual loaded fonts and the native
            // fixture HUD rather than hard-coded rail heights.
            var art = Art();
            foreach (string fixture in new[] { "realm-8-campaign", "display-long-campaign-constraint", "realm-8-daily" })
            {
                evidence.Load(fixture); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                foreach (float scale in new[] { 1f, 1.3f })
                {
                    var plan = HudLayout.Build(new SkinUi(art, 1, scale), board.State, board.Session, new Rect(0, 0, 360, 640), 1);
                    string detail = $" at {scale} (header {plan.Layout.Header}, footer {plan.Layout.Footer}, cell {plan.Layout.Cell}, title {plan.Title}," +
                        $" medallion {plan.Medallion}, score {plan.ScorePlate}, moves {plan.Moves}, pressure {plan.Pressure}, primary {plan.PrimaryPlate}," +
                        $" secondary {plan.SecondaryPlate}, rule above {plan.RuleAbove})";
                    Assert.GreaterOrEqual(plan.Layout.Cell, scale == 1 ? 30 : 26, fixture + " must retain usable narrow-board size" + detail);
                    Assert.GreaterOrEqual(plan.Layout.Board.width / plan.Layout.Frame.width, scale == 1 ? .75f : .65f, fixture + " board width" + detail);
                    Assert.GreaterOrEqual(plan.Medallion.xMin, plan.ScorePlate.xMax, "The medallion sits between the columns");
                    Assert.LessOrEqual(plan.Medallion.xMax, plan.Moves.xMin);
                    Assert.LessOrEqual(plan.Medallion.yMax, plan.Title.yMin, "The medallion is wholly below the title ribbon");
                    var pieces = new System.Collections.Generic.List<Rect> { plan.Title, plan.ScorePlate, plan.Moves, plan.PrimaryPlate };
                    if (board.Session.Daily) pieces.Add(plan.Pressure); else pieces.Add(plan.SecondaryPlate);
                    for (int a = 0; a < pieces.Count; a++) for (int b = a + 1; b < pieces.Count; b++)
                        Assert.IsFalse(pieces[a].Overlaps(pieces[b]), fixture + " HUD pieces " + a + " and " + b + " overlap at " + scale);
                    foreach (var piece in pieces) Assert.GreaterOrEqual(piece.yMin, plan.Layout.Board.yMax, "The HUD stays above the board");
                    Assert.LessOrEqual(plan.PrimaryPlate.yMax, Mathf.Min(plan.ScorePlate.yMin, plan.Medallion.yMin), "Goals sit on their own row");
                    if (!board.Session.Daily)
                    {
                        var owners = new[] { plan.ScorePlate, plan.PrimaryPlate, plan.SecondaryPlate };
                        for (int star = 0; star < 3; star++)
                        {
                            var rect = plan.Star(star);
                            Assert.GreaterOrEqual(rect.width, 48); Assert.GreaterOrEqual(rect.height, 48);
                            Assert.GreaterOrEqual(rect.xMin, owners[star].xMin, "Each star sits inside the piece of its source");
                            Assert.LessOrEqual(rect.xMax, owners[star].xMax);
                            foreach (var piece in pieces.Where(piece => piece != owners[star]))
                                Assert.IsFalse(rect.Overlaps(piece), "Star " + star + " reaches into another HUD piece");
                        }
                    }
                    Assert.IsFalse(plan.Layout.GuardianButton.Overlaps(plan.Layout.RerollButton));
                    Assert.IsFalse(plan.Layout.RerollButton.Overlaps(plan.Layout.PauseButton));
                    Assert.GreaterOrEqual(plan.Layout.PauseButton.width, 48);
                    Assert.GreaterOrEqual(plan.Layout.GuardianButton.width, 48);
                }
            }
        }
        private BoardArt Art() => (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
        private static string SpriteName(Image image) => image.sprite.name.Replace("(Clone)", "");
        private void AssertStars(BoardView view)
        {
            var sockets = view.GetComponentsInChildren<Button>().Where(b => b.name.StartsWith("Star ", StringComparison.Ordinal)).ToArray();
            Assert.AreEqual(3, sockets.Length);
            for (int i = 0; i < 3; i++)
            {
                var socket = sockets.Single(b => b.name == "Star " + i);
                var glyph = socket.GetComponentsInChildren<Image>().Single(image => image.name == "Star " + i + " glyph");
                bool earned = (board.State.LatchedStarSources & (1 << i)) != 0;
                Assert.AreEqual(!earned ? "star-off" : glyph.rectTransform.rect.height > 96 ? "star-big" : "star-on", SpriteName(glyph));
                var rect = WorldRect(socket.GetComponent<RectTransform>());
                Assert.GreaterOrEqual(rect.width, 48); Assert.GreaterOrEqual(rect.height, 48);
            }
        }
        private void Fits(TMP_Text text)
        {
            text.ForceMeshUpdate();
            Assert.IsFalse(text.enableAutoSizing, text.name + " must retain the requested size");
            Assert.IsFalse(text.isTextTruncated, text.name + " must not hide text with ellipsis");
            Assert.LessOrEqual(text.GetPreferredValues(text.text, text.rectTransform.rect.width, float.PositiveInfinity).y,
                text.rectTransform.rect.height + .5f, text.name + " must have enough height at its real width");
        }
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
                        var portrait = view.GetComponentsInChildren<Image>().Single(i => i.name == "Calm realm guardian");
                        var title = view.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Run title"); Fits(title);
                        Assert.LessOrEqual(WorldRect(portrait.rectTransform).yMax, WorldRect(title.rectTransform).yMin);
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
                var portrait = board.View.GetComponentsInChildren<Image>().Single(i => i.name == "Calm realm guardian");
                var title = board.View.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Run title");
                Assert.LessOrEqual(WorldRect(portrait.rectTransform).yMax, WorldRect(title.rectTransform).yMin);
                AssertStars(board.View);
                var campaign = board.View;
                evidence.Load("realm-8-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                Assert.AreNotSame(campaign, board.View);
                Assert.IsFalse(board.View.GetComponentsInChildren<Button>().Any(b => b.name.StartsWith("Star ", StringComparison.Ordinal)),
                    "Daily must hide Campaign socket controls after rebinding");
            }
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
            Assert.AreEqual(board.State.DailyScore.ToString(), Label("Score").text);
            Assert.AreEqual(board.State.ObjectiveTotal.ToString(), Label("Theme").text);
            Assert.AreEqual("GUARDIAN TRIGGERS", Label("Theme label").text);
            foreach (string name in new[] { "Score", "Score label", "Theme", "Theme label", "Guardian earning label", "Guardian earning rule" }) Fits(Label(name));
            Assert.Greater(board.View.Layout.Cell, 0);
            var layout = board.View.Layout;
            Assert.GreaterOrEqual(layout.GuardianButton.width / layout.Density, 48);
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton)); Assert.IsFalse(layout.RerollButton.Overlaps(layout.PauseButton));
            Assert.GreaterOrEqual(layout.Board.yMin, layout.Frame.yMin + layout.Footer);
            Assert.LessOrEqual(layout.Board.yMax, layout.Frame.yMax - layout.Header);
        }
        [UnityTest] public IEnumerator ResultsAndPressureUseThePlayersWordsNotInternalNames()
        {
            evidence.Load("realm-8-campaign"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            var rules = board.Session.Rules;
            string campaign = BoardController.TerminalBody(board.State, board.Session);
            StringAssert.Contains("Reach " + rules.PointsRequired + " points", campaign);
            StringAssert.Contains(HudLayout.PrimaryCaptionText(board.Session) + " · " + HudLayout.PrimaryText(board.State, board.Session), campaign);
            StringAssert.Contains(HudLayout.SecondaryCaptionText(board.Session), campaign);
            evidence.Load("realm-8-daily"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            string daily = BoardController.TerminalBody(board.State, board.Session);
            StringAssert.Contains(HudLayout.PrimaryCaptionText(board.Session) + " · " + board.State.ObjectiveTotal, daily);
            foreach (string body in new[] { campaign, daily })
                foreach (string internalName in new[] { "Theme", "Shape", "Blow", "SHAPE", "BLOW" })
                    StringAssert.DoesNotContain(internalName, body);
            Assert.AreEqual("POINTS ×" + (Protocol.PressureMultiplierPercent(board.State.CurrentTier) / 100f).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture),
                Label("Pressure").text);
            Assert.AreEqual("POINTS ×1", HudLayout.PressureText(new RunSummary { CurrentTier = 0 }));
            Assert.AreEqual("POINTS ×2.5", HudLayout.PressureText(new RunSummary { CurrentTier = 3 }));
        }
        [UnityTest] public IEnumerator PublishedCampaignLongConstraintFitsItsDetailDialogAtLargerText()
        {
            evidence.Load("display-long-campaign-constraint"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.SetTextScale(1.3f); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            evidence.Click("Star 2"); yield return null;
            StringAssert.Contains("IN CONSECUTIVE MOVES", Label("Dialog title").text);
            Assert.AreEqual("Not earned yet", Label("Dialog details").text);
            Fits(Label("Dialog title")); Fits(Label("Dialog details"));
            evidence.Click("Dialog Back to the board"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
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
            Fits(Label("Run title")); Fits(Label("Moves remaining"));
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
            Assert.AreEqual(15 * board.View.Layout.Density * 1.3f, buttonLabel.fontSize, .01f);
            Assert.GreaterOrEqual(buttonLabel.rectTransform.rect.height / board.View.Layout.Density, 48);
            evidence.Click("Dialog " + action); Assert.IsTrue(invoked);
        }
    }
}
