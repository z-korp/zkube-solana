using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using Piece = ZKube.Presentation.ScreenKit.Piece;

namespace ZKube.Presentation
{
    // The Campaign pages: the realm map, a realm that is not open yet, the level
    // preview and the guardian's first greeting, and the talk-scene footprint
    // they share with the results.
    public sealed partial class PageViews
    {
        public GuardianGreetings Greetings { get; set; } = GuardianGreetings.Device();

        // The map: the realm's painting behind the header card (the realm, "Realm
        // N of 10" and its stars), the authored path fitted into the room between
        // the header and Play with S-curve edges, the glowstone medallions and the
        // guardian 1.6 times their size, each finished node's stars under it, the
        // current node breathing, and the lowest row on the tabs: "Play level N"
        // between the realm stepper's two arrows. The path needs the height a
        // stepper bar would take (the compact phone's did not fit under one), so
        // the arrows flank Play and the header names what they step.
        private void Campaign(CampaignPageView value)
        {
            var realm = catalog.Realm(value.Realm);
            if (value.Locked != null) { Waiting(value); return; }
            var kit = Kit;
            var trial = value.Trials[Focus(value.Trials, 0)];
            var play = new PageAction { Name = "Play level", Label = (trial.Playing ? "Resume level " : "Play level ") + Number(value.Realm, trial.Level),
                Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open, Icon = SkinSlots.IconPlay };
            var header = MapHeader(value, kit, true);
            Rect headerRect = default, room = default;
            // The header and the path's room are measured by the composer and drawn after it:
            // the header over the map, so the guardian's glow passes under it.
            Place(kit, new ScreenKit.Slots { Title = new Piece(header.Height, rect => headerRect = rect), Body = new[] { new Piece(-1, rect => room = rect) },
                Stepper = kit.StepperRow(Arrow(value.Previous, "Previous realm"), Arrow(value.Next, "Next realm"), kit.Foot(Control(play), null, null, null)) });
            // The path's room runs from the header's foot to what stands under it, the gaps between them included.
            room = Rect.MinMaxRect(room.x, room.yMin - 10 * kit.U, room.xMax, headerRect.yMin);
            Map(value, room);
            header.Draw(headerRect);
            if (!Greetings.Greeted(value.Realm)) Greeting(value.Realm, realm);
        }
        // The realm stepper of a realm that is not open, whose page has the room: one bar on the tabs.
        private Piece RealmStepper(CampaignPageView value, ScreenKit kit) =>
            kit.Stepper("Realm stepper", "Map place", "Realm " + value.Realm + " of " + Protocol.Realms.Length, null, null,
                Arrow(value.Previous, "Previous realm"), Arrow(value.Next, "Next realm"));

