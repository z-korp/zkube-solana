using System;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The Campaign pages: the realm map, a realm that is not open yet, the level
    // preview and the guardian's first greeting, and the talk-scene footprint
    // they share with the results.
    public sealed partial class PageViews
    {
        public GuardianGreetings Greetings { get; set; } = GuardianGreetings.Device();

        // The map, as the v3 composites draw it: the realm's painting behind the
        // header card (the realm, "Realm N of 10" and its stars), the authored
        // path fitted into the room between the header and Play in a 60 x 100
        // box ("meet", no scroll) with S-curve edges, the glowstone medallions
        // and the guardian 1.6 times their size, each finished node's stars under
        // it, the current node breathing, and "Play level N" above the tabs.
        private void Campaign(CampaignPageView value, string[] notices)
        {
            var realm = catalog.Realm(value.Realm);
            if (value.Locked != null) { Waiting(value, realm, notices); return; }
            var kit = Kit; float d = ui.Density, u = kit.U;
            var trial = value.Trials[Focus(value.Trials, 0)];
            var play = new PageAction { Name = "Play level", Label = (trial.Playing ? "Resume level " : "Play level ") + Number(value.Realm, trial.Level),
                Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open };
            var buttons = Buttons((play, true, SkinSlots.IconPlay));
            var playRect = new Rect(kit.Safe.center.x - kit.Width / 2, kit.Safe.y + (kit.K > .95f ? 16 : 10) * d, kit.Width, buttons.Height);
            // The header is drawn over the map, so the guardian's glow passes under it.
            float header = MapHeaderHeight(kit);
            Map(value, Rect.MinMaxRect(kit.Safe.xMin, playRect.yMax + 10 * u, kit.Safe.xMax, kit.Safe.yMax - 4 * d - header - 10 * u));
            MapHeader(value, kit, header);
            buttons.Draw(playRect);
            column = new PageColumn(ui, shell.Page, actions, playRect.x, playRect.width, playRect.y);
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
            return new Rect(safe.center.x - width / 2, ui.TabBarRect(safe).yMax + 20 * d, width, PageColumn.ButtonDp * d);
        }

        // The header card: Previous, the realm and its place, its stars and Next.
        private float MapHeaderHeight(ScreenKit kit) => Mathf.Max(64 * kit.U, IconDp * ui.Density + 12 * kit.U);
        private void MapHeader(CampaignPageView value, ScreenKit kit, float height)
        {
            float d = ui.Density, u = kit.U, k = kit.K, icon = IconDp * d;
            string name = catalog.Realm(value.Realm).realmName, place = "Realm " + value.Realm + " of " + Protocol.Realms.Length;
            string total = "/" + Protocol.CampaignTargets.Length * 3;
            var card = new Rect(kit.Safe.center.x - kit.Width / 2, kit.Safe.yMax - 4 * d - height, kit.Width, height);
            ui.Piece("Map header", SkinSlots.Card, card, shell.Page);
            float left = card.x + 8 * u, right = card.xMax - 8 * u;
            if (value.Previous != null && value.Previous.Enabled)
            {
                HeaderButton(value.Previous, new Rect(left, card.center.y - icon / 2, icon, icon), SkinSlots.IconBack, false); left += icon + 10 * u;
            }
            else left += 6 * u;
            if (value.Next != null && value.Next.Enabled)
            {
                HeaderButton(value.Next, new Rect(right - icon, card.center.y - icon / 2, icon, icon), SkinSlots.IconBack, true); right -= icon + 10 * u;
            }
            string stars = value.Stars + "<color=#" + ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted)) + ">" + total + "</color>";
            float starsWidth = kit.NumeralWidth(value.Stars + total);
            kit.Numeral("Map stars", stars, new Rect(right - starsWidth, card.y, starsWidth, card.height));
            right -= starsWidth + 6 * u;
            ui.Piece("Map stars icon", SkinSlots.IconCampaign, new Rect(right - 28 * u, card.center.y - 14 * u, 28 * u, 28 * u), shell.Page);
            right -= 28 * u + 10 * u;
            float titleDp = 28 * k, placeDp = Mathf.Max(12, 13 * k), width = right - left;
            float titleHeight = ui.TextHeight(name, width, titleDp, SkinUi.Type.Display), placeHeight = ui.TextHeight(place, width, placeDp, SkinUi.Type.Caption);
            float top = card.center.y + (titleHeight + placeHeight) / 2;
            ui.Label("Map title", name, new Rect(left, top - titleHeight, width, titleHeight), titleDp, SkinTokens.Text, shell.Page, SkinUi.Type.Display,
                TextAlignmentOptions.Left);
            ui.Label("Map place", place, new Rect(left, top - titleHeight - placeHeight, width, placeHeight), placeDp, SkinTokens.TextMuted, shell.Page,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
        }

        // The map's geometry in the 60 x 100 box: node radii and star sizes,
        // as the wireframe draws them. Sizes follow the box, so every realm's
        // clearance holds at any fitted size.
        public const float NodeRadius = 3.77f, CurrentRadius = 4.25f, GuardianRadius = 6.13f, StarSize = 2.36f, GuardianStarSize = 2.9f, StarGap = .3f;
        // The box fitted into room, as SVG's "xMidYMid meet" places a 60 x 100 view box.
        public static Rect MapBox(Rect room)
        {
            float scale = Mathf.Min(room.width / 60, room.height / 100);
            return new Rect(room.center.x - 30 * scale, room.center.y - 50 * scale, 60 * scale, 100 * scale);
        }
        public static Vector2 MapPoint(Rect box, PageCatalog.Point point) => new Vector2(box.x + point.x * box.width, box.yMax - point.y * box.height);

        // The painting, the path and the nodes in the room between the header and Play.
        private void Map(CampaignPageView value, Rect room)
        {
            var realm = catalog.Realm(value.Realm);
            var screen = shell.ScreenArea;
            int count = value.Trials.Length, focus = Focus(value.Trials, 0);
            // The painting covers the screen with its lower part in view, as CSS's "center 80%".
            var art = ui.Art.SkinRealm(SkinSlots.Map);
            float aspect = art.rect.width / art.rect.height, height = Mathf.Max(screen.height, screen.width / aspect), width = height * aspect;
            float top = screen.yMax + (height - screen.height) * .8f;
            var image = ui.Rect<Image>("Realm map", new Rect(screen.center.x - width / 2, top - height, width, height), shell.Page);
            image.sprite = art; image.raycastTarget = false;
            var box = MapBox(room); float unit = box.width / 60;
            var states = value.Trials.Select((trial, index) => trial.Playing ? "playing" :
                trial.Stars > 0 ? "cleared" : trial.Available ? "current" : "locked").ToArray();
            var line = ui.Rect<CampaignPathGraphic>("Lit path", box, shell.Page);
            var gold = new Color(1, 233 / 255f, 168 / 255f, 1); var moon = new Color(221 / 255f, 239 / 255f, 247 / 255f, 1);
            line.Configure(realm, states, new PageCatalog.PathStyle { pathStyle = "solid", strokeWidth = .7f, lockedStrokeWidth = .45f, lockedDash = ".5 1.4",
                clearedRgba = new[] { gold.r, gold.g, gold.b, 1f }, activeRgba = new[] { gold.r, gold.g, gold.b, 1f }, lockedRgba = new[] { moon.r, moon.g, moon.b, 1.2f } });
            for (int index = 0; index < count; index++)
                Node(value, value.Trials[index], MapPoint(box, realm.campaignPath[index]), unit, index == count - 1, index == focus);
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

        // One level. Locked: dark stone with a lock. Open or finished: the
        // glowstone with its number, a finished one with its three stars under
        // it. Current: larger, breathing. The guardian: its portrait in the
        // portal ring with a soft halo, dimmed with a lock until it opens, its
        // stars always under it. The touch area covers the node and its stars,
        // at least 48 dp.
        private void Node(CampaignPageView value, CampaignTrialView trial, Vector2 center, float unit, bool guardian, bool current)
        {
            float d = ui.Density;
            string name = "Trial " + trial.Level;
            bool done = trial.Stars > 0, open = trial.Available, lit = current && open;
            float size = 2 * unit * (guardian ? GuardianRadius : lit ? CurrentRadius : NodeRadius);
            var rect = new Rect(center.x - size / 2, center.y - size / 2, size, size);
            float star = unit * (guardian ? GuardianStarSize : StarSize);
            bool starred = done || guardian;
            var stars = new Rect(center.x - 1.5f * star * 1.05f, rect.y - StarGap * unit - star * 1.18f, 3 * star * 1.05f, star * 1.18f);
            var area = starred ? Rect.MinMaxRect(Mathf.Min(rect.xMin, stars.xMin), stars.yMin, Mathf.Max(rect.xMax, stars.xMax), rect.yMax) : rect;
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
                ui.Piece(name + " ring", SkinSlots.MapNodeGuardian, rect, hit.transform);
                if (!open && !done)
                {
                    portrait.color = new Color(.45f, .45f, .45f, 1);
                    Tinted(name + " lock", SkinSlots.IconLock, new Rect(rect.xMax - .36f * size, rect.y + .03f * size, .3f * size, .3f * size), SkinTokens.Text,
                        hit.transform);
                }
            }
            else
            {
                ui.Piece(name + " node", done && !lit ? SkinSlots.MapNodeDone : open ? SkinSlots.MapNodeOpen : SkinSlots.MapNodeLocked, rect, hit.transform);
                if (open || done)
                    ui.Label(name + " number", Number(value.Realm, trial.Level), rect, unit * (lit ? 3.2f : 2.8f) / d, SkinTokens.Text, hit.transform,
                        SkinUi.Type.Display).textWrappingMode = TextWrappingModes.NoWrap;
                else Tinted(name + " lock", SkinSlots.IconLock, Scaled(rect, .46f), SkinTokens.TextMuted, hit.transform);
            }
            if (starred)
                for (int i = 0; i < 3; i++)
                    ui.Star(name + " star " + (i + 1), new Rect(stars.x + i * star * 1.05f, stars.y + (i == 1 ? .18f * star : 0), star, star), i < trial.Stars,
                        hit.transform);
            actions.Wire(button, new PageAction { Name = name, Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open }, fade: false);
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
            float width = Mathf.Min(safe.width - 2 * GutterDp * d, ColumnDp * d) - 8 * d, left = safe.center.x - width / 2;
            // The passage line first on a realm opened by beating the guardian
            // before it, then the greeting with the rule and what its bonus does.
            var pages = TalkPage.MapGreeting(realm, catalog.Rule(realmId), realmId > 1);
            Explained(pages[pages.Length - 1], realmId);
            GuardianTalk talk = null;
            var box = Speak("Guardian greeting talk", root, left, safe.center.y + 15 * d, width, realm, pages,
                () => { Greetings.Greet(realmId); if (root != null) { root.gameObject.SetActive(false); Destroy(root.gameObject); } }, true);
            talk = root.GetComponentInChildren<GuardianTalk>();
            // A long greeting lifts so it and its prompt stay above the tab bar, and
            // the guardian stays under the top of the safe area.
            float lift = Mathf.Min(Mathf.Max(0, ui.TabBarRect(safe).yMax + 16 * d - (box.y - 60 * d)),
                safe.yMax - SkinUi.ScreenRect(Guardian(root).rectTransform).yMax);
            if (lift > 0) { foreach (Transform piece in root) if (piece != scrim.transform) ((RectTransform)piece).anchoredPosition += new Vector2(0, lift); box.y += lift; }
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
            var talk = ui.Talk(name, x, rail, width, realm, pages, finished, parent, hint);
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
        private TalkPage Explained(TalkPage page, byte realm)
        {
            var rule = catalog.Rule(realm);
            page.RuleHeading = HudLayout.GuardianCaption(rule.bonus); page.Rule = rule.description + "\n" + rule.effect;
            return page;
        }
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
