using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
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
    // The v3 wireframes are the layout target (DECISIONS 2026-10-01). Each page is
    // drawn on the wireframe's own Seeker frame (400 x 890 dp, its safe area 47 dp
    // down) with the wireframe's content, and its main pieces (cards, title, the
    // buttons, the guardian, the tabs, the crown, the lockup) are compared with
    // the rects the wireframe draws, read from ux/screens-v3.html into
    // wireframe-geometry.json. Every card is centred with equal gutters.
    public sealed class WireframeGeometryTests
    {
        // Every lesson is taught: these pages are measured without a lesson over them.
        [SetUp] public void TaughtEveryLesson() => Lessons.Device = Lessons.Memory(taught: true);
        public const float Tolerance = 4;
        private sealed class Wireframe : IAppPageSource
        {
            public LevelPageView Level = new LevelPageView { Realm = 1, Level = 1, Moves = 16,
                Goals = new CampaignGoals { Points = 10, PrimaryKind = 3, PrimaryValue = 0, PrimaryCount = 6, SecondaryKind = 9, SecondaryValue = 2, SecondaryCount = 1 },
                Play = new PageAction { Label = "Play" }, Back = new PageAction { Label = "Back to map", Name = "Back to map" } };
            public CampaignPageView CampaignView() => new CampaignPageView { Realm = 1, Stars = 6,
                Previous = new PageAction { Label = "Previous", Name = "Previous" }, Next = new PageAction { Label = "Next", Name = "Next", Enabled = false },
                Trials = Enumerable.Range(1, 10).Select(level => new CampaignTrialView { Level = (byte)level, Stars = (byte)(level <= 3 ? 4 - level : 0),
                    Available = level <= 4 }).ToArray() };
            public CampaignSummaryView CampaignSummary() => new CampaignSummaryView { Realm = 2, Stars = 6, Levels = 10,
                Trials = Enumerable.Range(1, 10).Select(level => new CampaignTrialView { Level = (byte)level, Stars = (byte)(level < 4 ? 2 : 0), Available = level <= 4 }).ToArray(),
                Map = new PageAction { Label = "Explore map" } };
            public LevelPageView LevelPage() => Level;
            public DailyPageView Daily;
            public DailyPageView DailyPage() => Daily;
            public ProfilePageView ProfilePage() => new ProfilePageView { Name = "Player", Realm = 1, Emblem = 1, Worn = "Wearing Mako’s emblem", Stars = 3,
                Streak = 1, BestDailyScore = 1240,
                Emblems = ProfileEmblems.All.Where(emblem => emblem.Id != 0).Select(emblem => new ProfileChoiceView { Id = emblem.Id, Realm = emblem.Realm,
                    Name = emblem.Name, Detail = emblem.Id == 1 ? "Worn" : null, Available = emblem.Id <= 3 }).ToArray() };
            public SettingsPageView SettingsPage()
            {
                var settings = AppPreferences.Read(() => { });
                settings.Music = .2; settings.Effects = .4; settings.Muted = false;
                settings.Identity = new[] { PanelBlock.Button(new PageAction { Label = "Restore purchases" }, false, icon: SkinSlots.IconRetry) };
                return settings;
            }
            public ResultPageView Result;
            public ResultPageView ResultPage() => Result;
            public bool CanNavigate(AppPage page) => true;
            public void Navigate(AppPage page) { }
            public void Report(Exception error) => throw error;
        }

        private GameObject root;
        [UnityTearDown] public IEnumerator TearDown() { if (root != null) UnityEngine.Object.Destroy(root); yield return null; }

        public static JObject Expected() =>
            (JObject)JObject.Parse(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Tests/PlayMode/Presentation/wireframe-geometry.json")))["screens"];

        // The page's main pieces in the wireframe's coordinates: dp from the top left of screen.
        public static Dictionary<string, List<Rect>> Pieces(Component at, Rect screen, float density)
        {
            Rect Dp(RectTransform transform)
            {
                var r = SkinUi.ScreenRect(transform);
                return new Rect((r.x - screen.x) / density, (screen.yMax - r.yMax) / density, r.width / density, r.height / density);
            }
            string Slot(Image image) => image.sprite == null ? "" : image.sprite.name.Replace("(Clone)", "");
            var images = at.GetComponentsInChildren<Image>().Where(image => image.enabled && image.gameObject.activeInHierarchy).ToArray();
            List<Rect> Where(Func<Image, bool> role) => images.Where(role).Select(image => Dp(image.rectTransform)).ToList();
            return new Dictionary<string, List<Rect>> {
                ["cards"] = Where(image => Slot(image) == SkinSlots.Card && !image.name.EndsWith(" tile")),
                ["stats"] = Where(image => Slot(image) == SkinSlots.Card && image.name.EndsWith(" tile")),
                ["primaries"] = Where(image => Slot(image) == SkinSlots.ButtonPrimary),
                ["secondaries"] = Where(image => Slot(image) == SkinSlots.ButtonSecondary),
                ["quiet"] = Where(image => image.transform.Find(image.name + " rim") != null),
                ["titles"] = Where(image => image.name == "Screen title plate"),
                ["guardians"] = Where(image => image.name == "Screen guardian" || image.name.EndsWith("talk guardian")),
                ["crowns"] = Where(image => image.name == "Star crown"),
                ["lockup"] = Where(image => image.name == "Wordmark"),
                ["talk"] = Where(image => image.GetComponent<GuardianTalk>() != null),
                ["tabs"] = at.GetComponentsInChildren<SkinTabBar>().Select(bar => Dp((RectTransform)bar.transform)).ToList(),
            };
        }

        // With ZKUBE_CAPTURES set, writes the pages' pieces there as geometry.json, to set beside the wireframe's.
        private static readonly JObject dump = new JObject();
        public static void Dump(string page, Dictionary<string, List<Rect>> pieces)
        {
            string folder = Environment.GetEnvironmentVariable("ZKUBE_CAPTURES");
            if (string.IsNullOrEmpty(folder)) return;
            Directory.CreateDirectory(folder); string file = Path.Combine(folder, "geometry.json");
            dump[page] = JObject.FromObject(pieces.ToDictionary(pair => pair.Key, pair => pair.Value.Select(r => new[] {
                Math.Round(r.x, 1), Math.Round(r.y, 1), Math.Round(r.width, 1), Math.Round(r.height, 1) }).ToArray()));
            File.WriteAllText(file, dump.ToString());
        }

        // How far a guardian's canvas top stands over what it leans on: the
        // wireframe draws the rail at .833 of the canvas, a guardian's art at its own.
        private const float WireframeRail = .833f;
        public static float GuardianRail = WireframeRail;
        // Holds a page's pieces to the wireframe's, within Tolerance dp. A title
        // is its plate less the plate's 6u outset above and below; a guardian is
        // its canvas's left, top and width (the wireframe's box stops at the
        // rail); a talk box is held by its bottom, and its guardian by where it
        // stands on the box's top; a button row wider than the wireframe's column is compared on
        // its height alone, and a quiet button on its centre. Every card sits
        // between equal gutters. An overlay page (the greeting) holds only its
        // own pieces.
        public static void Match(string page, Dictionary<string, List<Rect>> got, Rect screen, float u, params string[] only)
        {
            var expected = (JObject)Expected()[page]["seeker"];
            float width = screen.width;
            var roles = only.Length != 0 ? only : new[] { "lockup", "titles", "crowns", "guardians", "cards", "stats", "primaries", "quiet", "tabs", "talk" };
            foreach (var role in roles)
            {
                var want = ((JArray)expected[role]).Select(r => new Rect((float)r[0], (float)r[1], (float)r[2], (float)r[3])).OrderBy(r => r.y).ThenBy(r => r.x).ToList();
                var have = got[role].OrderBy(r => r.y).ThenBy(r => r.x).ToList();
                Assert.AreEqual(want.Count, have.Count, page + ": " + role + " " + string.Join(" ", have));
                for (int i = 0; i < want.Count; i++)
                {
                    Rect w = want[i], h = have[i];
                    string at = page + ": " + role + " " + i + " is " + h + ", the wireframe's " + w;
                    void Near(float a, float b, string what) => Assert.AreEqual(a, b, Tolerance, at + " (" + what + ")");
                    if (role == "titles") { h = new Rect(h.x, h.y + ScreenKit.PlateOutsetU * u, h.width, h.height - 2 * ScreenKit.PlateOutsetU * u); Near(w.center.x, h.center.x, "centre"); }
                    else if (role == "quiet") Near(w.center.x, h.center.x, "centre");
                    else if (role == "primaries" && (w.xMin < 12 || w.xMax > width - 12)) { }
                    else { Near(w.x, h.x, "left"); Near(w.width, h.width, "width"); }
                    // The talk box grows upward from its bottom with its page's words, and its guardian stands on its top.
                    if (role == "talk") { Near(w.yMax, h.yMax, "bottom"); continue; }
                    if (role == "guardians" && expected["talk"].HasValues)
                    {
                        Near(WireframeRail * w.width, (float)expected["talk"][0][1] - w.y, "the wireframe's stand");
                        Near(GuardianRail * h.width, got["talk"][0].y - h.y, "stand");
                        continue;
                    }
                    // A page's top hangs TopClearDp and the plate's outset under the
                    // safe top (DECISIONS 2026-10-02: nothing is cropped by the screen
                    // top), so a piece may sit up to that much under the wireframe's.
                    float lowered = ScreenKit.TopClearDp + ScreenKit.PlateOutsetU * u;
                    Assert.That(h.y, Is.InRange(w.y - Tolerance, w.y + lowered + Tolerance), at + " (top)");
                    // The Daily card's objective line holds its pictogram left of its caption
                    // (DECISIONS 2026-10-02), which makes the card that row taller than the wireframe's.
                    if (role == "cards" && i == 0 && page == "home")
                        Assert.That(h.height, Is.InRange(w.height - Tolerance, w.height + 12 * u + Tolerance), at + " (height)");
                    else if (role != "guardians") Near(w.height, h.height, "height");
                }
            }
            // Cards side by side (the Kredit packs) share their row's gutters.
            foreach (var row in got["cards"].GroupBy(card => Mathf.Round(card.y)))
                Assert.AreEqual(row.Min(card => card.xMin), width - row.Max(card => card.xMax), .5f, page + ": the cards at " + row.Key + " sit between equal gutters");
        }
        [UnityTest] public IEnumerator EveryRealmsPageMatchesItsWireframeAtSeekerSize()
        {
            root = new GameObject("Wireframe pages");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Wireframe pages");
            Phones.WireframeSeeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            long now = 20705L * 86400 + 6 * 3600 + 58 * 60 + 25;
            IEnumerator Page(string page, Action draw)
            {
                draw(); yield return null;
                foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                Canvas.ForceUpdateCanvases();
                var pieces = Pieces(root.transform, shell.ScreenArea, 1);
                Dump(page, pieces);
                yield return Captures.Snap(shell, "wireframe " + page);
                GuardianRail = shell.Artwork.GuardianRailY;
                if (page.StartsWith("greet")) Match(page, pieces, shell.ScreenArea, 1.1f, "guardians", "talk");
                // The platform account names the player (DECISIONS 2026-10-02): the wireframe's quiet button is gone.
                else if (page == "profile") Match(page, pieces, shell.ScreenArea, 1.1f, "titles", "cards", "stats", "tabs");
                // The owner (2026-10-03) over the wireframe: on a level's preview and the results the
                // guardian is the hero, grown into the free room under a smaller title, so only their
                // actions and tabs keep the wireframe's places.
                else if (page == "preview" || page.StartsWith("res") || page == "dres") Match(page, pieces, shell.ScreenArea, 1.1f, "primaries", "quiet", "tabs");
                else Match(page, pieces, shell.ScreenArea, 1.1f);
            }
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Play today" } } };
            yield return Page("home", () => views.Render(AppPage.Home));
            AssertButtonKinds(root.transform, "home", new string[0], new[] { "Play level*" });
            // The four tabs draw four distinct pictures, Home first.
            var tabIcons = root.GetComponentsInChildren<SkinTabBar>().Single().GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" icon"))
                .Select(image => image.sprite.name.Replace("(Clone)", "")).ToArray();
            Assert.AreEqual(new[] { SkinSlots.IconHome, SkinSlots.IconCampaign, SkinSlots.IconProfile, SkinSlots.IconSettings }, tabIcons,
                "The tabs wear the house, the map, the person and the gear");
            Assert.AreEqual(new[] { "Home", "Campaign", "Profile", "Settings" }, root.GetComponentsInChildren<SkinTabBar>().Single().GetComponentsInChildren<TMP_Text>()
                .Select(label => label.text).ToArray(), "The tabs are Home, Campaign, Profile and Settings");
            yield return Page("preview", () => views.Render(AppPage.Level));
            yield return Page("map", () => views.Render(AppPage.Campaign));
            foreach (var (page, stars, reason, moves) in new[] { ("res3", 7, 1, 3u), ("res2", 3, 2, 0u), ("res1", 4, 2, 0u), ("res0", 0, 2, 0u), ("resEnded", 0, 3, 5u) })
            {
                source.Result = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1,
                    Level = 1, Score = stars == 7 ? 24u : 14u, StarSources = (byte)stars, EndReason = (byte)reason, MovesLeft = moves, PrimaryProgress = 6,
                    Goals = source.Level.Goals, NewBest = stars == 7, NextOpen = false,
                    Done = new PageAction { Label = stars == 0 ? "Map" : "Continue" }, Retry = new PageAction { Label = "Retry" } };
                yield return Page(page, () => views.Render(AppPage.Result));
                if (page != "res3") AssertButtonKinds(root.transform, page, new[] { stars == 0 ? "Map" : "Retry" }, new string[0]);
            }
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20704,
                ObjectiveKind = 2, ObjectiveValue = 2, Score = 3480, ObjectiveTotal = 9, Streak = 3, Tier = 2, NewBest = true, NextOpensAt = 20705L * 86400,
                Now = () => 20705L * 86400 - 7 * 3600 - 42 * 60 - 10, Done = new PageAction { Label = "Continue" }, Share = (text, token) => System.Threading.Tasks.Task.FromResult(true) };
            yield return Page("dres", () => views.Render(AppPage.Result));
            AssertButtonKinds(root.transform, "dres", new[] { "Share" }, new string[0]);
            yield return Page("profile", () => views.Render(AppPage.Profile));
            yield return Page("settings", () => views.Render(AppPage.Settings));
            AssertButtonKinds(root.transform, "settings", new string[0], new[] { "Restore purchases" });
            greeted = 0;
            yield return Page("greet", () => { views.Render(AppPage.Campaign); root.GetComponentInChildren<GuardianTalk>().Complete(); });
            yield return Page("greetRule", () => root.GetComponentInChildren<GuardianTalk>().Tap());
            Phones.Clear(shell);
        }

        // No Realms page scrolls on the emulator's default phone or the Seeker:
        // each page's column ends inside its body (DECISIONS 2026-10-01), and
        // the Daily card holds its own pieces in every state.
        [UnityTest] public IEnumerator NoRealmsPageScrollsAtTheEmulatorDefaultOrTheSeeker()
        {
            root = new GameObject("Unscrolled pages");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Unscrolled pages");
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            long now = 20705L * 86400 + 6 * 3600;
            var daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Play today" } } };
            var arcade = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Enter · 1 Kredit" } }, Arcade = ArenaLanding.View(claims: "2 to claim") };
            var campaign = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals, NewBest = true, NextOpen = false,
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            var dailyResult = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20704,
                ObjectiveKind = 2, ObjectiveValue = 2, Score = 3480, ObjectiveTotal = 9, Streak = 3, Tier = 2, NewBest = true, NextOpensAt = 20705L * 86400,
                Now = () => 20705L * 86400 - 7 * 3600, Done = new PageAction { Label = "Continue" }, Share = (text, token) => System.Threading.Tasks.Task.FromResult(true) };
            var used = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, NextOpensAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "View result" } } };
            var pages = new (string name, Action draw)[] {
                ("home", () => { source.Daily = daily; views.Render(AppPage.Home); }),
                ("home with the attempt used", () => { source.Daily = used; views.Render(AppPage.Home); }),
                ("arcade", () => { source.Daily = arcade; views.Render(AppPage.Home); }),
                ("preview", () => views.Render(AppPage.Level)),
                ("map", () => views.Render(AppPage.Campaign)),
                ("result", () => { source.Result = campaign; views.Render(AppPage.Result); }),
                ("daily result", () => { source.Result = dailyResult; views.Render(AppPage.Result); }),
                ("profile", () => views.Render(AppPage.Profile)),
                ("settings", () => views.Render(AppPage.Settings)) };
            foreach (var (phone, use) in new (string, Action)[] { ("emulator default", () => Phones.EmulatorDefault(shell)), ("Seeker", () => Phones.Seeker(shell)) })
            {
                use();
                foreach (var (name, draw) in pages)
                {
                    draw(); yield return null;
                    foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                    Canvas.ForceUpdateCanvases();
                    yield return Captures.Snap(shell, "unscrolled " + phone + " " + name);
                    Assert.LessOrEqual(shell.Scroll.content.rect.height, shell.Viewport.rect.height + .5f, phone + " " + name + " fits without scrolling");
                    // The Daily card holds all of its own pieces.
                    var card = root.GetComponentsInChildren<Image>().FirstOrDefault(image => image.name == "Daily card");
                    if (card == null) continue;
                    var inside = SkinUi.ScreenRect(card.rectTransform);
                    foreach (var piece in root.GetComponentsInChildren<Graphic>().Where(graphic => graphic != card &&
                        (graphic.name.StartsWith("Daily ") || graphic.name.StartsWith("Next Daily"))))
                    {
                        var rect = SkinUi.ScreenRect(piece.rectTransform);
                        Assert.IsTrue(rect.xMin >= inside.xMin - .5f && rect.xMax <= inside.xMax + .5f && rect.yMin >= inside.yMin - .5f && rect.yMax <= inside.yMax + .5f,
                            phone + " " + name + ": " + piece.name + " " + rect + " stays inside the Daily card " + inside);
                    }
                }
            }
            Phones.Clear(shell);
        }

        // A page redrawn or replaced in place ends its entrance with it: a
        // result's stars stop moving once another page is drawn over it.
        [UnityTest] public IEnumerator APagesEntranceEndsWhenThePageIsReplacedInPlace()
        {
            root = new GameObject("Replaced entrance");
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Replaced entrance");
            Phones.Seeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Actions = new[] { new PageAction { Label = "Play today" } } };
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Campaign", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals,
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            bool reduced = AppPreferences.ReducedMotion; AppPreferences.SetReducedMotion(false);
            try
            {
                foreach (var next in new[] { AppPage.Result, AppPage.Home })
                {
                    views.Render(AppPage.Result); yield return null;
                    Assert.IsTrue(root.GetComponentsInChildren<PageSequence>().Any(sequence => sequence.Playing), "The result's stars are arriving");
                    views.Render(next);
                    // Any step still running on the old page's pieces would throw here.
                    for (float end = Time.realtimeSinceStartup + .6f; Time.realtimeSinceStartup < end;) yield return null;
                }
                Assert.IsFalse(root.GetComponentsInChildren<PageSequence>().Any(sequence => sequence.Playing), "Home has no entrance of the result's left running");
            }
            finally { AppPreferences.SetReducedMotion(reduced); Phones.Clear(shell); }
        }

        // Nothing a page draws is cropped by the screen top (DECISIONS
        // 2026-10-02): on the compact phone, the emulator's default and the
        // Seeker, every piece of every page, its title plate and header card
        // first, ends at least ScreenKit.TopClearDp under the safe top. Only the
        // painting, its veils and the lights placed over it reach past.
        [UnityTest] public IEnumerator NoPageDrawsIntoTheScreenTopOnAnyPhone()
        {
            root = new GameObject("Top edges");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Top edges");
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            long now = 20705L * 86400 + 6 * 3600;
            var daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Play today" } } };
            var arcade = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Enter · 1 Kredit" } }, Arcade = ArenaLanding.View() };
            var campaign = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals, NewBest = true, NextOpen = false,
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            var dailyResult = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20704,
                ObjectiveKind = 2, ObjectiveValue = 2, Score = 3480, ObjectiveTotal = 9, Streak = 3, Tier = 2, NewBest = true, NextOpensAt = 20705L * 86400,
                Now = () => 20705L * 86400 - 7 * 3600, Done = new PageAction { Label = "Continue" } };
            var panel = new PanelPageView { Key = "Kredits", Title = "Kredits", Subtitle = "One Kredit enters one Daily", Tab = AppPage.Home,
                Back = new PageAction { Label = "Back", Name = "Back" }, Blocks = new[] { PanelBlock.Card("Balance card", PanelBlock.Figure("Balance", "Kredits", "3")) } };
            var pages = new (string name, Action draw)[] {
                ("home", () => { source.Daily = daily; views.Render(AppPage.Home); }),
                ("arcade", () => { source.Daily = arcade; views.Render(AppPage.Home); }),
                ("preview", () => views.Render(AppPage.Level)),
                ("map", () => views.Render(AppPage.Campaign)),
                ("result", () => { source.Result = campaign; views.Render(AppPage.Result); }),
                ("daily result", () => { source.Result = dailyResult; views.Render(AppPage.Result); }),
                ("profile", () => views.Render(AppPage.Profile)),
                ("settings", () => views.Render(AppPage.Settings)),
                ("titled panel", () => views.RenderPanel(panel)),
                ("greeting", () => { greeted = 0; views.Render(AppPage.Campaign); greeted = ~0; }) };
            foreach (var (phone, use) in new (string, Action)[] { ("compact", () => Phones.Compact(shell)), ("emulator default", () => Phones.EmulatorDefault(shell)),
                ("Seeker", () => Phones.Seeker(shell)) })
            {
                use();
                foreach (var (name, draw) in pages)
                {
                    draw(); yield return null;
                    foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                    Canvas.ForceUpdateCanvases();
                    yield return Captures.Snap(shell, "top " + phone + " " + name);
                    var screen = shell.ScreenArea; float edge = shell.SafeArea.yMax - ScreenKit.TopClearDp;
                    bool Backdrop(Graphic graphic)
                    {
                        if (graphic == shell.Background || graphic == shell.Veil || graphic == shell.Scrim) return true;
                        // The map path's rect maps its authored points; only its strokes, inside the room, are ink.
                        if (graphic is CampaignPathGraphic) return true;
                        var rect = SkinUi.ScreenRect(graphic.rectTransform);
                        if (rect.width >= screen.width - .5f && rect.height >= shell.SafeArea.height - .5f) return true;
                        return graphic is Image image && image.sprite != null && image.sprite.name.StartsWith("fx-");
                    }
                    foreach (var graphic in root.GetComponentsInChildren<Graphic>().Where(graphic => graphic.enabled && graphic.gameObject.activeInHierarchy &&
                        graphic.color.a > 0 && !Backdrop(graphic)))
                    {
                        var rect = SkinUi.ScreenRect(graphic.rectTransform);
                        if (graphic is TMP_Text text)
                        {
                            if (string.IsNullOrEmpty(text.text)) continue;
                            text.ForceMeshUpdate();
                            var bounds = text.textBounds;
                            rect = new Rect(rect.x, rect.y + bounds.min.y, rect.width, bounds.size.y);
                        }
                        Assert.LessOrEqual(rect.yMax, edge + .5f, phone + " " + name + ": " + graphic.name + " " + rect + " stays " + ScreenKit.TopClearDp +
                            " dp under the safe top " + shell.SafeArea.yMax);
                    }
                }
            }
            Phones.Clear(shell);
        }

        // A page's notices and errors sit at its bottom (DECISIONS 2026-10-02):
        // over the tab bar on a tab page, over the foot buttons on the others,
        // on every page at the three phone sizes, and never under the tab bar.
        [UnityTest] public IEnumerator NoticesSitAtTheBottomAboveTheTabBar()
        {
            root = new GameObject("Bottom notices");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Bottom notices");
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            long now = 20705L * 86400 + 6 * 3600;
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Play today" } } };
            var campaign = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 24, StarSources = 3, EndReason = 2, MovesLeft = 0, PrimaryProgress = 6, Goals = source.Level.Goals, NextOpen = false,
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            var panel = new PanelPageView { Key = "Kredits", Title = "Kredits", Tab = AppPage.Home, Back = new PageAction { Label = "Back", Name = "Back" },
                Blocks = new[] { PanelBlock.Card("Balance card", PanelBlock.Figure("Balance", "Kredits", "3")) } };
            const string notice = "The store could not be reached.";
            var notices = new[] { notice };
            var pages = new (string name, bool tabs, Action draw)[] {
                ("home", true, () => views.Render(AppPage.Home, notices)),
                ("map", true, () => views.Render(AppPage.Campaign, notices)),
                ("profile", true, () => views.Render(AppPage.Profile, notices)),
                ("settings", true, () => views.Render(AppPage.Settings, notices)),
                ("titled panel", true, () => views.RenderPanel(panel, notices)),
                ("preview", false, () => views.Render(AppPage.Level, notices)),
                ("result", false, () => { source.Result = campaign; views.Render(AppPage.Result, notices); }) };
            foreach (var (phone, use) in new (string, Action)[] { ("compact", () => Phones.Compact(shell)), ("emulator default", () => Phones.EmulatorDefault(shell)),
                ("Seeker", () => Phones.Seeker(shell)) })
            {
                use();
                foreach (var (name, tabs, draw) in pages)
                {
                    draw(); yield return null;
                    foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                    Canvas.ForceUpdateCanvases();
                    yield return Captures.Snap(shell, "notice " + phone + " " + name);
                    string at = phone + " " + name;
                    var shown = root.GetComponentsInChildren<TMP_Text>().Where(text => text.text == notice && text.gameObject.activeInHierarchy).ToArray();
                    Assert.AreEqual(1, shown.Length, at + " shows its notice once");
                    var rect = SkinUi.ScreenRect(shown[0].rectTransform); var safe = shell.SafeArea;
                    Assert.Less(rect.center.y, safe.center.y, at + ": the notice " + rect + " is in the bottom half of " + safe);
                    float floor = tabs ? SkinUi.ScreenRect((RectTransform)root.GetComponentInChildren<SkinTabBar>().transform).yMax : safe.yMin;
                    Assert.GreaterOrEqual(rect.yMin, floor - .5f, at + ": the notice stays over the tab bar");
                    // Nothing but the page's foot (its buttons) and the tab bar lies under it.
                    foreach (var card in root.GetComponentsInChildren<Image>().Where(image => image.sprite != null && image.sprite.name.Replace("(Clone)", "") == SkinSlots.Card &&
                        !SkinUi.ScreenRect(image.rectTransform).Contains(rect.center)))
                        Assert.GreaterOrEqual(SkinUi.ScreenRect(card.rectTransform).yMin, rect.yMax - .5f, at + ": " + card.name + " sits above the notice");
                }
            }
            Phones.Clear(shell);
        }

        // The map tells its nodes apart (DECISIONS 2026-10-02): locked, open,
        // current and done, in the tier of its stars, each wear the realm's own piece, the current one
        // pulses (and holds still under reduced motion), and the guardian is
        // the boss: its own ring, nearly twice a node, in a breathing glow.
        [UnityTest] public IEnumerator TheMapTellsItsNodesApartAndItsGuardianIsTheBoss()
        {
            root = new GameObject("Map nodes");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Map nodes");
            Phones.Seeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var views = root.AddComponent<PageViews>(); views.Initialize(new Wireframe(), shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            bool reduced = AppPreferences.ReducedMotion;
            try
            {
                foreach (bool still in new[] { false, true })
                {
                    AppPreferences.SetReducedMotion(still);
                    views.Render(AppPage.Campaign); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                    Image Face(int level) => root.GetComponentsInChildren<Image>().Single(image => image.name == "Trial " + level + " node" || image.name == "Trial " + level + " ring");
                    string Slot(int level) => Face(level).sprite.name.Replace("(Clone)", "");
                    // The wireframe's map: levels 1-3 done, 4 open and current, 5-9 locked, 10 the guardian.
                    var art = shell.Artwork;
                    // A cleared node wears the tier of its stars: gold for three, silver for two, bronze for one.
                    foreach (var (level, slot) in new[] { (1, "map-node-done-3"), (2, "map-node-done-2"), (3, "map-node-done-1"), (4, SkinSlots.MapNodeCurrent),
                        (5, SkinSlots.MapNodeLocked), (9, SkinSlots.MapNodeLocked), (10, SkinSlots.MapNodeGuardian) })
                        Assert.AreEqual(art.SkinRealm(slot).name.Replace("(Clone)", ""), Slot(level), "Level " + level + " wears " + slot);
                    for (int stars = 1; stars <= 3; stars++)
                        Assert.AreNotEqual(art.SkinRealm(SkinSlots.MapNodeOpen), art.SkinRealm(PageViews.DoneNode(stars)), "Done is its own piece");
                    TMP_Text Number(int level) => root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Trial " + level + " number");
                    Assert.AreEqual(art.Token(SkinTokens.TextOnPrimary), Number(1).color, "A done node's number is dark on its light face");
                    Assert.AreEqual(art.Token(SkinTokens.Text), Number(4).color, "The current node's number keeps the light ink");
                    var pulse = Face(4).GetComponent<SkinPulse>();
                    Assert.IsNotNull(pulse, "The current node pulses");
                    Assert.IsTrue(root.GetComponentsInChildren<Image>().Where(image => image.name.StartsWith("Trial ") && image.name.EndsWith(" node"))
                        .Count(image => image.GetComponent<SkinPulse>() != null) == 1, "Only the current node pulses");
                    float least = 1;
                    for (float end = Time.realtimeSinceStartup + SkinPulse.Seconds; Time.realtimeSinceStartup < end;) { least = Mathf.Min(least, pulse.Scale); yield return null; }
                    if (still) Assert.AreEqual(1, least, "Reduced motion holds the current node still");
                    else Assert.Less(least, .95f, "The current node pulses");
                    Assert.IsNotNull(root.GetComponentsInChildren<Image>().Single(image => image.name == "Trial 4 glow").GetComponent<SkinGlow>(), "The current node keeps its light");
                    float node = SkinUi.ScreenRect(Face(5).rectTransform).width, boss = SkinUi.ScreenRect(Face(10).rectTransform).width;
                    Assert.GreaterOrEqual(boss / node, 1.85f, "The guardian is nearly twice a node");
                    var light = root.GetComponentsInChildren<Image>().Single(image => image.name == "Trial 10 light").GetComponent<SkinGlow>();
                    Assert.AreEqual(!still, light.Breathing, "The boss's glow breathes, except under reduced motion");
                    Assert.AreEqual(3, root.GetComponentsInChildren<Image>().Count(image => image.name.StartsWith("Trial 10 star ")), "The boss shows its stars");
                }
            }
            finally { AppPreferences.SetReducedMotion(reduced); Phones.Clear(shell); }
        }

        // The menu music plays under Home, Campaign (and a level's preview),
        // Profile, Settings and an identity page under a tab, at the player's
        // music level, from the catalog's menu-music slot; a result and the board
        // (the pages hidden) stop it.
        [UnityTest] public IEnumerator MenuMusicPlaysUnderTheTabPagesAndStopsForAResultAndTheBoard()
        {
            root = new GameObject("Menu music");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Menu music");
            Phones.Seeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Actions = new[] { new PageAction { Label = "Play today" } } };
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals,
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            var music = views.MenuMusic;
            Assert.IsFalse(music.isPlaying, "Nothing plays before a page is drawn");
            foreach (var page in new[] { AppPage.Home, AppPage.Campaign, AppPage.Level, AppPage.Profile, AppPage.Settings })
            {
                views.Render(page); yield return null;
                Assert.IsTrue(music.isPlaying, page + " plays the menu music");
                Assert.IsTrue(music.loop);
                Assert.AreEqual(.2f, music.volume, .001f, page + " plays it at the music level");
            }
            StringAssert.EndsWith("menu", PageCatalog.Load().menuMusicResource);
            Assert.AreEqual(Resources.Load<AudioClip>(PageCatalog.Load().menuMusicResource), music.clip, "The clip is the catalog's menu-music slot");
            views.RenderPanel(new PanelPageView { Key = "Kredits", Title = "Kredits", Tab = AppPage.Home, Blocks = new PanelBlock[0] }); yield return null;
            Assert.IsTrue(music.isPlaying, "An identity page under a tab keeps it");
            views.Render(AppPage.Result); yield return null;
            Assert.IsFalse(music.isPlaying, "A result stops it");
            views.Render(AppPage.Home); yield return null;
            Assert.IsTrue(music.isPlaying);
            views.Hide();
            Assert.IsFalse(music.isPlaying, "The board, with the pages hidden, stops it");
            Phones.Clear(shell);
        }

        // A guardian's speech bubble points at its mouth: on the preview and the
        // result, for every guardian at both phones, the tail's tip is within a
        // short way of the mouth the art records and never on the eyes.
        [UnityTest] public IEnumerator EveryGuardiansBubbleTailAimsAtItsMouthOnBothPhones()
        {
            root = new GameObject("Bubble tails");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Bubble tails");
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Seeker, "seeker"), (Phones.Compact, "compact") })
                for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                {
                    phone(shell, 1);
                    shell.RequestRealm(realm);
                    while (shell.Loading) yield return null;
                    Assert.That(shell.ArtworkError, Is.Null);
                    source.Level.Realm = realm;
                    source.Result = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = realm, Level = 1,
                        Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals, NewBest = true, NextOpen = false,
                        Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
                    foreach (var page in new[] { AppPage.Level, AppPage.Result })
                    {
                        views.Render(page); yield return null;
                        foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                        yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                        Canvas.ForceUpdateCanvases();
                        string at = size + ", realm " + realm + ", " + page;
                        var guardian = SkinUi.ScreenRect(root.GetComponentsInChildren<Image>().Single(image => image.name == "Screen guardian").rectTransform);
                        var body = SkinUi.ScreenRect(root.GetComponentsInChildren<Image>().Single(image => image.name == "Guardian bubble").rectTransform);
                        var tail = root.GetComponentsInChildren<Image>().Single(image => image.name == "Guardian bubble tail").rectTransform;
                        var tip = SkinUi.TailTip(tail);
                        Assert.That(tail.GetComponent<Image>().preserveAspect, Is.False, at + ": the tail is drawn to its tip");
                        Vector2 mouth = shell.Artwork.MouthIn(guardian); var eyes = shell.Artwork.EyesIn(guardian);
                        Assert.That(Vector2.Distance(tip, mouth), Is.LessThanOrEqualTo(.12f * guardian.width), at + ": the tail's tip " + tip + " is at the mouth " + mouth);
                        Assert.That(eyes.Contains(tip), Is.False, at + ": the tip is off the eyes");
                        // Its way from the bubble never crosses the eyes either.
                        Vector2 from = tail.TransformPoint(new Vector3(tail.rect.xMin, 0));
                        for (float t = 0; t <= 1; t += .05f) Assert.That(eyes.Contains(Vector2.Lerp(from, tip, t)), Is.False, at + ": the tail crosses the eyes");
                        Assert.That(body.Overlaps(shell.Artwork.FaceIn(guardian)), Is.False, at + ": the bubble stands off the face");
                        if (page == AppPage.Level) yield return Captures.Snap(shell, "bubble " + size + " realm " + realm.ToString("00"));
                    }
                }
        }

        // The guardian's paws hang below its rail, over the card it leans on. That
        // card keeps its top clear as deep as they hang, so on the preview and on
        // every result of both products (a Campaign result, a Realms Daily, an
        // Arena run's two boards), for every guardian at both phones, no word of
        // the card is under the paws.
        [UnityTest] public IEnumerator TheGuardiansPawsNeverCoverWhatTheirCardSaysOnBothPhones()
        {
            root = new GameObject("Paws over cards");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Paws over cards");
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Seeker, "seeker"), (Phones.Compact, "compact") })
                for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                {
                    phone(shell, 1);
                    shell.RequestRealm(realm);
                    while (shell.Loading) yield return null;
                    Assert.That(shell.ArtworkError, Is.Null);
                    source.Level.Realm = realm;
                    var campaign = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = realm, Level = 1,
                        Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals, NewBest = true, NextOpen = false,
                        Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
                    ResultPageView Daily(bool arcade) => new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = realm, Day = 20705,
                        ObjectiveKind = 1, ObjectiveValue = 3, Score = 1240, ObjectiveTotal = 7, Streak = 4, Tier = 3, Arcade = arcade,
                        Done = new PageAction { Label = arcade ? "Back to Arena" : "Continue" }, Leaderboard = new PageAction { Label = arcade ? "See boards" : "Leaderboard" } };
                    foreach (var (name, page, result) in new[] { ("preview", AppPage.Level, (ResultPageView)null), ("Campaign result", AppPage.Result, campaign),
                        ("Realms Daily result", AppPage.Result, Daily(false)), ("Arena run result", AppPage.Result, Daily(true)) })
                    {
                        if (result != null) source.Result = result;
                        views.Render(page); yield return null;
                        foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                        yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                        Canvas.ForceUpdateCanvases();
                        string at = size + ", realm " + realm + ", " + name;
                        var canvas = SkinUi.ScreenRect(root.GetComponentsInChildren<Image>().Single(image => image.name == "Screen guardian paws").rectTransform);
                        float pawsEnd = canvas.yMax - shell.Artwork.GuardianPawsY * canvas.height, railLine = canvas.yMax - shell.Artwork.GuardianRailY * canvas.height;
                        // The card the guardian leans on is the one whose top is its rail line.
                        var card = root.GetComponentsInChildren<Image>().Where(image => image.sprite != null && image.sprite.name.StartsWith(SkinSlots.Card))
                            .Select(image => SkinUi.ScreenRect(image.rectTransform)).Single(rect => Mathf.Abs(rect.yMax - railLine) < 1 && rect.Contains(new Vector2(canvas.center.x, railLine - 2)));
                        Assert.That(pawsEnd, Is.LessThan(railLine), at + ": the paws hang over the card");
                        int words = 0;
                        foreach (var text in root.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text)))
                        {
                            text.ForceMeshUpdate();
                            var ink = text.textBounds; if (ink.size.x <= 0) continue;
                            Vector2 low = text.transform.TransformPoint(ink.min), high = text.transform.TransformPoint(ink.max);
                            if (!card.Contains((low + high) / 2)) continue;
                            words++;
                            Assert.That(high.y, Is.LessThanOrEqualTo(pawsEnd + .5f), at + ": the paws reach " + pawsEnd + " and cover \"" + text.text + "\", whose top is at " + high.y);
                        }
                        Assert.That(words, Is.GreaterThan(0), at + ": the card says something");
                        if (realm == 5 || realm == 10) yield return Captures.Snap(shell, "paws " + size + " realm " + realm.ToString("00") + " " + name);
                    }
                }
            Phones.Clear(shell);
        }

        // One listener hears every source, whichever was made first and whatever
        // is on screen. The Arena makes its board under a page whose music is
        // playing, and that page then stops its music and leaves.
        [UnityTest] public IEnumerator OneListenerHearsThePagesAndABoardMadeUnderThem()
        {
            root = new GameObject("One listener");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("One listener");
            Phones.Seeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Actions = new[] { new PageAction { Label = "Play today" } } };
            Assert.AreEqual(1, PaintWatch.Listeners(), "Before any page");
            views.Render(AppPage.Home); yield return null;
            Assert.IsTrue(views.MenuMusic.isPlaying);
            Assert.AreEqual(1, PaintWatch.Listeners(), "Under a page playing its music");
            var board = new GameObject("Board made under a page", typeof(BoardController)).GetComponent<BoardController>();
            board.transform.SetParent(root.transform, false); yield return null;
            Assert.AreEqual(1, PaintWatch.Listeners(), "With a board made under that page");
            views.HandOver(board); yield return null;
            Assert.IsFalse(views.MenuMusic.isPlaying);
            Assert.AreEqual(1, PaintWatch.Listeners(), "On the board, the page's music stopped");
            views.Hide(); yield return null;
            Assert.AreEqual(1, PaintWatch.Listeners(), "On the board, the pages hidden");
            UnityEngine.Object.Destroy(board.gameObject); yield return null;
            Assert.AreEqual(1, PaintWatch.Listeners(), "After the board");
            Phones.Clear(shell);
        }

        // The Daily card shows the day's own guardian: its portrait, its name
        // and, on the Arcade, its realm all come from the Daily, in every realm,
        // whatever realm the page's painting is from.
        [UnityTest] public IEnumerator TheDailyCardsGuardianIsTheDaysOwnInEveryRealm()
        {
            root = new GameObject("Daily cards");
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Daily cards");
            Phones.WireframeSeeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            var catalog = PageCatalog.Load();
            foreach (bool arcade in new[] { false, true })
                for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                {
                    source.Daily = new DailyPageView { Day = 20705, Realm = realm, ObjectiveKind = 1, ObjectiveValue = 3,
                        Actions = new[] { new PageAction { Label = arcade ? "Enter · 1 Kredit" : "Play today" } },
                        Arcade = arcade ? ArenaLanding.View() : null };
                    views.Render(AppPage.Home);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                    var portrait = root.GetComponentsInChildren<Image>(true).Single(image => image.name == "Daily guardian");
                    for (float end = Time.realtimeSinceStartup + 10; !portrait.enabled && Time.realtimeSinceStartup < end;) yield return null;
                    var page = catalog.Realm(realm);
                    string at = (arcade ? "Arena" : "Home") + " for realm " + realm;
                    Assert.IsTrue(portrait.enabled, at + ": the portrait loads");
                    Assert.AreEqual(catalog.Portrait(realm).sprite, portrait.sprite.name.Replace("(Clone)", ""), at + ": the day's guardian's portrait");
                    Assert.AreEqual(arcade ? page.guardianName + " · " + page.realmName : page.guardianName,
                        root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Daily guardian name").text, at + ": the day's guardian and realm");
                }
        }

        // Every goal pictogram a page draws is SkinUi.Pictogram's: named "... pictogram", with its chip (the
        // HUD's own chip piece and signs) exactly when the catalog's goal, from pictograms.rs, gives one.
        public static void AssertPictograms(Component root, string page, IEnumerable<(string sprite, string chip)> goals)
        {
            var expected = new Dictionary<string, string>();
            foreach (var (sprite, chip) in goals)
            {
                if (expected.TryGetValue(sprite, out var known)) Assert.AreEqual(known, chip ?? "", page + ": two goals share " + sprite);
                expected[sprite] = chip ?? "";
            }
            int seen = 0;
            foreach (var image in root.GetComponentsInChildren<Image>().Where(image => image.sprite != null && image.sprite.name.StartsWith("goal-")))
            {
                string sprite = image.sprite.name.Replace("(Clone)", ""), at = page + ": " + image.name + " (" + sprite + ")";
                Assert.IsTrue(expected.ContainsKey(sprite), at + " is one of the page's goals");
                StringAssert.EndsWith(" pictogram", image.name, at + " is drawn by the pictogram builder");
                var chip = image.GetComponentsInChildren<Image>().FirstOrDefault(child => child != image && child.name.EndsWith(" chip"));
                if (expected[sprite] == "") { Assert.IsNull(chip, at + " has no chip"); continue; }
                Assert.IsNotNull(chip, at + " carries its chip \"" + expected[sprite] + "\"");
                Assert.AreEqual(SkinSlots.Chip, chip.sprite.name.Replace("(Clone)", ""), at + " uses the HUD's chip piece");
                Assert.AreEqual(expected[sprite], image.GetComponentsInChildren<TMP_Text>().Single(label => label.name.EndsWith(" chip label")).text, at);
                seen++;
            }
            // A goal whose size or count the picture itself draws (a block's size) has no chip.
            if (expected.Values.Any(chip => chip != "")) Assert.Greater(seen, 0, page + " draws its chips");
        }
        // In every card, the rows that lead with an icon share one icon column: their words start at one x.
        public static void AssertOneIconColumn(Component root, string page)
        {
            var images = root.GetComponentsInChildren<Image>();
            var labels = root.GetComponentsInChildren<TMP_Text>().Where(text => text.name.EndsWith(" label") && !text.name.EndsWith(" chip label"))
                .Where(text => { string row = text.name.Substring(0, text.name.Length - " label".Length);
                    return images.Any(image => image.name == row + " pictogram" || image.name == row + " icon"); }).ToArray();
            foreach (var card in images.Where(image => image.sprite != null && image.sprite.name.Replace("(Clone)", "") == SkinSlots.Card && !image.name.EndsWith(" tile")))
            {
                var inside = SkinUi.ScreenRect(card.rectTransform);
                var starts = labels.Where(text => inside.Contains(SkinUi.ScreenRect(text.rectTransform).center))
                    .Select(text => (text.name, x: SkinUi.ScreenRect(text.rectTransform).xMin)).ToArray();
                if (starts.Length > 1)
                    Assert.AreEqual(starts.Min(start => start.x), starts.Max(start => start.x), .5f, page + ": " + card.name + "'s rows start their words at one x: " +
                        string.Join(", ", starts.Select(start => start.name + " " + start.x)));
            }
        }
        // A screen's secondary actions wear the skin's filled secondary piece; tertiary ones are the quiet outline.
        public static void AssertButtonKinds(Component root, string page, string[] secondary, string[] quiet)
        {
            var buttons = root.GetComponentsInChildren<Button>();
            // A name ending in * names every button it begins.
            Button Named(string name) => buttons.Single(button => name.EndsWith("*") ? button.name.StartsWith(name.TrimEnd('*')) : button.name == name);
            foreach (var name in secondary)
                Assert.AreEqual(SkinSlots.ButtonSecondary, Named(name).GetComponent<Image>().sprite.name.Replace("(Clone)", ""), page + ": " + name + " is a secondary action");
            foreach (var name in quiet)
            {
                var face = Named(name);
                Assert.IsNotNull(face.transform.Find(face.name + " rim"), page + ": " + name + " is a quiet outline");
            }
        }
        private static byte Bonus(byte realm) => (byte)Protocol.Realms.Single(value => value.MapId == realm).GuardianAndHeight[0];

        [UnityTest] public IEnumerator EveryGoalPictogramCarriesItsChipAsTheHudDoes()
        {
            root = new GameObject("Pictogram pages");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            var shell = root.AddComponent<PageShell>(); shell.Initialize("Pictogram pages");
            Phones.WireframeSeeker(shell);
            shell.RequestRealm(1);
            while (shell.Loading) yield return null;
            var source = new Wireframe();
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Home", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            var catalog = PageCatalog.Load();
            var level = source.Level.Goals; var rule = catalog.Rule(1);
            var campaign = new[] { (SkinSlots.GoalScore, (string)null),
                (catalog.Goal(level.PrimaryKind, level.PrimaryValue, level.PrimaryCount).Pictogram(Bonus(1)), catalog.Goal(level.PrimaryKind, level.PrimaryValue, level.PrimaryCount).chip),
                (catalog.Goal(level.SecondaryKind, level.SecondaryValue, level.SecondaryCount).Pictogram(Bonus(1)), catalog.Goal(level.SecondaryKind, level.SecondaryValue, level.SecondaryCount).chip) };
            IEnumerator Page(string page, Action draw, IEnumerable<(string, string)> goals)
            {
                draw(); yield return null;
                foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                AssertPictograms(root.transform, page, goals);
                AssertOneIconColumn(root.transform, page);
            }
            yield return Page("preview", () => views.Render(AppPage.Level), campaign.Append((rule.pictogram, rule.chip)));
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 14, StarSources = 3, EndReason = 2, PrimaryProgress = 6, Goals = level, Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            yield return Page("result", () => views.Render(AppPage.Result), campaign);
            foreach (bool arcade in new[] { false, true })
            {
                source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Actions = new[] { new PageAction { Label = "Play today" } },
                    Arcade = arcade ? new ArcadeView { Pot = "0.10 SOL" } : null };
                yield return Page(arcade ? "Arena" : "Home", () => views.Render(AppPage.Home), new[] { (catalog.Goal(1, 3).Pictogram(Bonus(3)), catalog.Goal(1, 3).chip) });
            }
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20704,
                ObjectiveKind = 2, ObjectiveValue = 2, Score = 3480, ObjectiveTotal = 9, Streak = 3, Tier = 2, Done = new PageAction { Label = "Continue" } };
            yield return Page("Daily result", () => views.Render(AppPage.Result), new[] { (SkinSlots.GoalScore, (string)null),
                (catalog.Goal(2, 2).Pictogram(Bonus(1)), catalog.Goal(2, 2).chip) });
            Assert.AreEqual("×", root.GetComponentsInChildren<TMP_Text>().Single(label => label.name == "Multiplier sign").text, "The multiplier's ring holds its ×");
            source.Result.Arcade = true;
            yield return Page("Arena result", () => views.Render(AppPage.Result), new[] { (SkinSlots.GoalScore, (string)null),
                (catalog.Goal(2, 2).Pictogram(Bonus(1)), catalog.Goal(2, 2).chip) });
            greeted = 0;
            yield return Page("greeting rule", () => { views.Render(AppPage.Campaign); var talk = root.GetComponentInChildren<GuardianTalk>(); talk.Complete(); talk.Tap(); },
                new[] { (rule.pictogram, rule.chip) });
            Phones.Clear(shell);
        }

        // The pause and its end-run confirm over a Campaign board, on the
        // wireframe's Seeker frame.
        [UnityTest] public IEnumerator PauseAndItsConfirmMatchTheirWireframesAtSeekerSize()
        {
            root = new GameObject("Wireframe board");
            var board = root.AddComponent<BoardController>();
            var evidence = root.AddComponent<ZKube.Presentation.Tests.BoardHarness>(); evidence.AutoStart = false;
            evidence.Load("realm-1-campaign");
            for (float deadline = Time.realtimeSinceStartup + 20; !BoardTestState.Idle(board);)
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for the board");
                yield return null;
            }
            var art = BoardTestState.Art(board);
            board.View.gameObject.SetActive(false);
            var screen = Phones.WireframeScreen; var safe = new Rect(0, 0, screen.width, screen.height - Phones.SeekerTopInsetDp);
            foreach (bool confirm in new[] { false, true })
            {
                var host = new GameObject("Pause view"); host.transform.SetParent(root.transform);
                var ui = new SkinUi(art, 1, 1);
                var view = host.AddComponent<BoardView>(); view.Create(board, art, HudLayout.Build(ui, board.State, board.Session, safe, 1, screen), ui);
                view.Summary(board.State, board.Session, true);
                var dialog = confirm
                    ? PauseDialog.Confirm(view, art, BoardController.EndRunCost(board.Session, board.State), BoardController.EndRunDetail(board.Session), () => { }, () => { })
                    : PauseDialog.Pause(view, art, board.State, board.Session, () => { }, board.PauseRows(), () => { }, () => { });
                Canvas.ForceUpdateCanvases();
                var pieces = Pieces(dialog, screen, 1);
                Dump(confirm ? "endconfirm" : "pause", pieces);
                Match(confirm ? "endconfirm" : "pause", pieces, screen, 1.1f, "titles", "cards", "primaries");
                AssertButtonKinds(dialog, confirm ? "endconfirm" : "pause", new[] { "Dialog " + BoardController.EndRun }, new string[0]);
                if (!confirm) AssertPictograms(dialog, "pause", ScreenKit.Goals(PageCatalog.Load(), new CampaignGoals { Points = board.Session.Rules.PointsRequired,
                    PrimaryKind = board.Session.Rules.PrimaryKind, PrimaryValue = board.Session.Rules.PrimaryValue, PrimaryCount = board.Session.Rules.PrimaryCount,
                    SecondaryKind = board.Session.Rules.SecondaryKind, SecondaryValue = board.Session.Rules.SecondaryValue, SecondaryCount = board.Session.Rules.SecondaryCount },
                    board.Session.Rules.BonusType).Select(goal => (goal.Pictogram, goal.Chip)));
                host.SetActive(false); UnityEngine.Object.Destroy(host); ui.Dispose();
                yield return null;
            }
            // A Daily's pause carries its objective's chip and the multiplier's ×.
            evidence.Load("realm-8-daily");
            for (float deadline = Time.realtimeSinceStartup + 20; !BoardTestState.Idle(board);)
            {
                if (Time.realtimeSinceStartup > deadline) Assert.Fail("Timed out waiting for the Daily board");
                yield return null;
            }
            var daily = new GameObject("Daily pause view"); daily.transform.SetParent(root.transform);
            var dailyUi = new SkinUi(art, 1, 1);
            var dailyView = daily.AddComponent<BoardView>(); dailyView.Create(board, art, HudLayout.Build(dailyUi, board.State, board.Session, safe, 1, screen), dailyUi);
            dailyView.Summary(board.State, board.Session, true);
            var paused = PauseDialog.Pause(dailyView, art, board.State, board.Session, () => { }, board.PauseRows(), () => { }, () => { });
            var objective = PageCatalog.Load().Goal(board.Session.Rules.ObjectiveKind, board.Session.Rules.ObjectiveValue);
            AssertPictograms(paused, "Daily pause", new[] { (SkinSlots.GoalScore, (string)null), (objective.Pictogram(board.Session.Rules.BonusType), objective.chip) });
            AssertOneIconColumn(paused, "Daily pause");
            Assert.AreEqual("×", paused.GetComponentsInChildren<TMP_Text>().Single(label => label.name == "Multiplier sign").text, "The multiplier's ring holds its ×");
            daily.SetActive(false); UnityEngine.Object.Destroy(daily); dailyUi.Dispose();
        }
    }
}
