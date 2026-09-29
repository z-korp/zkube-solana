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
    // shrinks, then abbreviates, never wraps.
    public sealed class PageNumberTests
    {
        private sealed class Largest : IAppPageSource
        {
            public byte Kind, Value;
            public CampaignPageView CampaignView() => new CampaignPageView { Realm = 1, Stars = int.MaxValue,
                Trials = Enumerable.Range(1, 10).Select(level => new CampaignTrialView { Level = (byte)level, Stars = 3, Available = true }).ToArray() };
            public CampaignSummaryView CampaignSummary() => new CampaignSummaryView { Realm = 1, Stars = int.MaxValue, Cleared = int.MaxValue, Levels = 10,
                Open = new PageAction { Label = "Explore map" } };
            public LevelPageView LevelPage() => new LevelPageView { Realm = 1, Level = 3, Stars = 3, Moves = uint.MaxValue,
                Goals = new CampaignGoals { Points = uint.MaxValue, PrimaryKind = 3, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 },
                Play = new PageAction { Label = "Play" }, Back = new PageAction { Label = "Back to map" } };
            public DailyPageView Daily;
            public DailyPageView DailyPage() => Daily;
            public ProfilePageView ProfilePage() => new ProfilePageView { Name = "Player", Realm = 1, Emblem = 1, Tier = 4, Stars = int.MaxValue,
                Streak = ulong.MaxValue, BestDailyScore = ulong.MaxValue, Standing = "Mako · Prism · " + Max + " ladder points",
                ChooseBorder = new PageAction { Label = "Choose a border" } };
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
            shell.Frame = new Rect(0, 0, 360, 640);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            Assert.That(shell.ArtworkError, Is.Null);
            var daily = NativeEngine.Daily(20705);
            var source = new Largest();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Daily", "realms", 1.3f);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            var numbers = shell.Artwork.Font(SkinUi.Type.Number);
            long now = 20705L * 86400;
            IEnumerator Check(string page, Action draw)
            {
                draw(); yield return null;
                foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return null;
                PageText.AssertNumbersOnOneLine(root.transform, numbers, page);
            }
            source.Daily = new DailyPageView { Day = 20705, Realm = 1, ObjectiveKind = daily.Kind, ObjectiveValue = daily.Value, Now = () => now,
                ClosesAt = now + 3600, NextOpensAt = now + 3600, Score = ulong.MaxValue, ObjectiveTotal = ulong.MaxValue,
                Actions = new[] { new PageAction { Label = "View result" } } };
            yield return Check("Used Daily", () => views.Render(AppPage.Daily));
            source.Daily = new DailyPageView { Day = 20705, Realm = 1, ObjectiveKind = daily.Kind, ObjectiveValue = daily.Value, Now = () => now,
                ClosesAt = now + 3600, Arcade = new ArcadeView { Pot = MaxSol, Closes = "Closes 23:59 UTC" },
                Actions = new[] { new PageAction { Label = "Enter · 1 Kredit" } },
                Blocks = new[] { PanelBlock.Card("Last run", PanelBlock.Row("Last score", "Score", Max), PanelBlock.Row("Last objective", "Objective", Max)),
                    PanelBlock.Text("Kredit balance", Max + " confirmed Kredits", 14) } };
            yield return Check("Arcade", () => views.Render(AppPage.Daily));
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
            yield return Check("Identity page", () => views.RenderPanel(new PanelPageView { Key = "Largest", Title = "Largest", Tab = 1, Blocks = new[] {
                PanelBlock.Card("Balance", PanelBlock.Figure("Balance", "Confirmed balance", Max, 48, "Kredits", SkinSlots.IconKredit)),
                PanelBlock.Card("Position", PanelBlock.Split("Position", "Your position", "#" + uint.MaxValue.ToString("N0", CultureInfo.InvariantCulture), 33, MaxSol)),
                PanelBlock.Card("Ladder", PanelBlock.Split("Ladder", null, Max, 36, "Prism", SkinSlots.LadderBadge(4))),
                PanelBlock.Card("Rows", PanelBlock.Row("Fee allowance", "Fee allowance", MaxSol), PanelBlock.Row("Best", "Best paid place", "#" + uint.MaxValue)) } }));
        }

        [Test] public void LargeFiguresAbbreviateOnTheShortScale()
        {
            Assert.That(NumberFit.Abbreviate("9,007,199,254,740,993"), Is.EqualTo("9.0Qa"));
            Assert.That(NumberFit.Abbreviate(Max), Is.EqualTo("18.4Qi"));
            Assert.That(NumberFit.Abbreviate(MaxSol), Is.EqualTo("18.4B SOL"));
            Assert.That(NumberFit.Abbreviate("#1 · 999"), Is.EqualTo("#1 · 999"));
            Assert.That(NumberFit.Abbreviate("1,840"), Is.EqualTo("1.8K"));
        }
    }
}
