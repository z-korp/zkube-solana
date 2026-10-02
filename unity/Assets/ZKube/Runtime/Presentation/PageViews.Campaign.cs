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

        // The map, as the wireframe draws it: the realm's painting behind the
        // header card (Previous, the realm, "Realm N of 10" and its stars), the
        // authored path fitted into the room between the header and Play with
        // S-curve edges, the glowstone medallions and the guardian 1.6 times
        // their size, each finished node's stars under it, the current node
        // breathing, and "Play level N" above the tabs.
        private void Campaign(CampaignPageView value, string[] notices)
        {
            var realm = catalog.Realm(value.Realm);
            if (value.Locked != null) { Waiting(value, realm, notices); return; }
            var kit = Kit; float d = ui.Density;
            var trial = value.Trials[Focus(value.Trials, 0)];
            var play = new PageAction { Name = "Play level", Label = (trial.Playing ? "Resume level " : "Play level ") + Number(value.Realm, trial.Level),
                Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open };
            var buttons = Buttons(kit, (play, ScreenKit.Kind.Primary, SkinSlots.IconPlay));
            var header = MapHeader(value, kit);
            Rect headerRect = default, room = default, playRect = default;
            Compose(new Piece(header.Height, rect => headerRect = rect), new Piece(-1, rect => room = rect), new Piece(buttons.Height, rect => playRect = rect));
            // The path's room runs from the header's foot to Play's top, the gaps between them included.
            room = Rect.MinMaxRect(room.x, playRect.yMax, room.xMax, headerRect.yMin);
            // The header is drawn over the map, so the guardian's glow passes under it.
            Map(value, room);
            header.Draw(headerRect);
            buttons.Draw(playRect);
            var lines = notices.Concat(new[] { value.Notice, value.SavedRun }).Where(text => !string.IsNullOrEmpty(text)).ToArray();
            var more = new[] { value.Resume, value.Result }.Where(action => action != null).ToArray();
            if (lines.Length != 0 || more.Length != 0)
                Float("Campaign notice", playRect.yMax + 12 * d, card => {
                    foreach (var line in lines) card.Typed("Campaign notice text", line, SkinUi.Type.Body, 15, SkinTokens.Text, 8);
                    for (int i = 0; i < more.Length; i++) card.Button(more[i], false, i == more.Length - 1 ? 0 : 10);
                });
            if (!Greetings.Greeted(value.Realm)) Greeting(value.Realm, realm);
        }
        // The fixed Play button of a waiting realm and the panels: 320 dp wide, 20 dp above the tab bar.
        private Rect PlayRect()
        {
            float d = ui.Density; var safe = shell.SafeArea;
            float width = Mathf.Min(320 * d, safe.width - 2 * (GutterDp + 24) * d);
            return new Rect(safe.center.x - width / 2, ScreenKit.TabRect(ui, shell.ScreenArea, safe).yMax + 20 * d, width, PageColumn.ButtonDp * d);
        }

        // The header card: Previous (a 38u button), the realm's title and place
        // left-aligned, its stars, and Next where it can be taken.
        private Piece MapHeader(CampaignPageView value, ScreenKit kit)
        {
            float u = kit.U, back = kit.Touch(38); var inside = kit.Inside();
            string name = catalog.Realm(value.Realm).realmName, place = "Realm " + value.Realm + " of " + Protocol.Realms.Length;
            string total = "/" + Protocol.CampaignTargets.Length * 3;
            var stars = inside.Beside(10, inside.Icon("Map stars icon", SkinSlots.StarLit, 28),
                inside.Value("Map stars", value.Stars + "<color=#" + ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted)) + ">" + total + "</color>"));
            bool previous = value.Previous != null && value.Previous.Enabled, next = value.Next != null && value.Next.Enabled;
            float text = inside.Width - (previous ? back + 10 * u : 0) - stars.Width - 10 * u - (next ? back + 10 * u : 0);
            float titleHeight = inside.Block(name, text, inside.TitleDp, SkinUi.Type.Display, ScreenKit.TitleLeading);
            float placeHeight = inside.Block(place, text, inside.SubtitleDp, SkinUi.Type.Caption, ScreenKit.NoteLeading);
            float block = titleHeight + 2 * u + placeHeight;
            // The back button's 48 dp reach may spill into the card's padding; the row keeps the wireframe's 38u.
            return kit.Card(null, new[] { new Piece(Mathf.Max(38 * u, block), rect => {
                float left = rect.x, right = rect.xMax;
                if (previous) { HeaderButton(value.Previous, new Rect(left, rect.center.y - back / 2, back, back), SkinSlots.IconBack, false); left += back + 10 * u; }
                if (next) { HeaderButton(value.Next, new Rect(right - back, rect.center.y - back / 2, back, back), SkinSlots.IconBack, true); right -= back + 10 * u; }
                stars.Draw(new Rect(right - stars.Width, rect.center.y - stars.Height / 2, stars.Width, stars.Height));
                float top = rect.center.y + block / 2;
                inside.Text("Map title", name, new Rect(left, top - titleHeight, text, titleHeight), inside.TitleDp, SkinTokens.Text, SkinUi.Type.Display,
                    ScreenKit.TitleLeading, TextAlignmentOptions.Left);
                inside.Text("Map place", place, new Rect(left, top - block, text, placeHeight), inside.SubtitleDp, SkinTokens.TextMuted, SkinUi.Type.Caption,
                    ScreenKit.NoteLeading, TextAlignmentOptions.Left);
            }) }, "Map header");
        }

        // Node sizes in dp: the glowstone 48 on the Seeker and 40 on a compact
        // phone, the current one 1.1 and the guardian 1.6 times larger, stars a
        // share of the glowstone under each finished node and the guardian. A
        // crowded realm shrinks them, never below 34 dp, until every node and its
        // star row clear the others by 4 dp.
        public const float CurrentScale = 1.1f, GuardianScale = 1.6f, StarShare = .31f, GuardianStarShare = .38f, StarGapShare = .06f;
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
        // lock. Open or finished: the glowstone with its number, a finished one
        // with its three stars under it. Current: larger, its cream rim,
        // breathing. The guardian: its portrait in the portal ring with a soft
        // halo, dimmed with a lock until it opens, its stars always under it.
        // The touch area covers the node and its stars, at least 48 dp.
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
            hit.gameObject.AddComponent<PressSquash>();
            if (lit) ui.Glow(name + " glow", Scaled(rect, 1.7f), SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .55f), hit.transform, reducedMotion ? 0 : HaloSeconds);
            if (guardian)
            {
                ui.Glow(name + " light", Scaled(rect, 1.9f), new Color(189 / 255f, 243 / 255f, 1, .5f), hit.transform);
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
                RealmPiece(name + " node", lit ? SkinSlots.MapNodeCurrent : done ? SkinSlots.MapNodeDone : open ? SkinSlots.MapNodeOpen : SkinSlots.MapNodeLocked,
                    rect, hit.transform);
                if (open || done)
                    ui.Label(name + " number", Number(value.Realm, trial.Level), rect, size * .37f / d, SkinTokens.Text, hit.transform,
                        SkinUi.Type.Display).textWrappingMode = TextWrappingModes.NoWrap;
                else Tinted(name + " lock", SkinSlots.IconLock, Scaled(rect, .46f), SkinTokens.TextMuted, hit.transform);
            }
            if (starred)
                for (int i = 0; i < 3; i++)
                    ui.Star(name + " star " + (i + 1), new Rect(stars.x + i * star * 1.05f, stars.y + (i == 1 ? .18f * star : 0), star, star), i < trial.Stars,
                        hit.transform);
            actions.Wire(button, new PageAction { Name = name, Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open }, fade: false);
        }
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

        // A realm that is not open yet: its guardian, why the path is waiting and
        // the way forward (back to the realm before, or the store's purchase).
        private void Waiting(CampaignPageView value, PageCatalog.RealmPage realm, string[] notices)
        {
            float d = ui.Density;
            foreach (var notice in notices) column.Note("Notice", notice);
            // Below 780 dp of safe height (the spec's compact phones) the guardian
            // and the spacing shrink so the way forward stays on screen.
            bool compact = shell.SafeArea.height / d < 780;
            column.Gap(compact ? 8 : 37);
            column.Medallion("Waiting guardian", ui.Art.Sprite("boss__portrait"), compact ? 112 : 158, compact ? 16 : 41);
            // The panel is at least 255 dp tall, as drawn, except on a compact phone.
            float panelTop = compact ? float.PositiveInfinity : column.Top;
            var card = column.Card("Waiting card", null, 24, 24, 24);
            var lockRect = card.Take(48 * d, 15);
            Tinted("Waiting lock", SkinSlots.IconLock, new Rect(lockRect.center.x - 24 * d, lockRect.y, 48 * d, 48 * d), SkinTokens.TextMuted, card.Parent);
            card.Typed("Waiting title", "The path is waiting", SkinUi.Type.Title, 26, SkinTokens.Text, 20);
            card.Typed("Waiting reason", value.Locked, SkinUi.Type.Caption, 17, SkinTokens.Text, 0, TextAlignmentOptions.Left);
            card.Top = Mathf.Min(card.Top, panelTop - (255 - 24) * d);
            column = card.End(compact ? 16 : value.StoreProblem != null ? 24 : value.Purchase != null ? 28 : 58);
            if (value.StoreProblem != null)
            {
                column.Typed("Store problem", value.StoreProblem, SkinUi.Type.Caption, 18, SkinTokens.Negative, 8);
                column.Typed("Store problem help", "Check your connection and try again.", SkinUi.Type.Caption, 14, SkinTokens.TextMuted, compact ? 16 : 24);
            }
            var buttons = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top);
            if (value.Purchase != null)
            {
                Pill(buttons, value.Purchase, true, null, value.Restore == null ? 0 : 20);
                Pill(buttons, value.Restore, false, null, 0);
            }
            else if (value.Previous != null && value.Previous.Enabled)
            {
                var before = catalog.Realm((byte)(value.Realm - 1));
                Pill(buttons, new PageAction { Name = "Return", Label = "Return to " + before.realmName, CanInvoke = () => value.Previous.Available,
                    Invoke = value.Previous.Invoke }, true, null, 0);
            }
            column = new PageColumn(ui, shell.Page, actions, column.Left, column.Width, buttons.Top);
        }

        // The level preview over the dimmed map: the guardian leans on the dialog's
        // rail and states its rule, then the level, its goals in plain words, the
        // moves and Play. Progress shows only once there is some, so a new level
        // shows its targets.
        // The first visit to a realm: over the dimmed map the guardian greets the
        // player with its line and its rule. A tap anywhere continues.
        private void Greeting(byte realmId, PageCatalog.RealmPage realm)
        {
            float d = ui.Density; var safe = shell.SafeArea;
            var root = Holder("Guardian greeting", shell.ScreenArea, shell.Chrome);
            var scrim = ui.Rect<Image>("Greeting scrim", shell.ScreenArea, root);
            scrim.color = ui.Art.Token(SkinTokens.Scrim); scrim.raycastTarget = true;
            // The talk box (.talkbox) spans the column, its bottom 30u and a gap over the column's foot.
            var kit = new ScreenKit(ui, null, shell.ScreenArea, safe);
            float width = kit.Width, left = safe.center.x - width / 2;
            // The passage line first on a realm opened by beating the guardian
            // before it, then the greeting with the rule and what its bonus does.
            var pages = TalkPage.MapGreeting(realm, catalog.Rule(realmId), realmId > 1);
            GuardianTalk talk = null;
            // The talk scene takes the whole screen, as the wireframe draws it: the tab bar waits under it.
            var tabs = shell.Chrome.GetComponentInChildren<SkinTabBar>();
            if (tabs != null) tabs.gameObject.SetActive(false);
            var box = Speak("Guardian greeting talk", root, left, safe.center.y, width, realm, pages, () => {
                Greetings.Greet(realmId);
                if (tabs != null) tabs.gameObject.SetActive(true);
                if (root != null) { root.gameObject.SetActive(false); Destroy(root.gameObject); }
            }, true);
            talk = root.GetComponentInChildren<GuardianTalk>();
            // The guardian stays under the page's edge.
            float lift = Mathf.Min(kit.Bottom + 40 * kit.U - box.y, kit.Edge - SkinUi.ScreenRect(Guardian(root).rectTransform).yMax);
            foreach (Transform piece in root) if (piece != scrim.transform) ((RectTransform)piece).anchoredPosition += new Vector2(0, lift);
            box.y += lift;
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
            var tap = scrim.gameObject.AddComponent<Button>(); tap.transition = Selectable.Transition.None;
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

        // A card in the overlay just above a height, for notices on the map.
        private void Float(string name, float bottom, Action<PageColumn> fill)
        {
            float d = ui.Density; var safe = shell.SafeArea;
            var holder = Holder(name, shell.ScreenArea, shell.Overlay);
            float width = Mathf.Min(safe.width - 2 * GutterDp * d, ColumnDp * d), left = safe.center.x - width / 2;
            var outer = new PageColumn(ui, holder, actions, left, width, shell.ScreenArea.height);
            var card = outer.Card(name + " card");
            fill(card);
            card.End(0);
            holder.anchoredPosition += new Vector2(0, bottom - outer.Top);
        }
    }
}
