using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    public sealed class BoardTypographyTests
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
            // These floors address the captured 320x568 regression: standard
            // cells were 20px (50% viewport width) and larger-text cells 13px
            // (32.5%). Require at least 75% / 65% board width for normal states.
            // This measures the actual loaded TMP fonts and native fixture HUD,
            // not hard-coded rail heights or synthetic numeric boundary states.
            var art = (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
            foreach (string fixture in new[] { "realm-8-campaign", "realm-8-daily" })
            {
                evidence.Load(fixture); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
                foreach (float scale in new[] { 1f, 1.3f })
                {
                    var plan = BoardTypography.Build(art, board.State, board.Session, new Rect(0, 0, 320, 568), 1, scale);
                    Assert.IsFalse(plan.Expanded, fixture + " normal values must fit side cards at " + scale);
                    Assert.GreaterOrEqual(plan.Layout.Cell, scale == 1 ? 30 : 26, fixture + " must retain usable narrow-board size at " + scale);
                    Assert.GreaterOrEqual(plan.Layout.Board.width / plan.Layout.Frame.width, scale == 1 ? .75f : .65f);
                    Assert.GreaterOrEqual(plan.Guardian.center.x, plan.ScorePlate.xMax);
                    Assert.LessOrEqual(plan.Guardian.center.x, plan.ThemePlate.xMin);
                    Assert.IsFalse(plan.ScorePlate.Overlaps(plan.ThemePlate));
                    Assert.LessOrEqual(plan.Guardian.yMax + 3, plan.Title.yMin, "Portrait must be wholly below measured title");
                    if (!board.Session.Daily)
                        for (int star = 0; star < 3; star++)
                        {
                            Assert.LessOrEqual(plan.Star(star).yMax + 3, plan.Guardian.yMin, "Every socket hit region must be below the portrait");
                            Assert.IsFalse(plan.Star(star).Overlaps(plan.Title));
                            Assert.GreaterOrEqual(plan.Star(star).width, 48);
                        }
                    Assert.IsFalse(plan.Layout.GuardianButton.Overlaps(plan.Layout.RerollButton));
                    Assert.IsFalse(plan.Layout.RerollButton.Overlaps(plan.Layout.PauseButton));
                    Assert.GreaterOrEqual(plan.Layout.PauseButton.width, 48);
                    Assert.GreaterOrEqual(plan.Layout.GuardianButton.width, 48);
                }
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
            var art = (BoardArt)typeof(BoardController).GetField("art", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(board);
            board.View.gameObject.SetActive(false);
            try
            {
                foreach (float scale in new[] { 1f, 1.3f })
                {
                    // Render the real view at a 320x568 layout inside the test
                    // GameView. This checks actual glyph meshes and image rects;
                    // a separately captured 320x568 viewport remains evidence.
                    var narrow = new GameObject("Narrow native latch view"); narrow.transform.SetParent(root.transform);
                    try
                    {
                        var plan = BoardTypography.Build(art, board.State, board.Session, new Rect(0, 0, 320, 568), 1, scale);
                        var view = narrow.AddComponent<BoardView>(); view.Create(board, art, plan.Layout, plan);
                        view.Summary(board.State, board.Session, true);
                        Canvas.ForceUpdateCanvases(); yield return null;
                        var portrait = view.GetComponentsInChildren<Image>().Single(i => i.name == "Calm realm guardian");
                        var labels = view.GetComponentsInChildren<TMP_Text>();
                        var title = labels.Single(t => t.name == "Run title"); Fits(title);
                        var portraitRect = WorldRect(portrait.rectTransform);
                        Assert.LessOrEqual(portraitRect.yMax + 2.9f, WorldRect(title.rectTransform).yMin);
                        var sockets = view.GetComponentsInChildren<Button>().Where(b => b.name.StartsWith("Star ", StringComparison.Ordinal)).ToArray();
                        Assert.AreEqual(3, sockets.Length);
                        for (int i = 0; i < 3; i++)
                        {
                            var socket = sockets.Single(b => b.name == "Star " + i);
                            var label = socket.GetComponentInChildren<TMP_Text>(); label.ForceMeshUpdate();
                            Assert.AreEqual((board.State.LatchedStarSources & (1 << i)) != 0 ? "★" : "☆", label.text);
                            Assert.IsTrue(label.textInfo.characterInfo[0].isVisible);
                            Assert.Greater(label.mesh.vertexCount, 0, "Every native socket needs actual visible glyph geometry");
                            var rect = WorldRect(socket.GetComponent<RectTransform>());
                            Assert.GreaterOrEqual(rect.width, 48); Assert.GreaterOrEqual(rect.height, 48);
                            Assert.LessOrEqual(rect.yMax + 2.9f, portraitRect.yMin);
                            Assert.IsFalse(rect.Overlaps(WorldRect(title.rectTransform)));
                        }
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
                var portraitRect = WorldRect(portrait.rectTransform);
                Assert.LessOrEqual(portraitRect.yMax + 2.9f, WorldRect(title.rectTransform).yMin);
                var sockets = board.View.GetComponentsInChildren<Button>().Where(b => b.name.StartsWith("Star ", StringComparison.Ordinal)).ToArray();
                Assert.AreEqual(3, sockets.Length);
                for (int i = 0; i < 3; i++)
                {
                    var socket = sockets.Single(b => b.name == "Star " + i);
                    Assert.AreEqual((board.State.LatchedStarSources & (1 << i)) != 0 ? "★" : "☆", socket.GetComponentInChildren<TMP_Text>().text);
                    Assert.LessOrEqual(WorldRect(socket.GetComponent<RectTransform>()).yMax + 2.9f, portraitRect.yMin);
                }
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
        [UnityTest] public IEnumerator PublishedCampaignLongConstraintFitsItsDetailDialogAtLargerText()
        {
            evidence.Load("display-long-campaign-constraint"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            board.SetTextScale(1.3f); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            evidence.Click("Star 2"); yield return null;
            Assert.AreEqual("BLOW", Label("Dialog title").text);
            StringAssert.Contains("IN CONSECUTIVE MOVES", Label("Dialog details").text);
            Fits(Label("Dialog title")); Fits(Label("Dialog details"));
            evidence.Click("Dialog Back to the board"); yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            evidence.Click("Pause"); yield return null;
            Fits(Label("Dialog Text size: larger label"));
            evidence.Click("Dialog Text size: larger"); yield return null; yield return Wait(() => ZKube.Tests.Presentation.BoardTestState.Idle(board));
            Assert.AreEqual(1, board.TextScale);
            Assert.IsTrue(board.Paused);
        }
        [TestCase(320, 568, 1)] [TestCase(430, 932, 1)] [TestCase(1536, 2048, 2)]
        public void TallerTextRailsKeepSeparateActionsInsideTheSafeFrame(float width, float height, float density)
        {
            // The font-backed tests above validate the content; this isolates
            // safe-area/control geometry with the additional measured rails.
            var safe = new Rect(0, 34 * density, width, height - 78 * density);
            var layout = new BoardLayout(safe, density, 280 * density, 120 * density, true);
            foreach (var button in new[] { layout.GuardianButton, layout.RerollButton, layout.PauseButton })
            {
                Assert.GreaterOrEqual(button.width / density, 48); Assert.GreaterOrEqual(button.height / density, 48);
                Assert.IsTrue(safe.Contains(button.min)); Assert.IsTrue(safe.Contains(button.max));
            }
            Assert.IsFalse(layout.GuardianButton.Overlaps(layout.RerollButton));
            Assert.IsFalse(layout.RerollButton.Overlaps(layout.PauseButton));
            Assert.GreaterOrEqual(layout.Board.yMin, safe.yMin + layout.Footer);
            Assert.LessOrEqual(layout.Board.yMax, safe.yMax - layout.Header);
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
            Assert.AreEqual(13 * board.View.Layout.Density * 1.3f, buttonLabel.fontSize, .01f);
            Assert.GreaterOrEqual(buttonLabel.rectTransform.rect.height / board.View.Layout.Density, 48);
            evidence.Click("Dialog " + action); Assert.IsTrue(invoked);
        }
    }
}
