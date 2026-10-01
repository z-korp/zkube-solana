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
                Streak = 1, BestDailyScore = 1240, ChangeName = _ => { },
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
                ["talk"] = Where(image => Slot(image) == SkinSlots.Dialog),
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

        // How far a guardian's canvas top stands over what it leans on.
        private static float GuardianStand(Rect canvas) => ScreenKit.GuardianStand * canvas.width;
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
                        Near(GuardianStand(w), (float)expected["talk"][0][1] - w.y, "stand");
                        Near(GuardianStand(w), got["talk"][0].y - h.y, "stand");
                        continue;
                    }
                    Near(w.y, h.y, "top");
                    if (role != "guardians") Near(w.height, h.height, "height");
                }
            }
            foreach (var card in got["cards"])
                Assert.AreEqual(card.xMin, width - card.xMax, .5f, page + ": card " + card + " sits between equal gutters");
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
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Daily", "realms", 1);
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
                if (page.StartsWith("greet")) Match(page, pieces, shell.ScreenArea, 1.1f, "guardians", "talk");
                else Match(page, pieces, shell.ScreenArea, 1.1f);
            }
            source.Daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Play today" } } };
            yield return Page("home", () => views.Render(AppPage.Daily));
            AssertButtonKinds(root.transform, "home", new string[0], new[] { "Play level*" });
            // The four tabs draw four distinct pictures; the Daily's is its stopwatch.
            var tabIcons = root.GetComponentsInChildren<SkinTabBar>().Single().GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" icon"))
                .Select(image => image.sprite.name.Replace("(Clone)", "")).ToArray();
            Assert.AreEqual(4, tabIcons.Distinct().Count(), "four distinct tab icons: " + string.Join(", ", tabIcons));
            Assert.AreEqual(SkinSlots.IconClock, tabIcons[1], "The Daily tab is the stopwatch");
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
            AssertButtonKinds(root.transform, "profile", new string[0], new[] { "Edit name" });
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
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Daily", "realms", 1);
            int greeted = ~0; views.Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            long now = 20705L * 86400 + 6 * 3600;
            var daily = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Play today" } } };
            var arcade = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, ClosesAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "Enter · 1 Kredit" } }, Arcade = new ArcadeView { Pot = "0.10 SOL", Closes = "Closes 00:00 UTC" },
                Blocks = new[] { PanelBlock.Bar("Kredit balance", SkinSlots.IconKredit, "3", "Kredits", false, new PageAction { Label = "Kredits" }, new PageAction { Label = "Rewards" }),
                    PanelBlock.Text("Arcade rule", "Your best run on each board counts.", SkinTokens.TextMuted) } };
            var campaign = new ResultPageView { ProductName = "zKube", Mode = "Campaign", PlayerName = "Player", HasResult = true, ShowStars = true, Realm = 1, Level = 1,
                Score = 24, StarSources = 7, EndReason = 1, MovesLeft = 3, PrimaryProgress = 6, Goals = source.Level.Goals, NewBest = true, NextOpen = false,
                Done = new PageAction { Label = "Continue" }, Retry = new PageAction { Label = "Retry" } };
            var dailyResult = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20704,
                ObjectiveKind = 2, ObjectiveValue = 2, Score = 3480, ObjectiveTotal = 9, Streak = 3, Tier = 2, NewBest = true, NextOpensAt = 20705L * 86400,
                Now = () => 20705L * 86400 - 7 * 3600, Done = new PageAction { Label = "Continue" }, Share = (text, token) => System.Threading.Tasks.Task.FromResult(true) };
            var used = new DailyPageView { Day = 20705, Realm = 3, ObjectiveKind = 1, ObjectiveValue = 3, Now = () => now, NextOpensAt = 20706L * 86400,
                Actions = new[] { new PageAction { Label = "View result" } } };
            var pages = new (string name, Action draw)[] {
                ("home", () => { source.Daily = daily; views.Render(AppPage.Daily); }),
                ("home with the attempt used", () => { source.Daily = used; views.Render(AppPage.Daily); }),
                ("arcade", () => { source.Daily = arcade; views.Render(AppPage.Daily); }),
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
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Daily", "realms", 1);
            var catalog = PageCatalog.Load();
            foreach (bool arcade in new[] { false, true })
                for (byte realm = 1; realm <= Protocol.Realms.Length; realm++)
                {
                    source.Daily = new DailyPageView { Day = 20705, Realm = realm, ObjectiveKind = 1, ObjectiveValue = 3,
                        Actions = new[] { new PageAction { Label = arcade ? "Enter · 1 Kredit" : "Play today" } },
                        Arcade = arcade ? new ArcadeView { Pot = "0.10 SOL", Closes = "Closes 00:00 UTC" } : null };
                    views.Render(AppPage.Daily);
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .1f);
                    var portrait = root.GetComponentsInChildren<Image>(true).Single(image => image.name == "Daily guardian");
                    for (float end = Time.realtimeSinceStartup + 10; !portrait.enabled && Time.realtimeSinceStartup < end;) yield return null;
                    var page = catalog.Realm(realm);
                    string at = (arcade ? "Arcade" : "Home") + " for realm " + realm;
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
            var views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Daily", "realms", 1);
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
                yield return Page(arcade ? "Arcade" : "Home", () => views.Render(AppPage.Daily), new[] { (catalog.Goal(1, 3).Pictogram(Bonus(3)), catalog.Goal(1, 3).chip) });
            }
            source.Result = new ResultPageView { ProductName = "zKube", Mode = "Daily", PlayerName = "Player", HasResult = true, Realm = 1, Day = 20704,
                ObjectiveKind = 2, ObjectiveValue = 2, Score = 3480, ObjectiveTotal = 9, Streak = 3, Tier = 2, Done = new PageAction { Label = "Continue" } };
            yield return Page("Daily result", () => views.Render(AppPage.Result), new[] { (SkinSlots.GoalScore, (string)null),
                (catalog.Goal(2, 2).Pictogram(Bonus(1)), catalog.Goal(2, 2).chip) });
            Assert.AreEqual("×", root.GetComponentsInChildren<TMP_Text>().Single(label => label.name == "Multiplier sign").text, "The multiplier's ring holds its ×");
            source.Result.Arcade = true;
            yield return Page("Arcade result", () => views.Render(AppPage.Result), new[] { (SkinSlots.GoalScore, (string)null),
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
                    : PauseDialog.Pause(view, art, board.State, board.Session, () => { }, board.PauseRows(), () => { });
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
            var paused = PauseDialog.Pause(dailyView, art, board.State, board.Session, () => { }, board.PauseRows(), () => { });
            var objective = PageCatalog.Load().Goal(board.Session.Rules.ObjectiveKind, board.Session.Rules.ObjectiveValue);
            AssertPictograms(paused, "Daily pause", new[] { (SkinSlots.GoalScore, (string)null), (objective.Pictogram(board.Session.Rules.BonusType), objective.chip) });
            AssertOneIconColumn(paused, "Daily pause");
            Assert.AreEqual("×", paused.GetComponentsInChildren<TMP_Text>().Single(label => label.name == "Multiplier sign").text, "The multiplier's ring holds its ×");
            daily.SetActive(false); UnityEngine.Object.Destroy(daily); dailyUi.Dispose();
        }
    }
}
