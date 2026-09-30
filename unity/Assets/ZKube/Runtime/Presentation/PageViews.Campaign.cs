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
        private static readonly float[] NodeSizes = { 52, 56, 70, 88 };
        public GuardianGreetings Greetings { get; set; } = GuardianGreetings.Device();

        // The map: the realm's painting under the header, the client-drawn path
        // and nodes between the header and the Play button, which repeats the
        // current level's action above the tab bar. The path fits that band and
        // scrolls only when its nodes would crowd.
        private void Campaign(CampaignPageView value, string[] notices)
        {
            var realm = catalog.Realm(value.Realm);
            if (value.Locked != null) { Waiting(value, realm, notices); return; }
            int focus = Map(value, 0);
            float d = ui.Density;
            var trial = value.Trials[focus];
            var play = new PageAction { Name = "Play level", Label = (trial.Playing ? "Resume · Level " : "Play · Level ") + Number(value.Realm, trial.Level),
                Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open };
            var bottom = new PageColumn(ui, shell.Overlay, actions, PlayRect().x, PlayRect().width, PlayRect().yMax);
            Pill(bottom, play, true, null, 0);
            var lines = notices.Concat(new[] { value.Notice, value.SavedRun }).Where(text => !string.IsNullOrEmpty(text)).ToArray();
            var buttons = new[] { value.Resume, value.Result }.Where(action => action != null).ToArray();
            if (lines.Length != 0 || buttons.Length != 0)
                Float("Campaign notice", PlayRect().yMax + 12 * d, card => {
                    foreach (var line in lines) card.Typed("Campaign notice text", line, SkinUi.Type.Body, 15, SkinTokens.Text, 8);
                    for (int i = 0; i < buttons.Length; i++) card.Button(buttons[i], false, i == buttons.Length - 1 ? 0 : 10);
                });
            if (!Greetings.Greeted(value.Realm)) Greeting(value.Realm, realm);
        }
        // The fixed Play button: 320 dp wide, 20 dp above the tab bar.
        private Rect PlayRect()
        {
            float d = ui.Density; var safe = shell.SafeArea;
            float width = Mathf.Min(320 * d, safe.width - 2 * (GutterDp + 24) * d);
            return new Rect(safe.center.x - width / 2, ui.TabBarRect(safe).yMax + 20 * d, width, PageColumn.ButtonDp * d);
        }

        // Draws the painting, path and nodes and returns the index of the current
        // level: the run in progress, else the first open level without stars,
        // else the furthest open one. A preview passes its level, which is drawn
        // as the current node.
        private int Map(CampaignPageView value, byte previewLevel)
        {
            var realm = catalog.Realm(value.Realm);
            float d = ui.Density; var screen = shell.ScreenArea;
            int count = value.Trials.Length;
            int focus = Focus(value, previewLevel);
            // The band between the header and the Play button, the same on the map
            // and under its preview.
            float top = shell.SafeArea.yMax - MapHeader(value), floor = PlayRect().yMax + 16 * d;
            float band = MapBand(value, focus, top - floor);
            var path = new Rect(screen.x, top - band, screen.width, band);
            var art = ui.Art.SkinRealm(SkinSlots.Map);
            float height = Mathf.Max(screen.width * art.rect.height / art.rect.width, screen.yMax - (path.y - (floor - screen.y)));
            var image = ui.Rect<Image>("Realm map", new Rect(screen.x, screen.yMax - height, screen.width, height), shell.Page);
            image.sprite = art; image.raycastTarget = false;
            column = new PageColumn(ui, shell.Page, actions, screen.x, screen.width, path.y - (floor - screen.y) + 16 * d);
            Vector2 At(int index)
            {
                var point = realm.campaignPath[index];
                return new Vector2(path.x + point.x * path.width, path.yMax - point.y * path.height);
            }
            var states = value.Trials.Select((trial, index) => trial.Playing || previewLevel > 0 && index == focus ? "playing" :
                trial.Stars > 0 ? "cleared" : trial.Available ? "current" : "locked").ToArray();
            Path(realm, path, states, index => NodeSize(value.Trials[index], index == count - 1, index == focus) / 2 + 6 * d, At);
            for (int index = 0; index < count; index++)
                Node(value, value.Trials[index], At(index), index == count - 1, index == focus);
            if (band > top - floor && previewLevel == 0)
            {
                // A path that scrolls stops at the header (the page is clipped
                // there), and the header sits on a dark band over the painting.
                reveal = At(focus).y;
                var shade = ui.Rect<Image>("Header band", Rect.MinMaxRect(screen.x, top, screen.xMax, screen.yMax), shell.Overlay);
                shade.color = SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Scrim), .75f); shade.raycastTarget = false;
                shade.transform.SetAsFirstSibling();
            }
            return focus;
        }
        private static int Focus(CampaignPageView value, byte previewLevel)
        {
            int focus = previewLevel > 0 ? previewLevel - 1 : Array.FindIndex(value.Trials, trial => trial.Playing);
            if (focus < 0) focus = Array.FindIndex(value.Trials, trial => trial.Available && trial.Stars == 0);
            if (focus < 0) focus = Math.Max(0, Array.FindLastIndex(value.Trials, trial => trial.Available || trial.Stars > 0));
            return focus;
        }
        private float MapBand(CampaignPageView value, int focus, float room) => Band(catalog.Realm(value.Realm),
            index => NodeSize(value.Trials[index], index == value.Trials.Length - 1, index == focus), shell.ScreenArea.width, room);
        private static string Place(CampaignPageView value) => "REALM " + value.Realm + " / " + Protocol.Realms.Length;
        private static string MapSubtitle(CampaignPageView value) =>
            Place(value) + " · " + value.Stars + " / " + Protocol.CampaignTargets.Length * 3 + " STARS";
        // The map's header: the realm's name over its place and stars.
        private float MapHeader(CampaignPageView value) => Header(catalog.Realm(value.Realm).realmName, MapSubtitle(value));
        // The map scrolls when its path needs more than the room under its header.
        private bool MapScrolls(CampaignPageView value)
        {
            float room = shell.SafeArea.yMax - MapHeader(value) - (PlayRect().yMax + 16 * ui.Density);
            return MapBand(value, Focus(value, 0), room) > room;
        }
        // The band height that keeps every node, with room for what it shows under
        // it, clear of the others and of the band's edges: the room between the
        // header and the Play button, or taller when the path would crowd there.
        private float Band(PageCatalog.RealmPage realm, Func<int, float> size, float width, float room)
        {
            float d = ui.Density, band = room;
            var points = realm.campaignPath;
            float Reach(int index) => size(index) / 2 + 10 * d;
            for (int i = 0; i < points.Length; i++)
            {
                band = Mathf.Max(band, Reach(i) / Mathf.Max(.01f, points[i].y), (Reach(i) + 10 * d) / Mathf.Max(.01f, 1 - points[i].y));
                for (int j = i + 1; j < points.Length; j++)
                {
                    float gap = Reach(i) + Reach(j), dx = Mathf.Abs(points[i].x - points[j].x) * width, dy = Mathf.Abs(points[i].y - points[j].y);
                    if (dx < gap) band = Mathf.Max(band, Mathf.Sqrt(gap * gap - dx * dx) / Mathf.Max(.01f, dy));
                }
            }
            return Mathf.Ceil(band);
        }
        private float NodeSize(CampaignTrialView trial, bool guardian, bool current) =>
            (guardian ? NodeSizes[3] : current && trial.Available ? NodeSizes[2] : trial.Stars > 0 ? NodeSizes[1] : NodeSizes[0]) * ui.Density;

        // The lit path: done segments are solid warm light, those ahead are soft
        // moonstone dots at 40%.
        private void Path(PageCatalog.RealmPage realm, Rect path, string[] states, Func<int, float> clearance, Func<int, Vector2> at)
        {
            float d = ui.Density;
            var line = ui.Rect<CampaignPathGraphic>("Lit path", path, shell.Page);
            var warm = ui.Art.Token(SkinTokens.Accent);
            var style = new PageCatalog.PathStyle { pathStyle = "solid", strokeWidth = 6 * d * 60 / path.width, lockedStrokeWidth = 1, lockedDash = "1 1",
                clearedRgba = new[] { warm.r, warm.g, warm.b, 1f }, activeRgba = new[] { warm.r, warm.g, warm.b, 1f }, lockedRgba = new[] { 0f, 0, 0, 0 } };
            line.Configure(realm, states, style);
            var dot = ui.Art.Token(SkinTokens.Objective); dot.a = .4f;
            for (int i = 0; i + 1 < states.Length; i++)
            {
                if (CampaignPathGraphic.EdgeState(states[i], states[i + 1]) != "locked") continue;
                Vector2 from = at(i), to = at(i + 1);
                int steps = 96; float step = 14 * d, walked = 0; var previous = from;
                for (int k = 1; k <= steps; k++)
                {
                    var next = CampaignPathGraphic.Curve(from, to, k / (float)steps);
                    walked += Vector2.Distance(previous, next); previous = next;
                    if (walked < step) continue;
                    walked = 0;
                    if (Vector2.Distance(next, from) < clearance(i) || Vector2.Distance(next, to) < clearance(i + 1)) continue;
                    var piece = ui.Piece("Path dot " + (i + 1), SkinSlots.FxGlow, new Rect(next.x - 5 * d, next.y - 5 * d, 10 * d, 10 * d), shell.Page);
                    piece.color = dot;
                }
            }
        }

        // One level. Locked: dark stone with a lock and its number beneath. Done:
        // a moonstone orb with its number and three stars on an arc. Current: the
        // larger gold orb with its number and a breathing glow. The guardian: a
        // portal ring around its portrait, dimmed with a lock until it opens, and
        // its name beneath. The touch area covers the node and what it shows.
        private void Node(CampaignPageView value, CampaignTrialView trial, Vector2 center, bool guardian, bool current)
        {
            float d = ui.Density;
            string name = "Trial " + trial.Level, number = Number(value.Realm, trial.Level);
            bool done = trial.Stars > 0, open = trial.Available, lit = current && open;
            float size = NodeSize(trial, guardian, current);
            var rect = new Rect(center.x - size / 2, center.y - size / 2, size, size);
            string below = guardian ? number + " · " + catalog.Realm(value.Realm).guardianName : !open && !done ? number : null;
            var label = below == null ? new Rect(rect.x, rect.y, rect.width, 0) : Measured(below, SkinUi.Type.Caption, 12, center.x, rect.y - 3 * d);
            float star = 15 * d;
            var stars = done ? new Rect(center.x - 1.7f * star, label.y - star - (below == null ? 0 : 2 * d), 3.4f * star, star + 3 * d) : label;
            var area = Union(Union(rect, label), stars);
            float grow = Mathf.Max(0, BoardLayout.MinimumTouchDp * d - area.width) / 2;
            var hit = ui.Rect<Image>(name, new Rect(area.x - 6 * d - grow, area.y - 6 * d, area.width + 12 * d + 2 * grow, area.height + 12 * d), shell.Page);
            hit.color = Color.clear; hit.raycastTarget = true;
            var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
            hit.gameObject.AddComponent<PressSquash>();
            if (lit) ui.Glow(name + " glow", Scaled(rect, 1.7f), SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .55f), hit.transform, HaloSeconds);
            if (guardian)
            {
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
                    Tinted(name + " lock", SkinSlots.IconLock, new Rect(rect.xMax - 26 * d, rect.y + 2 * d, 24 * d, 24 * d), SkinTokens.Text, hit.transform);
                }
            }
            else
            {
                ui.Piece(name + " node", done && !lit ? SkinSlots.MapNodeDone : open ? SkinSlots.MapNodeOpen : SkinSlots.MapNodeLocked, rect, hit.transform);
                if (open || done)
                    ui.Label(name + " number", number, new Rect(rect.x, rect.y + size * .03f, rect.width, rect.height), lit ? 28 : 22,
                        SkinTokens.TextOnPrimary, hit.transform, SkinUi.Type.Number);
                else Tinted(name + " lock", SkinSlots.IconLock, new Rect(center.x - 11 * d, center.y - 11 * d, 22 * d, 22 * d), SkinTokens.TextMuted, hit.transform);
            }
            if (below != null)
            {
                if (guardian) Shade(label, label.width, hit.transform);
                ui.Label(name + " label", below, label, 12, guardian ? SkinTokens.Text : SkinTokens.TextMuted, hit.transform, SkinUi.Type.Caption);
            }
            if (done)
                for (int i = 0; i < 3; i++)
                    ui.Star(name + " star " + (i + 1), new Rect(stars.x + (.2f + i * 1.1f) * star, stars.y + (i == 1 ? 0 : 3 * d), star, star), i < trial.Stars, hit.transform);
            actions.Wire(button, new PageAction { Name = name, Enabled = trial.Available, CanInvoke = trial.CanOpen, Invoke = trial.Open }, fade: false);
        }
        // A one-line label's rectangle, centred on x under a top edge.
        private Rect Measured(string text, SkinUi.Type role, float sizeDp, float x, float top)
        {
            float w = ui.TextWidth(text, sizeDp, role) + 8 * ui.Density, h = ui.TextHeight(text, w, sizeDp, role);
            return new Rect(x - w / 2, top - h, w, h);
        }
        private static Rect Union(Rect a, Rect b) => Rect.MinMaxRect(Mathf.Min(a.xMin, b.xMin), Mathf.Min(a.yMin, b.yMin), Mathf.Max(a.xMax, b.xMax), Mathf.Max(a.yMax, b.yMax));
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
