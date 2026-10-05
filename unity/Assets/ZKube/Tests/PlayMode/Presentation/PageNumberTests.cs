using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // Every numeric field at its largest (u64, u32 and int maximums) stays on
    // one line in its plate or card, on a compact phone at larger text: it
    // shrinks, then abbreviates, never wraps. Every pill label stays on one
    // line too: it shrinks, then takes its shorter words.
    public sealed class PageNumberTests
    {
        // Every lesson is taught: these pages are measured without a lesson over them.
        [SetUp] public void TaughtEveryLesson() => Lessons.Device = Lessons.Memory(taught: true);
        private sealed class Largest : IAppPageSource
        {
            public byte Kind, Value;
            public CampaignPageView CampaignView() => new CampaignPageView { Realm = 1, Stars = int.MaxValue,
                Trials = Enumerable.Range(1, 10).Select(level => new CampaignTrialView { Level = (byte)level, Stars = 3, Available = true }).ToArray() };
            public CampaignSummaryView CampaignSummary() => new CampaignSummaryView { Realm = 1, Stars = int.MaxValue, Levels = 10,
                Trials = CampaignView().Trials, Map = new PageAction { Label = "Explore map" } };
            public LevelPageView LevelPage() => new LevelPageView { Realm = 1, Level = 3, Stars = 3, Moves = uint.MaxValue,
                Goals = new CampaignGoals { Points = uint.MaxValue, PrimaryKind = 3, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 },
                Play = new PageAction { Label = "Play" }, Back = new PageAction { Label = "Back to map" } };
            public DailyPageView Daily;
            public DailyPageView DailyPage() => Daily;
            public ulong Ladder = ulong.MaxValue;
            public ProfilePageView ProfilePage() => new ProfilePageView { Name = "7WFy…ZDRA", Realm = 1, Emblem = 1, Tier = 4, Stars = int.MaxValue,
                Streak = ulong.MaxValue, BestDailyScore = ulong.MaxValue, LadderPoints = Ladder, LadderTier = NativeEngine.LadderTier(Ladder),
                Records = new PageAction { Label = "Records" }, ChooseBorder = new PageAction { Label = "Choose a border" } };
            public SettingsPageView SettingsPage() => AppPreferences.Read(() => { });
            public ResultPageView Result;
            public ResultPageView ResultPage() => Result;
            public bool CanNavigate(AppPage page) => true;
            public void Navigate(AppPage page) { }
            public void Report(Exception error) => throw error;
        }
        private static readonly string Max = ulong.MaxValue.ToString("N0", CultureInfo.InvariantCulture);
        private static readonly string MaxSol = (ulong.MaxValue / 1000000000m).ToString("0.00#######", CultureInfo.InvariantCulture) + " SOL";
        private GameObject root;

        [UnityTearDown] public IEnumerator TearDown() { if (root != null) UnityEngine.Object.Destroy(root); yield return null; }

        [UnityTest] public IEnumerator EveryNumericFieldAtItsMaximumStaysOnOneLine()
        {
            root = new GameObject("Largest numbers");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Largest numbers");
            Phones.Compact(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            Assert.That(shell.ArtworkError, Is.Null);
            var daily = NativeEngine.Daily(20705);
            var source = new Largest();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1.3f);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            var numbers = shell.Artwork.Font(SkinUi.Type.Number);
            long now = 20705L * 86400;
            IEnumerator Check(string page, Action draw)
            {
                draw(); yield return null;
                foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return null;
                PageText.AssertNumbersOnOneLine(root.transform, numbers, page);
                PageText.AssertRunningTextFigures(root.transform, page, shell.Artwork.Font(SkinUi.Type.Caption), shell.Artwork.Font(SkinUi.Type.Body));
                PageText.AssertPillLabelsOnOneLine(root.transform, page);
            }
            source.Daily = new DailyPageView { Day = 20705, Realm = 1, ObjectiveKind = daily.Kind, ObjectiveValue = daily.Value, Now = () => now,
                ClosesAt = now + 3600, NextOpensAt = now + 3600, Score = ulong.MaxValue, ObjectiveTotal = ulong.MaxValue,
                Actions = new[] { new PageAction { Label = "View result" } } };
            yield return Check("Used Daily", () => views.Render(AppPage.Home));
            source.Daily = new DailyPageView { Day = 20705, Realm = 1, ObjectiveKind = daily.Kind, ObjectiveValue = daily.Value, Now = () => now,
                ClosesAt = now + 3600, Arcade = ArenaLanding.View(MaxSol, NumberFit.Figure(ulong.MaxValue), KreditLevel.Last, Max),
                Actions = new[] { new PageAction { Label = "Enter · 1 Kredit" } } };
            yield return Check("Arena", () => views.Render(AppPage.Home));
            yield return Check("Level", () => views.Render(AppPage.Level));
            yield return Check("Profile", () => views.Render(AppPage.Profile));
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20705,
                ObjectiveKind = daily.Kind, ObjectiveValue = daily.Value, Score = ulong.MaxValue, ObjectiveTotal = ulong.MaxValue, Streak = ulong.MaxValue };
            yield return Check("Daily result", () => views.Render(AppPage.Result));
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1,
                Level = 3, Score = ulong.MaxValue, StarSources = 7, EndReason = 1, MovesLeft = uint.MaxValue, PrimaryProgress = uint.MaxValue,
                Goals = new CampaignGoals { Points = uint.MaxValue, PrimaryKind = 3, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 },
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            yield return Check("Campaign result", () => views.Render(AppPage.Result));
            yield return Check("Identity page", () => views.RenderPanel(new PanelPageView { Key = "Largest", Title = "Largest", Tab = AppPage.Home, Blocks = new[] {
                PanelBlock.Card("Balance", PanelBlock.Figure("Balance", "Confirmed balance", Max, "Kredits", SkinSlots.IconKredit)),
                PanelBlock.Card("Position", PanelBlock.Split("Position", "Your position", "#" + uint.MaxValue.ToString("N0", CultureInfo.InvariantCulture), MaxSol)),
                PanelBlock.Card("Ladder", PanelBlock.Split("Ladder", null, Max, "Prism", SkinSlots.LadderBadge(4))),
                PanelBlock.Card("Rows", PanelBlock.Row("Deposit", "Deposit", MaxSol), PanelBlock.Row("Best", "Best paid place", "#" + uint.MaxValue)),
                PanelBlock.Pair(new PageAction { Label = "Score" }, new PageAction { Label = "Clears leaving three rows or fewer on the board in one single move, twice over", Short = "Objective" }, 0),
                PanelBlock.Card("Device", new PanelBlock { Kind = PanelKind.Text, Name = "Device status", Copy = "Session active",
                    Token = SkinTokens.Positive, Action = new PageAction { Label = "Manage" } }),
                PanelBlock.Button(new PageAction { Label = "Wear the automatic emblem" }, false),
                PanelBlock.Button(new PageAction { Label = "Buy 25 Kredits · 0.25 SOL" }, true),
                PanelBlock.Button(new PageAction { Label = "Try connecting again" }, false) } }));
            Assert.That(PageText.Visible(root.transform).Select(text => text.text), Has.Member("Objective"), "A pill too narrow for its words takes its shorter ones");
        }

        [Test] public void LargeFiguresAbbreviateOnTheShortScale()
        {
            Assert.That(NumberFit.Abbreviate("9,007,199,254,740,993"), Is.EqualTo("9.0Qa"));
            Assert.That(NumberFit.Abbreviate(Max), Is.EqualTo("18.4Qi"));
            Assert.That(NumberFit.Abbreviate(MaxSol), Is.EqualTo("18.4B SOL"));
            Assert.That(NumberFit.Abbreviate("#1 · 999"), Is.EqualTo("#1 · 999"));
            Assert.That(NumberFit.Abbreviate("1,840"), Is.EqualTo("1.8K"));
            // A count in running text keeps its figures up to seven digits.
            Assert.That(NumberFit.Figure(9_999_999), Is.EqualTo("9,999,999"));
            Assert.That(NumberFit.Figure(10_000_000), Is.EqualTo("10.0M"));
            Assert.That(NumberFit.Figure(9007199254740993), Is.EqualTo("9.0Qa"));
        }

        // The Arena profile's panel at both phones, with no ladder points yet
        // and with a large figure: under the name stands the figure alone, led
        // by its tier's badge, on one line inside the card and clear of Records.
        [UnityTest] public IEnumerator TheLadderFigureFitsThePanelAtBothPhonesFromZeroToALargeFigure()
        {
            root = new GameObject("Ladder figure");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Ladder figure");
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Largest();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Arena", "arena", 1);
            foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Compact, "compact"), (Phones.Seeker, "seeker") })
                foreach (ulong points in new[] { 0UL, 987654321012UL })
                {
                    phone(shell, 1); source.Ladder = points;
                    views.Render(AppPage.Settings); yield return null;
                    views.Render(AppPage.Profile); yield return null;
                    foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                    yield return null;
                    string at = points + " points on the " + size + " phone";
                    var figure = root.GetComponentsInChildren<TMPro.TMP_Text>().Single(text => text.name == "Ladder points");
                    figure.ForceMeshUpdate();
                    Assert.That(figure.text, Is.EqualTo(NumberFit.Figure(points)), at);
                    Assert.That(figure.textInfo.lineCount, Is.EqualTo(1), at + ": one line");
                    var images = root.GetComponentsInChildren<UnityEngine.UI.Image>();
                    var badge = images.Single(image => image.name == "Ladder badge");
                    Assert.That(badge.sprite.name, Does.StartWith(SkinSlots.LadderBadge(NativeEngine.LadderTier(points))), at + ": led by its tier's badge");
                    var card = SkinUi.ScreenRect(images.Single(image => image.name == "Wearer card").rectTransform);
                    var drawn = SkinUi.ScreenRect(figure.rectTransform); var lead = SkinUi.ScreenRect(badge.rectTransform);
                    var records = SkinUi.ScreenRect((RectTransform)root.GetComponentsInChildren<UnityEngine.UI.Button>().Single(button => button.name == "Records").transform);
                    Assert.That(lead.xMax, Is.LessThanOrEqualTo(drawn.xMin + .5f), at + ": the badge leads the figure");
                    Assert.That(card.Contains(lead.min) && card.Contains(new Vector2(drawn.xMax - .01f, drawn.yMax - .01f)), Is.True, at + ": inside the card");
                    Assert.That(drawn.xMax, Is.LessThanOrEqualTo(records.xMin + .5f), at + ": clear of Records");
                    Assert.That(root.GetComponentsInChildren<TMPro.TMP_Text>().Any(text => text.name == "Standing line" || text.name == "Worn"), Is.False, at + ": no words under the name");
                    yield return Captures.Snap(shell, "arena profile " + points + " points " + size);
                }
            Phones.Clear(shell);
        }
    }
}
