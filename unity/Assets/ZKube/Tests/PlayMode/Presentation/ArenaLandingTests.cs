using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // The Arena's landing page, drawn by the shared pages: today's Daily with
    // its one action and the Kredit figure, then today's boards side by side.
    public sealed class ArenaLandingTests
    {
        private GameObject root;
        private PageShell shell;
        private PageViews views;
        private ArenaLandingSource source;
        [SetUp] public void TaughtEveryLesson() => Lessons.Device = Lessons.Memory(taught: true);
        [UnityTearDown] public IEnumerator TearDown() { if (root != null) UnityEngine.Object.Destroy(root); yield return null; }

        private IEnumerator Open(float textScale = 1)
        {
            root = new GameObject("Arena landing");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            shell = root.AddComponent<PageShell>(); shell.Initialize("Arena landing");
            shell.RequestRealm(3);
            while (shell.Loading) yield return null;
            Assert.That(shell.ArtworkError, Is.Null);
            source = new ArenaLandingSource();
            views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Arena", "arena", textScale);
        }
        private IEnumerator Draw(ArcadeView arcade, string action = "Enter · 1 Kredit")
        {
            long now = 20705L * 86400 + 8 * 3600;
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400 + 7 * 3600 - 60,
                Arcade = arcade, Actions = action == null ? Array.Empty<PageAction>() : new[] { new PageAction { Label = action } } };
            views.Render(AppPage.Home); yield return null;
            foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
            yield return null; Canvas.ForceUpdateCanvases();
        }
        private Image[] Named(string name) => root.GetComponentsInChildren<Image>().Where(image => image.name == name).ToArray();
        private Rect Area(string name) => SkinUi.ScreenRect(Named(name).Single().rectTransform);

        // Both cards fit both phones without scrolling, with the player's own
        // rows, a reason line, the rewards badge and the larger text: the top 5
        // rows of each board at the compact phone, and on the Seeker as many as
        // fit, the top 10 on the plain page at the standard text size.
        [UnityTest] public IEnumerator TheLandingPageFitsBothPhonesWithBothBoardsAndTheOwnRows()
        {
            foreach (float scale in new[] { 1f, 1.3f })
            {
                yield return Open(scale);
                foreach (var (phone, size, most) in new (Action<PageShell, float>, string, int)[] {
                    (Phones.Compact, "compact", PageViews.LandingRowsCompact), (Phones.Seeker, "seeker", PageViews.LandingRowsSeeker) })
                {
                    phone(shell, 1);
                    var arcade = ArenaLanding.View(claims: "2 to claim"); arcade.Reason = "Entries are paused."; arcade.Warning = true;
                    yield return Draw(arcade);
                    string at = size + " at text " + scale;
                    Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Scroll.viewport.rect.height + .5f), at + ": the page does not scroll");
                    var safe = shell.SafeArea; var bar = SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform);
                    foreach (string board in new[] { "Score", "Objective" })
                    {
                        var drawn = root.GetComponentsInChildren<Image>().Where(image => image.name.StartsWith(board + " board row ") && !image.name.EndsWith(" rim")).ToArray();
                        Assert.That(drawn.Length, Is.InRange(PageViews.LandingRowsCompact, most), at + ": the " + board + " board shows the rows that fit");
                        var yours = Area(board + " board yours");
                        Assert.That(yours.yMax, Is.LessThan(drawn.Min(row => SkinUi.ScreenRect(row.rectTransform).yMin)), at + ": the player's row sits under the top rows");
                        Assert.That(yours.yMin, Is.GreaterThan(bar.yMax), at + ": above the tab bar");
                    }
                    var cards = new[] { Area("Daily card"), Area("Boards card") };
                    Assert.That(cards[1].yMax, Is.LessThan(cards[0].yMin), at + ": the boards sit under the Daily");
                    foreach (var card in cards)
                        Assert.That(card.xMin >= safe.xMin && card.xMax <= safe.xMax && card.yMin >= bar.yMax && card.yMax <= safe.yMax, Is.True, at + ": inside the safe area");
                    foreach (var label in root.GetComponentsInChildren<TMP_Text>().Where(text => text.name.Contains(" board row ") || text.name.Contains(" board yours")))
                    {
                        label.ForceMeshUpdate();
                        Assert.That(label.textInfo.lineCount, Is.LessThanOrEqualTo(1), at + ": " + label.name + " stays on one line");
                        Assert.That(label.fontSize / scale, Is.GreaterThanOrEqualTo(12 - .01f), at + ": " + label.name + " is 12 dp or more");
                    }
                    yield return Captures.Snap(shell, "landing ready " + size + (scale > 1 ? " large text" : ""));
                    // The plain page at the standard text size has room for every row its phone is drawn with.
                    if (scale > 1) continue;
                    yield return Draw(ArenaLanding.View());
                    foreach (string board in new[] { "Score", "Objective" })
                        Assert.That(root.GetComponentsInChildren<Image>().Count(image => image.name.StartsWith(board + " board row ") && !image.name.EndsWith(" rim")),
                            Is.EqualTo(most), at + ": the " + board + " board shows its top " + most);
                    Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Scroll.viewport.rect.height + .5f), at + ": the plain page does not scroll");
                }
                Phones.Clear(shell); UnityEngine.Object.Destroy(root); root = null; yield return null;
            }
        }

        // A player appears once in a board's column, on both phones. Among the
        // rows shown their row is lit in place and nothing is pinned; one place
        // below the last row shown it is pinned under them. A player with no
        // result has no line, unless they have played: then one line says they
        // have no score there, alone on a board without rows.
        [UnityTest] public IEnumerator APlayerAppearsOnceInEachBoardColumnOnBothPhones()
        {
            yield return Open(1);
            const string noScore = "No score yet";
            ArcadeView Boards(int? rank, bool played, int held = 12)
            {
                var view = ArenaLanding.View();
                foreach (var board in view.Boards)
                {
                    var all = Enumerable.Range(1, held).Select(place => new BoardRowView { Rank = place.ToString(), Player = place == rank ? "You" : "7WFy…ZDRA",
                        Value = (500 - place).ToString(), Yours = place == rank }).ToArray();
                    board.Rows = all.Take(PageViews.LandingRowsSeeker).ToArray(); board.Empty = held == 0 ? "No runs yet" : null;
                    board.Yours = rank.HasValue ? all[rank.Value - 1] : played ? new BoardRowView { Player = "You", Note = noScore, Yours = true } : null;
                }
                return view;
            }
            foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Compact, "compact"), (Phones.Seeker, "seeker") })
            {
                phone(shell, 1);
                yield return Draw(Boards(null, false));
                int shown = root.GetComponentsInChildren<Image>().Count(image => image.name.StartsWith("Score board row ") && !image.name.EndsWith(" rim"));
                Assert.That(shown, Is.InRange(PageViews.LandingRowsCompact, PageViews.LandingRowsSeeker));
                int Mine(string board) => root.GetComponentsInChildren<TMP_Text>().Count(text => text.name.StartsWith(board + " board ") && text.name.EndsWith(" player") && text.text == "You");
                bool Pinned(string board) => root.GetComponentsInChildren<Image>().Any(image => image.name == board + " board yours");
                foreach (string board in new[] { "Score", "Objective" })
                { Assert.That(Mine(board), Is.Zero, size + ": no result, no line"); Assert.That(Pinned(board), Is.False, size + ": no result, nothing pinned"); }
                foreach (var (rank, what) in new[] { (1, "rank 1"), (3, "inside the rows shown"), (shown, "the last row shown"), (shown + 1, "one below the rows shown") })
                {
                    yield return Draw(Boards(rank, true));
                    foreach (string board in new[] { "Score", "Objective" })
                    {
                        Assert.That(Mine(board), Is.EqualTo(1), size + ", " + what + ": the player appears once on the " + board + " board");
                        Assert.That(Pinned(board), Is.EqualTo(rank > shown), size + ", " + what + ": pinned only below the rows shown");
                        if (rank <= shown) Assert.That(root.GetComponentsInChildren<Image>().Any(image => image.name == board + " board row " + rank + " rim"), Is.True, size + ", " + what + ": lit in place");
                    }
                    yield return Captures.Snap(shell, "own row " + size + " " + what);
                }
                // Played today, no row on these boards: one line under the others' rows says so.
                yield return Draw(Boards(null, true));
                foreach (string board in new[] { "Score", "Objective" })
                {
                    Assert.That(Mine(board), Is.EqualTo(1)); Assert.That(Pinned(board), Is.True);
                    Assert.That(root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == board + " board yours note").text, Is.EqualTo(noScore));
                }
                yield return Captures.Snap(shell, "own row " + size + " no score under rows");
                // The same on boards nobody has a row on: that line alone, in place of "No runs yet".
                yield return Draw(Boards(null, true, 0));
                foreach (string board in new[] { "Score", "Objective" })
                {
                    Assert.That(Mine(board), Is.EqualTo(1)); Assert.That(Pinned(board), Is.True);
                    Assert.That(root.GetComponentsInChildren<TMP_Text>().Any(text => text.name == board + " board empty"), Is.False, size + ": one line is enough");
                }
                yield return Captures.Snap(shell, "own row " + size + " no score on empty boards");
                // And before the player has played: "No runs yet", and no line of their own.
                yield return Draw(Boards(null, false, 0));
                foreach (string board in new[] { "Score", "Objective" })
                {
                    Assert.That(Mine(board), Is.Zero); Assert.That(Pinned(board), Is.False);
                    Assert.That(root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == board + " board empty").text, Is.EqualTo("No runs yet"));
                }
                yield return Captures.Snap(shell, "own row " + size + " empty boards");
            }
            Phones.Clear(shell);
        }

        // The Kredit figure shows its own state and opens Kredits: plain with
        // enough, a gold rim and a plus on the last one, an ember rim and a plus at none.
        [UnityTest] public IEnumerator TheKreditFigureShowsItsStateAndOpensKredits()
        {
            yield return Open(); Phones.Compact(shell);
            foreach (var (level, kredits) in new[] { (KreditLevel.Enough, "12"), (KreditLevel.Last, "1"), (KreditLevel.None, "0") })
            {
                int opened = 0;
                var arcade = ArenaLanding.View(kredits: kredits, level: level); arcade.OpenKredits = new PageAction { Label = "Kredits", Invoke = () => opened++ };
                yield return Draw(arcade, level == KreditLevel.None ? "Buy Kredits" : "Enter · 1 Kredit");
                Assert.That(root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Kredit figure number").text, Is.EqualTo(kredits), level.ToString());
                Assert.That(Named("Kredit top-up").Length, Is.EqualTo(level == KreditLevel.Enough ? 0 : 1), level + ": the top-up mark");
                if (level != KreditLevel.Enough)
                    Assert.That(Named("Kredit figure rim").Single().color, Is.EqualTo(shell.Artwork.Token(level == KreditLevel.None ? SkinTokens.Negative : SkinTokens.Accent)),
                        level + ": the rim's ink");
                if (level != KreditLevel.Enough)
                    Assert.That(Named("Kredit top-up").Single().color, Is.EqualTo(Named("Kredit figure rim").Single().color), level + ": the mark in the rim's ink");
                var tap = root.GetComponentsInChildren<Button>().Single(button => button.name == "Kredits");
                Assert.That(SkinUi.ScreenRect((RectTransform)tap.transform).height, Is.GreaterThanOrEqualTo(BoardLayout.MinimumTouchDp - .01f), level + ": a finger's height");
                tap.onClick.Invoke(); Assert.That(opened, Is.EqualTo(1), level + ": the figure opens Kredits");
                yield return Captures.Snap(shell, "landing kredits " + level.ToString().ToLowerInvariant() + " compact");
            }
        }

        // The boards card stands on its own: while its read is out it holds the
        // rows' places, a failed read says so there with a retry, a day without
        // runs says so in each column, and a Classic day shows Score alone. The
        // Daily card and its action are drawn in every case.
        [UnityTest] public IEnumerator TheBoardsCardStandsAloneWhileLoadingFailedEmptyAndClassic()
        {
            yield return Open(); Phones.Compact(shell);
            var loading = ArenaLanding.View(); loading.Boards = null;
            yield return Draw(loading);
            Assert.That(root.GetComponentsInChildren<Image>().Count(image => image.name.Contains(" place ")), Is.EqualTo(2 * (PageViews.LandingRowsCompact + 1)), "Two columns of places");
            Assert.That(root.GetComponentsInChildren<Button>().Any(button => button.name == "Enter · 1 Kredit"), Is.True, "The Daily card works before the boards arrive");
            yield return Captures.Snap(shell, "landing boards loading compact");

            int retried = 0;
            var failed = ArenaLanding.View(); failed.Boards = null; failed.BoardsNotice = "Boards not loaded.";
            failed.BoardsRetry = new PageAction { Label = "Try again", Name = "Reload boards", Invoke = () => retried++ };
            yield return Draw(failed);
            Assert.That(root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Boards notice").text, Is.EqualTo("Boards not loaded."));
            root.GetComponentsInChildren<Button>().Single(button => button.name == "Reload boards").onClick.Invoke(); Assert.That(retried, Is.EqualTo(1));
            Assert.That(root.GetComponentsInChildren<Button>().Any(button => button.name == "Enter · 1 Kredit"), Is.True, "The Daily card works when the boards read failed");
            yield return Captures.Snap(shell, "landing boards failed compact");

            var empty = ArenaLanding.View();
            foreach (var board in empty.Boards) { board.Rows = Array.Empty<BoardRowView>(); board.Empty = "No runs yet"; board.Yours = null; }
            yield return Draw(empty);
            Assert.That(root.GetComponentsInChildren<TMP_Text>().Count(text => text.name.EndsWith(" board empty") && text.text == "No runs yet"), Is.EqualTo(2));
            Assert.That(root.GetComponentsInChildren<Image>().Any(image => image.name.EndsWith(" board yours")), Is.False, "An empty board is one line: nothing is pinned under it");
            yield return Captures.Snap(shell, "landing boards empty compact");

            yield return Draw(ArenaLanding.View(classic: true));
            Assert.That(root.GetComponentsInChildren<Image>().Any(image => image.name.StartsWith("Objective board")), Is.False, "A Classic day has no second board");
            var card = Area("Boards card"); var row = Area("Score board row 1");
            Assert.That(row.width, Is.GreaterThan(card.width * .8f), "Score takes the card's width");
            yield return Captures.Snap(shell, "landing classic compact");
        }

        // Every state of the page fits both phones without scrolling: each next
        // step, each reason, the day's headlines, and the boards card loading,
        // failed, empty, alone on a Classic day and with rewards to claim.
        [UnityTest] public IEnumerator EveryLandingStateFitsBothPhonesWithoutScrolling()
        {
            yield return Open();
            ArcadeView With(Action<ArcadeView> change, ArcadeView view = null) { view ??= ArenaLanding.View(); change(view); return view; }
            var states = new (string name, Func<ArcadeView> view, string action)[] {
                ("enter", () => ArenaLanding.View(), "Enter · 1 Kredit"),
                ("last kredit", () => ArenaLanding.View(kredits: "1", level: KreditLevel.Last), "Enter · 1 Kredit"),
                ("no kredits", () => ArenaLanding.View(kredits: "0", level: KreditLevel.None), "Buy Kredits"),
                ("set up device", () => ArenaLanding.View(kredits: "0"), "Set up device"),
                ("top up deposit", () => ArenaLanding.View(), "Top up deposit"),
                ("run in flight", () => ArenaLanding.View(kredits: "2"), "Resume run"),
                ("still checking", () => With(view => view.Reason = "Still checking. This either completes or changes nothing."), "Confirming"),
                ("entries paused", () => With(view => { view.Headline = "Entries paused"; view.Warning = true; view.Reason = "Entries are paused."; }), "Play Campaign"),
                ("entries closed", () => With(view => view.Headline = "Entries closed"), "See boards"),
                ("opens soon", () => new ArcadeView { Headline = "Opens soon" }, "Play Campaign"),
                ("boards loading", () => With(view => view.Boards = null), "Enter · 1 Kredit"),
                ("boards failed", () => With(view => { view.Boards = null; view.BoardsNotice = "Boards not loaded.";
                    view.BoardsRetry = new PageAction { Label = "Try again", Name = "Reload boards" }; }), "Enter · 1 Kredit"),
                ("boards empty", () => With(view => { foreach (var board in view.Boards) { board.Rows = Array.Empty<BoardRowView>(); board.Empty = "No runs yet"; board.Yours = null; } }), "Enter · 1 Kredit"),
                ("classic", () => ArenaLanding.View(classic: true), "Enter · 1 Kredit"),
                ("rewards to claim", () => With(view => { view.Reason = "Your device request is still finishing."; }, ArenaLanding.View(claims: "2 to claim")), "Resume run") };
            foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Seeker, "seeker"), (Phones.Compact, "compact") })
            {
                phone(shell, 1);
                foreach (var (name, view, action) in states)
                {
                    yield return Draw(view(), action);
                    string at = size + ", " + name;
                    Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Scroll.viewport.rect.height + .5f), at + ": the page does not scroll");
                    var safe = shell.SafeArea; var bar = SkinUi.ScreenRect((RectTransform)shell.Chrome.GetComponentInChildren<SkinTabBar>().transform);
                    foreach (string card in new[] { "Daily card", "Boards card" })
                    {
                        if (Named(card).Length == 0) { Assert.That(name, Is.EqualTo("opens soon"), at + ": only an unopened Arena has no " + card); continue; }
                        var area = Area(card);
                        Assert.That(area.xMin >= safe.xMin && area.xMax <= safe.xMax && area.yMin >= bar.yMax && area.yMax <= safe.yMax, Is.True, at + ": the " + card + " inside the safe area");
                    }
                    Assert.That(root.GetComponentsInChildren<Button>().Count(button => Area("Daily card").Contains(SkinUi.ScreenRect((RectTransform)button.transform).center) &&
                        button.name != "Kredits"), Is.EqualTo(action == null ? 0 : 1), at + ": one action at most");
                    yield return Captures.Snap(shell, "landing " + name + " " + size);
                }
            }
        }

        // An action in progress shows on its own button: the loader turning where
        // the icon was, its step as the words, at full strength and taking no
        // tap. Reduced motion shows the still hourglass and the same word.
        [UnityTest] public IEnumerator AnActionInProgressShowsTheLoaderAndItsStepAndTakesNoTap()
        {
            yield return Open(); Phones.Compact(shell);
            foreach (bool still in new[] { false, true })
            {
                source.Still = still; int taps = 0; long now = 20705L * 86400 + 8 * 3600;
                source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400 + 7 * 3600 - 60,
                    Arcade = ArenaLanding.View(), Actions = new[] { new PageAction { Label = "Confirming", Name = "Action progress", Progress = "Confirming", Invoke = () => taps++ } } };
                views.Render(AppPage.Home); yield return null;
                foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return null; Canvas.ForceUpdateCanvases();
                string at = still ? "reduced motion" : "motion";
                var button = root.GetComponentsInChildren<Button>().Single(value => value.name == "Action progress");
                Assert.That(button.GetComponentInChildren<TMP_Text>().text, Is.EqualTo("Confirming"), at + ": the step is the button's words");
                Assert.That(button.interactable, Is.False, at + ": it takes no tap");
                button.onClick.Invoke(); Assert.That(taps, Is.Zero, at);
                Assert.That(button.GetComponent<CanvasGroup>()?.alpha ?? 1, Is.EqualTo(1), at + ": drawn at full strength");
                var loader = Named("Action loader").Single();
                StringAssert.StartsWith(still ? SkinSlots.IconHourglass : SkinSlots.IconRetry, loader.sprite.name, at + ": the loader's mark");
                Assert.That(loader.GetComponent<Turn>() != null, Is.EqualTo(!still), at + ": it turns only with motion on");
                float angle = loader.transform.localEulerAngles.z; yield return new WaitForSecondsRealtime(.15f);
                Assert.That(Mathf.Approximately(loader.transform.localEulerAngles.z, angle), Is.EqualTo(still), at + ": the loader's motion");
                Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Scroll.viewport.rect.height + .5f), at + ": the page does not scroll");
                yield return Captures.Snap(shell, "landing action in progress" + (still ? " reduced motion" : ""));
            }
        }

        // A board column opens its board, and the rewards badge, drawn only when
        // rewards wait, opens them.
        [UnityTest] public IEnumerator ABoardColumnOpensItsBoardAndTheBadgeOpensTheRewards()
        {
            yield return Open(); Phones.Seeker(shell);
            string opened = null;
            var arcade = ArenaLanding.View(claims: "2 to claim");
            foreach (var board in arcade.Boards) { string name = board.Name; board.Open.Invoke = () => opened = name; }
            arcade.Claims.Invoke = () => opened = "rewards";
            yield return Draw(arcade);
            foreach (string name in new[] { "Score", "Objective" })
            {
                root.GetComponentsInChildren<Button>().Single(button => button.name == "Open " + name + " board").onClick.Invoke();
                Assert.That(opened, Is.EqualTo(name));
            }
            var badge = root.GetComponentsInChildren<Button>().Single(button => button.name == "Rewards to claim");
            Assert.That(root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Rewards badge words").text, Is.EqualTo("2 to claim"));
            badge.onClick.Invoke(); Assert.That(opened, Is.EqualTo("rewards"));
            yield return Captures.Snap(shell, "landing rewards to claim seeker");
            yield return Draw(ArenaLanding.View());
            Assert.That(root.GetComponentsInChildren<Button>().Any(button => button.name == "Rewards to claim"), Is.False, "No badge with nothing to claim");
        }
    }
}