        // The header card: the realm's name, left-aligned, and its stars; the open
        // map's also says "Realm N of 10", which a waiting realm's stepper bar says.
        // It is status only.
        private Piece MapHeader(CampaignPageView value, ScreenKit kit, bool placed)
        {
            float u = kit.U; var inside = kit.Inside();
            string name = catalog.Realm(value.Realm).realmName, place = "Realm " + value.Realm + " of " + Protocol.Realms.Length;
            string total = "/" + Protocol.CampaignTargets.Length * 3;
            var stars = inside.Beside(10, inside.Icon("Map stars icon", SkinSlots.StarLit, 28),
                inside.Value("Map stars", value.Stars + "<color=#" + ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted)) + ">" + total + "</color>"));
            float text = inside.Width - stars.Width - 10 * u;
            float titleDp = inside.TitleFit(name, text - 1);
            float titleHeight = inside.Block(name, text, titleDp, SkinUi.Type.Display, ScreenKit.TitleLeading);
            float placeHeight = placed ? inside.Block(place, text, inside.SubtitleDp, SkinUi.Type.Caption, ScreenKit.NoteLeading) : 0;
            float block = titleHeight + (placed ? 2 * u + placeHeight : 0);
            return kit.Card(null, new[] { new Piece(block, rect => {
                stars.Draw(new Rect(rect.xMax - stars.Width, rect.center.y - stars.Height / 2, stars.Width, stars.Height));
                inside.Text("Map title", name, new Rect(rect.x, rect.yMax - titleHeight, text, titleHeight), titleDp, SkinTokens.Text, SkinUi.Type.Display,
                    ScreenKit.TitleLeading, TextAlignmentOptions.Left);
                if (placed) inside.Text("Map place", place, new Rect(rect.x, rect.y, text, placeHeight), inside.SubtitleDp, SkinTokens.TextMuted, SkinUi.Type.Caption,
                    ScreenKit.NoteLeading, TextAlignmentOptions.Left);
            }) }, "Map header");
        }

        // Node sizes in dp: the glowstone 48 on the Seeker and 40 on a compact
        // phone, the current one 1.1 and the guardian, the realm's boss, 1.9
        // times larger, stars a share of the glowstone under each finished node
        // and the guardian. A crowded realm shrinks them, never below 34 dp,
        // until every node and its star row clear the others by 4 dp.
        public const float CurrentScale = 1.1f, GuardianScale = 1.9f, StarShare = .31f, GuardianStarShare = .42f, StarGapShare = .06f;
        public const float MinimumNodeDp = 34, ClearanceDp = 4;

        // The painting, the path and the nodes in the room between the header and
        // Play. The authored path is fitted to the room's width and height apart,
        // over its own extent, so it spreads over the whole room on any aspect.
        private void Map(CampaignPageView value, Rect room)
        {
            var realm = catalog.Realm(value.Realm);
            float d = ui.Density;
            int count = value.Trials.Length, focus = Focus(value.Trials, 0);
            // The realm's map painting covers the screen with its lower part in view, as CSS's "center 80%".
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Map), focus: .8f);
            bool Lit(int index) => index == focus && value.Trials[index].Available;
            float normal = Step(48, 40) * d; Rect path; Vector2[] at;
            while (true)
            {
                path = PathRect(realm.campaignPath, room, normal);
                var placed = path;
                at = realm.campaignPath.Select(point => new Vector2(placed.x + point.x * placed.width, placed.yMax - point.y * placed.height)).ToArray();
                var feet = at.Select((center, index) => Footprint(value.Trials[index], center, normal, index == count - 1, Lit(index))).ToArray();
                if (Clearance(feet) >= ClearanceDp * d - .01f || normal <= MinimumNodeDp * d) break;
                normal = Mathf.Max(MinimumNodeDp * d, normal - .5f * d);
            }
            var states = value.Trials.Select((trial, index) => trial.Playing ? "playing" :
                trial.Stars > 0 ? "cleared" : trial.Available ? "current" : "locked").ToArray();
            // The path graphic maps the authored points through its rect, so the rect
            // is the fit's own; strokes and dashes keep their dp at any fit.
            var line = ui.Rect<CampaignPathGraphic>("Lit path", path, shell.Page);
            float unit = path.width / 60;
            string Units(float dp) => (dp * d / unit).ToString(CultureInfo.InvariantCulture);
            var gold = new Color(1, 233 / 255f, 168 / 255f, 1); var moon = new Color(221 / 255f, 239 / 255f, 247 / 255f, 1);
            line.Configure(realm, states, new PageCatalog.PathStyle { pathStyle = "solid", strokeWidth = 4.5f * d / unit, lockedStrokeWidth = 3 * d / unit,
                lockedDash = Units(3) + " " + Units(8),
                clearedRgba = new[] { gold.r, gold.g, gold.b, 1f }, activeRgba = new[] { gold.r, gold.g, gold.b, 1f }, lockedRgba = new[] { moon.r, moon.g, moon.b, 1.2f } });
            for (int index = 0; index < count; index++)
                Node(value, value.Trials[index], at[index], normal, index == count - 1, Lit(index));
        }
        // The rect through which the authored points land: the path's extent
        // fitted to the room's width and height apart, inset so the guardian, a
        // current node and a star row stay inside it.
        private Rect PathRect(PageCatalog.Point[] points, Rect room, float normal)
        {
            float d = ui.Density, guardian = normal * GuardianScale;
            float side = guardian / 2 + 2 * d, above = guardian / 2 + 2 * d;
            float below = Mathf.Max(normal * CurrentScale / 2, normal / 2 + normal * StarGapShare + normal * StarShare * 1.18f) + 2 * d;
            float minX = points.Min(point => point.x), maxX = points.Max(point => point.x), minY = points.Min(point => point.y), maxY = points.Max(point => point.y);
            float width = (room.width - 2 * side) / Mathf.Max(.01f, maxX - minX), height = (room.height - above - below) / Mathf.Max(.01f, maxY - minY);
            float x = room.x + side - minX * width, yMax = room.yMax - above + minY * height;
            return new Rect(x, yMax - height, width, height);
        }
        // A node's size and its star row, if it shows one.
        private static (Rect node, Rect stars, bool starred) NodeRects(CampaignTrialView trial, Vector2 center, float normal, bool guardian, bool lit)
        {
            float size = normal * (guardian ? GuardianScale : lit ? CurrentScale : 1), star = normal * (guardian ? GuardianStarShare : StarShare);
            var node = new Rect(center.x - size / 2, center.y - size / 2, size, size);
            var stars = new Rect(center.x - 1.5f * star * 1.05f, node.y - StarGapShare * normal - star * 1.18f, 3 * star * 1.05f, star * 1.18f);
            return (node, stars, guardian || trial.Stars > 0);
        }
        private static Rect Footprint(CampaignTrialView trial, Vector2 center, float normal, bool guardian, bool lit)
        {
            var (node, stars, starred) = NodeRects(trial, center, normal, guardian, lit);
            return starred ? Rect.MinMaxRect(Mathf.Min(node.xMin, stars.xMin), stars.yMin, Mathf.Max(node.xMax, stars.xMax), node.yMax) : node;
        }
        // The smallest gap between two footprints, along whichever axis parts them most.
        public static float Clearance(IReadOnlyList<Rect> feet)
        {
            float least = float.PositiveInfinity;
            for (int a = 0; a < feet.Count; a++)
                for (int b = a + 1; b < feet.Count; b++)
                    least = Mathf.Min(least, Mathf.Max(Mathf.Max(feet[b].xMin - feet[a].xMax, feet[a].xMin - feet[b].xMax),
                        Mathf.Max(feet[b].yMin - feet[a].yMax, feet[a].yMin - feet[b].yMax)));
            return least;
        }
        // The current level: the one being played, else the first open one without
        // a star, else the last one reached. Home's Campaign card plays it too.
        private static int Focus(CampaignTrialView[] trials, byte previewLevel)
        {
            int focus = previewLevel > 0 ? previewLevel - 1 : Array.FindIndex(trials, trial => trial.Playing);
            if (focus < 0) focus = Array.FindIndex(trials, trial => trial.Available && trial.Stars == 0);
            if (focus < 0) focus = Math.Max(0, Array.FindLastIndex(trials, trial => trial.Available || trial.Stars > 0));
            return focus;
        }

        // One level, in its realm's own node set. Locked: dark stone with a
        // lock. Open: the glowstone with its number. Done: its own settled
        // stone in the tier of its stars (bronze, silver, gold), its number in
        // the dark ink and its stars under it. Current: larger, its cream rim, pulsing in
        // its breathing light (reduced motion: the light alone). The guardian,
        // the realm's boss: its portrait in its own ring, nearly twice a node,
        // in the realm's breathing glow over a wider halo, dimmed with a lock
        // until it opens, its larger stars always under it. The touch area
        // covers the node and its stars, at least 48 dp.
        private void Node(CampaignPageView value, CampaignTrialView trial, Vector2 center, float normal, bool guardian, bool lit)
        {
            float d = ui.Density;
            string name = "Trial " + trial.Level;
            bool done = trial.Stars > 0, open = trial.Available;
            var (rect, stars, starred) = NodeRects(trial, center, normal, guardian, lit);
            float size = rect.width, star = stars.height / 1.18f;
            var area = Footprint(trial, center, normal, guardian, lit);
            float touch = BoardLayout.MinimumTouchDp * d;
            var hitRect = Rect.MinMaxRect(Mathf.Min(area.xMin, area.center.x - touch / 2), Mathf.Min(area.yMin, area.center.y - touch / 2),
                Mathf.Max(area.xMax, area.center.x + touch / 2), Mathf.Max(area.yMax, area.center.y + touch / 2));
            var hit = ui.Rect<Image>(name, hitRect, shell.Page);
            hit.color = Color.clear; hit.raycastTarget = true;
            var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
            ScreenKit.As(button, ScreenKit.Role.Choice);
            hit.gameObject.AddComponent<PressSquash>();
            if (lit) ui.Glow(name + " glow", Scaled(rect, 1.7f), SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .55f), hit.transform, reducedMotion ? 0 : HaloSeconds);
            if (guardian)
            {
                var boss = ui.Art.Token(SkinTokens.LightGlow);
                ui.Glow(name + " halo", Scaled(rect, 2.3f), SkinUi.WithAlpha(boss, .35f), hit.transform);
                ui.Glow(name + " light", Scaled(rect, 1.7f), SkinUi.WithAlpha(boss, open || done ? .7f : .4f), hit.transform, reducedMotion ? 0 : HaloSeconds);
                // The portrait fills the portal ring's 176/256 opening; the ring is
                // drawn over it in place of the medallion's own frame.
                float face = size * 176f / 256f * 320f / 232f;
                var portrait = ui.Medallion(name + " guardian", new Rect(rect.center.x - face / 2, rect.center.y - face / 2, face, face),
                    ui.Art.Sprite("boss__portrait"), hit.transform);
                Destroy(hit.transform.Find(name + " guardian frame").gameObject);
                RealmPiece(name + " ring", SkinSlots.MapNodeGuardian, rect, hit.transform);
                if (!open && !done)
                {
                    portrait.color = new Color(.45f, .45f, .45f, 1);
                    Tinted(name + " lock", SkinSlots.IconLock, new Rect(rect.xMax - .36f * size, rect.y + .03f * size, .3f * size, .3f * size), SkinTokens.Text,
                        hit.transform);
                }
            }
            else
            {
                var face = RealmPiece(name + " node", lit ? SkinSlots.MapNodeCurrent : done ? DoneNode(trial.Stars) : open ? SkinSlots.MapNodeOpen : SkinSlots.MapNodeLocked,
                    rect, hit.transform);
                if (lit) face.gameObject.AddComponent<SkinPulse>();
                if (open || done)
                    // A done node's face is light: its number takes the dark ink.
                    ui.Label(name + " number", Number(value.Realm, trial.Level), rect, size * .37f / d, done && !lit ? SkinTokens.TextOnPrimary : SkinTokens.Text,
                        lit ? face.transform : hit.transform,
                        SkinUi.Type.Display).textWrappingMode = TextWrappingModes.NoWrap;
                else Tinted(name + " lock", SkinSlots.IconLock, Scaled(rect, .46f), SkinTokens.TextMuted, hit.transform);
            }
            if (starred)
                for (int i = 0; i < 3; i++)
                    ui.Star(name + " star " + (i + 1), new Rect(stars.x + i * star * 1.05f, stars.y + (i == 1 ? .18f * star : 0), star, star), i < trial.Stars,
                        hit.transform);
            actions.Wire(button, new PageAction { Name = name, Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open }, fade: false);
        }
        // A cleared node's piece, by the stars it kept: bronze for one, silver for two, gold for three.
        public static string DoneNode(int stars) => "map-node-done-" + Mathf.Clamp(stars, 1, 3);
        // A piece of the page realm's own art (its map nodes), at its own aspect.
        private Image RealmPiece(string name, string slot, Rect rect, Transform parent)
        {
            var image = ui.Rect<Image>(name, rect, parent);
            image.sprite = ui.Art.SkinRealm(slot); image.preserveAspect = true; image.raycastTarget = false;
            return image;
        }
        private Image Tinted(string name, string slot, Rect rect, string token, Transform parent)
        {
            var image = ui.Piece(name, slot, rect, parent); image.color = ui.Art.Token(token); return image;
        }
        private static Rect Scaled(Rect rect, float scale) =>
            new Rect(rect.center.x - rect.width * scale / 2, rect.center.y - rect.height * scale / 2, rect.width * scale, rect.height * scale);

        // A realm that is not open yet, under the map's own header and stepper: its
        // guardian, why the path is waiting and, where the store's purchase closes
        // it, the purchase and restore in the foot row. A realm waiting for stars
        // has no button: its reason says what to clear, and the stepper leads back.
        private void Waiting(CampaignPageView value)
        {
            var kit = Kit; float u = kit.U; var inside = kit.Inside();
            float medal = Step(144, 112) * u, mark = 44 * u;
            float titleDp = 24 * kit.K, reasonDp = kit.CaptionDp;
            float titleHeight = inside.Block("The path is waiting", inside.Width, titleDp, SkinUi.Type.Display, ScreenKit.TitleLeading);
            float reasonHeight = inside.Block(value.Locked, inside.Width, reasonDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            var body = new List<Piece> { Piece.Grow,
                new Piece(medal, rect => ui.Medallion("Waiting guardian", new Rect(rect.center.x - medal / 2, rect.y, medal, medal), ui.Art.Sprite("boss__portrait"), shell.Page)),
                kit.Card(null, new[] {
                    new Piece(mark, rect => Tinted("Waiting lock", SkinSlots.IconLock, new Rect(rect.center.x - mark / 2, rect.y, mark, mark), SkinTokens.TextMuted, shell.Page)),
                    new Piece(titleHeight, rect => inside.Text("Waiting title", "The path is waiting", rect, titleDp, SkinTokens.Text, SkinUi.Type.Display, ScreenKit.TitleLeading)),
                    new Piece(reasonHeight, rect => inside.Text("Waiting reason", value.Locked, rect, reasonDp, SkinTokens.Text, SkinUi.Type.Caption, ScreenKit.CaptionLeading,
                        TextAlignmentOptions.Left)) }, "Waiting card") };
            if (value.StoreProblem != null)
            {
                body.Add(kit.Note(value.StoreProblem, "Store problem", SkinTokens.Negative));
                body.Add(kit.Note("Check your connection and try again.", "Store problem help", SkinTokens.TextMuted));
            }
            body.Add(Piece.Grow);
            Place(kit, new ScreenKit.Slots { Title = MapHeader(value, kit, false), Body = body, Primary = Control(value.Purchase), Tertiary = Control(value.Restore),
                Stepper = RealmStepper(value, kit) });
        }

        // The first visit to a realm: over the dimmed map the guardian greets the
        // player with its line and its rule. A tap anywhere continues.
        private void Greeting(byte realmId, PageCatalog.RealmPage realm) =>
            TalkScene("Guardian greeting", realm, TalkPage.MapGreeting(realm, catalog.Rule(realmId), realmId > 1), () => Greetings.Greet(realmId), false);

        // A lesson over the page drawn: its guardian teaches the pages, then done
        // runs, once, whether the player read them through or skipped.
        public void Teach(TalkPage[] pages, Action done)
        {
            if (shell.Artwork == null) throw new InvalidOperationException("Draw the page before teaching over it");
            // A redraw of the page keeps the lesson it is already showing.
            if (shell.Chrome.Find("Lesson") != null) return;
            TalkScene("Lesson", catalog.Realm(shell.Artwork.RealmId), pages, done, true);
        }

        // The guardian's talk scene over the dimmed page, taking the whole screen
        // as the wireframe draws it (the tab bar waits under it). A tap anywhere is
        // a tap on the talk; a page's lesson card shows above the guardian; Skip,
        // where offered, finishes at once.
        private void TalkScene(string name, PageCatalog.RealmPage realm, TalkPage[] pages, Action finished, bool skip)
        {
            float d = ui.Density; var safe = shell.SafeArea;
            var root = Holder(name, shell.ScreenArea, shell.Chrome);
            var scrim = ui.Rect<Image>(name + " scrim", shell.ScreenArea, root);
            scrim.color = ui.Art.Token(SkinTokens.Scrim); scrim.raycastTarget = true;
            // The talk box (.talkbox) spans the column, its bottom 30u and a gap over the column's foot.
            var kit = new ScreenKit(ui, null, shell.ScreenArea, safe);
            float width = kit.Width, left = safe.center.x - width / 2, u = kit.U;
            var tabs = shell.Chrome.GetComponentInChildren<SkinTabBar>();
            if (tabs != null) tabs.gameObject.SetActive(false);
            bool closed = false;
            void Close()
            {
                if (closed) return; closed = true;
                if (tabs != null) tabs.gameObject.SetActive(true);
                if (root != null) { root.gameObject.SetActive(false); Destroy(root.gameObject); }
                finished?.Invoke();
            }
            var box = Speak(name + " talk", root, left, safe.center.y, width, realm, pages, Close, true);
            var talk = root.GetComponentInChildren<GuardianTalk>();
            // The guardian stays under the page's edge.
            float lift = Mathf.Min(kit.Bottom + 40 * kit.U - box.y, kit.Edge - SkinUi.ScreenRect(Guardian(root).rectTransform).yMax);
            foreach (Transform piece in root) if (piece != scrim.transform) ((RectTransform)piece).anchoredPosition += new Vector2(0, lift);
            box.y += lift;
            float top = kit.Edge;
            if (skip)
            {
                // Skip (.x3 corner): a quiet pill hanging from the page's edge, 12u in from the right.
                float h = kit.Touch(40), w = ui.TextWidth("Skip", 15, SkinUi.Type.Number) + 32 * u;
                var rect = new Rect(safe.xMax - 12 * u - w, kit.Edge - h, w, h);
                ScreenKit.As(ui.TextButton("Skip lesson", rect, "Skip", Close, false, root, out _, sizeDp: 15), ScreenKit.Role.Skip);
                top = rect.y - 8 * u;
            }
            if (pages.Any(page => page.Picture != null))
            {
                // The card sits between the corner and the guardian's head, as tall as its room allows, at its own shape.
                var guardian = SkinUi.ScreenRect(Guardian(root).rectTransform);
                var first = ui.Art.SkinUi(pages.First(page => page.Picture != null).Picture).rect;
                float aspect = first.width / first.height;
                float bottom = guardian.y + guardian.height * .82f + 8 * u, room = Mathf.Max(0, top - bottom);
                float cardHeight = Mathf.Min(room, 320 * d * kit.K, width * .86f / aspect), cardWidth = cardHeight * aspect;
                var card = ui.Rect<Image>(name + " card", new Rect(safe.center.x - cardWidth / 2, bottom + (room - cardHeight) / 2, cardWidth, cardHeight), root);
                card.preserveAspect = true; card.raycastTarget = false;
                void Show(TalkPage page) { card.enabled = page.Picture != null; if (page.Picture != null) card.sprite = ui.Art.SkinUi(page.Picture); }
                Show(talk.Current); talk.Opened += Show;
            }
            if (!reducedMotion)
            {
                // The scrim fades in, then the guardian rises onto the rail.
                var group = root.gameObject.AddComponent<CanvasGroup>();
                var sequence = root.gameObject.AddComponent<PageSequence>();
                sequence.Add(0, .15f, t => group.alpha = t);
                foreach (var image in root.GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" guardian") || image.name.EndsWith(" paws")))
                {
                    var rect = image.rectTransform; var at = rect.anchoredPosition;
                    sequence.Add(.1f, .3f, t => rect.anchoredPosition = at - new Vector2(0, 24 * d * (1 - PageSequence.EaseOut(t))));
                }
            }
            var tap = ScreenKit.As(scrim.gameObject.AddComponent<Button>(), ScreenKit.Role.Anywhere); tap.transition = Selectable.Transition.None;
            // A tap anywhere is a tap on the talk: it completes the line, turns the
            // page, and on the last page continues.
            tap.onClick.AddListener(() => talk.Tap());
            scrim.name = "Continue";
        }

        // The guardian's talk scene for this page, over its box's top at rail.
        // Inside a dialog the page's own actions continue, so the talk's tap hint
        // is not shown. Returns the box.
        private Rect Speak(string name, Transform parent, float x, float rail, float width, PageCatalog.RealmPage realm, TalkPage[] pages,
            Action finished, bool hint)
        {
            var talk = ui.Talk(name, x, rail, width, U, realm, pages, finished, parent, hint);
            return SkinUi.ScreenRect((RectTransform)talk.transform);
        }
        // A phone under 720 dp tall: dialogs close up their spacing so their
        // actions stay on screen; under 600 dp (a 640 dp phone less its status
        // and camera insets) they close up further.
        private bool Compact => shell.SafeArea.height < 720 * ui.Density;
        private bool Tight => shell.SafeArea.height < 600 * ui.Density;

        // The guardian's line on a level's preview: its trial line on its own
        // level, and on the others a rotation by level that never repeats from one
        // level to the next: the greeting, then the guardian's praise and star
        // lines as prompts.
        private static TalkPage LevelLine(PageCatalog.GuardianLines lines, byte level)
        {
            if (level == Protocol.CampaignTargets.Length) return TalkPage.For(lines, TalkMoment.TrialIntro);
            return ((level - 1) % 5) switch {
                0 => TalkPage.For(lines, TalkMoment.Greeting),
                1 => new TalkPage(lines.respectLine, "satisfied"),
                2 => new TalkPage(lines.twoStar, "satisfied"),
                3 => new TalkPage(lines.oneStar, "idle"),
                _ => new TalkPage(lines.threeStar, "celebrate"),
            };
        }
        // The page shows the realm's rule once its line is done, with what the
        // bonus does: it removes blocks without scoring.
        private static Image Guardian(Transform parent) =>
            parent.GetComponentsInChildren<Image>().FirstOrDefault(image => image.name.EndsWith(" guardian"));
    }
}
