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
        public const float TalkBustDp = 180, TalkMinimumDp = 116, TalkWidthDp = 368;
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
            float d = ui.Density; var screen = shell.ScreenArea; var safe = shell.SafeArea;
            int count = value.Trials.Length;
            int focus = previewLevel > 0 ? previewLevel - 1 : Array.FindIndex(value.Trials, trial => trial.Playing);
            if (focus < 0) focus = Array.FindIndex(value.Trials, trial => trial.Available && trial.Stars == 0);
            if (focus < 0) focus = Math.Max(0, Array.FindLastIndex(value.Trials, trial => trial.Available || trial.Stars > 0));
            // The band between the header and the Play button, the same on the map
            // and under its preview.
            float top = safe.yMax - 84 * d, floor = PlayRect().yMax + 16 * d;
            float band = Band(realm, index => NodeSize(value.Trials[index], index == count - 1, index == focus), screen.width, top - floor);
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
                // The path scrolls under the header, so a band keeps the title clear.
                reveal = At(focus).y;
                var shade = ui.Rect<Image>("Header band", Rect.MinMaxRect(screen.x, top - 8 * d, screen.xMax, screen.yMax), shell.Overlay);
                shade.color = SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Scrim), .75f); shade.raycastTarget = false;
                shade.transform.SetAsFirstSibling();
            }
            return focus;
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
        private void Level(LevelPageView value, CampaignPageView map, string[] notices)
        {
            Map(map, value.Level);
            reveal = null;
            var scrim = ui.Rect<Image>("Level scrim", shell.ScreenArea, shell.Page);
            scrim.color = ui.Art.Token(SkinTokens.Scrim); scrim.raycastTarget = true;
            var realm = catalog.Realm(value.Realm);
            float mapBottom = column.Top;
            Dialog("Level", value.Back, (card, rail) => {
                // The guardian's own level has its trial line; the others its encouragement.
                var talk = Talk(card.Parent, new Rect(card.Left - 24 * ui.Density, 0, card.Width + 48 * ui.Density, 0), rail, "boss__idle", realm,
                    value.Level == Protocol.CampaignTargets.Length ? realm.guardianLines.trialIntro : realm.guardianLines.encouragement, catalog.Rule(value.Realm));
                card.Top = talk.y - 45 * ui.Density;
                foreach (var notice in notices) card.Note("Notice", notice);
                Title(card, "Level " + Number(value.Realm, value.Level), 30);
                card.Typed("Level realm", realm.realmName + " · " + realm.guardianName, SkinUi.Type.Caption, 12, SkinTokens.TextMuted, 18);
                var goals = value.Goals;
                Goal(card, "Score goal", "Score", goals.Points.ToString("N0", CultureInfo.InvariantCulture), false);
                Goal(card, "Primary goal", catalog.ObjectiveName(goals.PrimaryKind, goals.PrimaryValue, goals.PrimaryCount), goals.PrimaryCount.ToString(CultureInfo.InvariantCulture), false);
                Goal(card, "Secondary goal", catalog.ObjectiveName(goals.SecondaryKind, goals.SecondaryValue, goals.SecondaryCount), null, false);
                card.Gap(8.5f);
                card.Typed("Level moves", value.Moves + " moves", SkinUi.Type.Number, 20, SkinTokens.Accent, 25);
                if (!string.IsNullOrEmpty(value.Notice)) card.Typed("Level notice", value.Notice, SkinUi.Type.Body, 15, SkinTokens.Text, 12);
                Pill(card, value.Play, true, null, 0);
            });
            // The scrim dims the whole map, however far the dialog scrolls.
            float bottom = Mathf.Min(mapBottom, column.Top) - 16 * ui.Density;
            SkinUi.Place(scrim.rectTransform, Rect.MinMaxRect(shell.ScreenArea.x, bottom, shell.ScreenArea.xMax, shell.ScreenArea.yMax), shell.Page);
            column = new PageColumn(ui, shell.Page, actions, column.Left, column.Width, bottom + 16 * ui.Density);
        }
        // A goal row: a star socket (lit once met), the goal in words and its value.
        private void Goal(PageColumn card, string name, string label, string number, bool met)
        {
            float d = ui.Density;
            var rows = new PageColumn(ui, card.Parent, actions, card.Left - 10 * d, card.Width + 20 * d, card.Top);
            float numberWidth = number == null ? 0 : ui.TextWidth(number, 18, SkinUi.Type.Number);
            float height = Mathf.Max(PageColumn.RowDp * d, ui.TextHeight(label, rows.Width - 64 * d - numberWidth, 15, SkinUi.Type.Caption) + 16 * d);
            var rect = rows.Take(height, 8);
            ui.Piece(name + " row", SkinSlots.ListRow, rect, card.Parent);
            ui.Star(name + " star", new Rect(rect.x + 10 * d, rect.center.y - 10 * d, 20 * d, 20 * d), met, card.Parent);
            ui.Label(name + " label", label, new Rect(rect.x + 44 * d, rect.y, rect.width - 60 * d - numberWidth, rect.height), 15,
                SkinTokens.Text, card.Parent, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            if (number != null)
                ui.Label(name, number, new Rect(rect.xMax - 13 * d - numberWidth, rect.y, numberWidth, rect.height), 18,
                    met ? SkinTokens.Positive : SkinTokens.Score, card.Parent, SkinUi.Type.Number, TextAlignmentOptions.Right);
            card.Top = rows.Top;
        }
        // A dialog title in Fraunces over its light stroke.
        private void Title(PageColumn card, string text, float sizeDp)
        {
            float d = ui.Density;
            card.Typed("Dialog title", text, SkinUi.Type.Title, sizeDp, SkinTokens.Text, 1.5f);
            var stroke = card.Take(7 * d, 0);
            ui.Piece(text + " stroke", SkinSlots.TitleRibbon, new Rect(stroke.center.x - 75 * d, stroke.y, 150 * d, 7 * d), card.Parent);
        }

        // A column-wide dialog whose top is the talk box's rail, laid out by fill
        // and centred with its bust in the safe area; on a short screen it starts
        // at the top and the page scrolls. fill receives the dialog's inner column
        // and the rail's height. The page column continues under the dialog.
        // Unless motion is reduced, the dialog opens: it scales from 0.92 with a
        // light overshoot while one spark traces its top rim, then the guardian
        // rises onto the rail. The returned sequence (null under reduced motion)
        // carries any further entrance.
        private PageSequence Dialog(string name, PageAction close, Action<PageColumn, float> fill)
        {
            float d = ui.Density; var safe = shell.SafeArea;
            var holder = Holder(name, shell.ScreenArea, shell.Page);
            float width = Mathf.Min(safe.width - 2 * GutterDp * d, ColumnDp * d) - 8 * d, left = safe.center.x - width / 2;
            float rail = shell.ScreenArea.yMax - (TalkBustDp - 30) * d;
            var outer = new PageColumn(ui, holder, actions, left, width, rail);
            var card = outer.Card(name + " dialog", null, 24, 0, 12);
            fill(card, rail);
            card.End(0);
            // The dialog art sits behind everything the fill drew.
            var dialog = holder.GetComponentsInChildren<Image>().First(image => image.name == name + " dialog");
            dialog.sprite = ui.Art.SkinUi(SkinSlots.Dialog);
            dialog.transform.SetSiblingIndex(0);
            holder.Find("Talk bust")?.SetSiblingIndex(0);
            if (close != null)
                HeaderButton(close, new Rect(left + width - IconDp * d, rail + 9 * d, IconDp * d, IconDp * d), SkinSlots.IconClose, false, holder);
            float height = (TalkBustDp - 30) * d + rail - outer.Top, room = safe.height - 16 * d;
            float top = height < room ? safe.yMax - 8 * d - (room - height) / 2 : safe.yMax - 8 * d;
            float shift = top - (rail + (TalkBustDp - 30) * d);
            holder.anchoredPosition += new Vector2(0, shift);
            column = new PageColumn(ui, shell.Page, actions, left, width, outer.Top + shift);
            if (reducedMotion) return null;
            var sequence = holder.gameObject.AddComponent<PageSequence>();
            var placed = holder.anchoredPosition;
            var frame = SkinUi.ScreenRect(dialog.rectTransform);
            sequence.Add(0, .24f, t => PageSequence.ScaleAbout(holder, placed, frame.center, Mathf.LerpUnclamped(.92f, 1, PageSequence.EaseOutBack(t))));
            var spark = ui.Piece(name + " spark", SkinSlots.FxSpark1, new Rect(frame.x, frame.yMax - 9 * d, 18 * d, 18 * d), holder);
            var sparkAt = spark.rectTransform.anchoredPosition;
            sequence.Add(.05f, .4f, t => {
                spark.rectTransform.anchoredPosition = sparkAt + new Vector2((frame.width - 18 * d) * PageSequence.EaseOut(t), 0);
                spark.color = SkinUi.WithAlpha(Color.white, Mathf.Sin(t * Mathf.PI));
            });
            foreach (var piece in new[] { holder.Find("Talk bust"), holder.Find("Talk paws") })
            {
                if (piece == null) continue;
                var rect = (RectTransform)piece; var image = rect.GetComponent<Image>(); var at = rect.anchoredPosition;
                sequence.Add(.24f, .3f, t => {
                    rect.anchoredPosition = at - new Vector2(0, 24 * d * (1 - PageSequence.EaseOut(t)));
                    image.color = SkinUi.WithAlpha(image.color, PageSequence.EaseOut(t));
                });
            }
            return sequence;
        }

        // The first visit to a realm: over the dimmed map the guardian greets the
        // player with its line and its rule. A tap anywhere continues.
        private void Greeting(byte realmId, PageCatalog.RealmPage realm)
        {
            float d = ui.Density; var safe = shell.SafeArea;
            var root = Holder("Guardian greeting", shell.ScreenArea, shell.Chrome);
            var scrim = ui.Rect<Image>("Greeting scrim", shell.ScreenArea, root);
            scrim.color = ui.Art.Token(SkinTokens.Scrim); scrim.raycastTarget = true;
            float width = Mathf.Min(safe.width - 2 * GutterDp * d, ColumnDp * d) - 8 * d, left = safe.center.x - width / 2;
            var box = Talk(root, new Rect(left, 0, width, 0), safe.center.y + 15 * d, "boss__greeting", realm, realm.guardianLines.greeting, catalog.Rule(realmId));
            // A long greeting lifts so it and its prompt stay above the tab bar, and
            // the guardian stays under the top of the safe area.
            float lift = Mathf.Min(Mathf.Max(0, ui.TabBarRect(safe).yMax + 16 * d - (box.y - 60 * d)),
                safe.yMax - (box.yMax + (TalkBustDp - 30) * d));
            if (lift > 0) { foreach (Transform piece in root) if (piece != scrim.transform) ((RectTransform)piece).anchoredPosition += new Vector2(0, lift); box.y += lift; }
            ui.Label("Greeting continue", "Tap to continue", Measured("Tap to continue", SkinUi.Type.Caption, 13, safe.center.x, box.y - 42 * d), 13, SkinTokens.TextMuted, root,
                SkinUi.Type.Caption);
            if (!reducedMotion)
            {
                // The scrim fades in, then the guardian rises onto the rail.
                var group = root.gameObject.AddComponent<CanvasGroup>();
                var sequence = root.gameObject.AddComponent<PageSequence>();
                sequence.Add(0, .15f, t => group.alpha = t);
                foreach (var piece in new[] { root.Find("Talk bust"), root.Find("Talk paws") })
                {
                    var rect = (RectTransform)piece; var at = rect.anchoredPosition;
                    sequence.Add(.1f, .3f, t => rect.anchoredPosition = at - new Vector2(0, 24 * d * (1 - PageSequence.EaseOut(t))));
                }
            }
            var tap = scrim.gameObject.AddComponent<Button>(); tap.transition = Selectable.Transition.None;
            tap.onClick.AddListener(() => { Greetings.Greet(realmId); if (root != null) { root.gameObject.SetActive(false); Destroy(root.gameObject); } });
            scrim.name = "Continue";
        }

        // The guardian's talk scene: the guardian leaning on the dialogue box's
        // rail (its body behind the box, its paws in front of the rail, placed by
        // the guardian's own rail line), the name and line, and optionally the
        // guardian's rule with what its bonus does. This is the footprint the talk
        // scene component fills; until it lands a still frame holds its place.
        // area gives the box's x and width; the rail is the box's top. Returns the
        // box.
        private Rect Talk(Transform parent, Rect area, float rail, string frame, PageCatalog.RealmPage realm, string line, PageCatalog.GuardianRule rule)
        {
            float d = ui.Density, size = TalkBustDp * d;
            var bust = new Rect(area.center.x - size / 2, rail - (1 - ui.Art.GuardianRailY) * size, size, size);
            var figure = ui.Rect<Image>("Talk bust", bust, parent);
            figure.sprite = ui.Art.Sprite(frame); figure.preserveAspect = true; figure.raycastTarget = false;
            var text = new PageColumn(ui, parent, actions, area.x + 20 * d, area.width - 40 * d, rail - 19 * d);
            int first = parent.childCount;
            text.Typed("Talk name", realm.guardianName, SkinUi.Type.Title, 17, SkinTokens.Accent, 0, TextAlignmentOptions.Left);
            text.Typed("Talk title", realm.guardianTitle, SkinUi.Type.Caption, 12, SkinTokens.TextMuted, line == null ? 14 : 8, TextAlignmentOptions.Left);
            if (line != null) text.Typed("Talk line", line, SkinUi.Type.Caption, 16, SkinTokens.Text, rule == null ? 0 : 22, TextAlignmentOptions.Left);
            if (rule != null)
            {
                text.Typed("Talk rule heading", "EARN " + rule.name.ToUpperInvariant(), SkinUi.Type.Label, 11, SkinTokens.Accent, 3, TextAlignmentOptions.Left);
                text.Typed("Talk rule", rule.description, SkinUi.Type.Caption, 13, SkinTokens.Text, 2, TextAlignmentOptions.Left);
                text.Typed("Talk bonus", rule.effect, SkinUi.Type.Caption, 12, SkinTokens.TextMuted, 0, TextAlignmentOptions.Left);
            }
            float bottom = Mathf.Min(rail - TalkMinimumDp * d, text.Top - 16 * d);
            var box = new Rect(area.x, bottom, area.width, rail - bottom);
            var dialog = ui.Piece("Talk box", SkinSlots.Dialog, box, parent);
            dialog.transform.SetSiblingIndex(first);
            var ledge = ui.Rect<Image>("Talk rail", new Rect(area.x - 2 * d, rail - 14 * d, area.width + 4 * d, 14 * d), parent);
            ledge.sprite = ui.Art.SkinRealm(SkinSlots.Ledge); ledge.raycastTarget = false;
            if (ledge.sprite.border != Vector4.zero) { ledge.type = Image.Type.Sliced; ledge.pixelsPerUnitMultiplier = 1 / ui.Ui; }
            ledge.transform.SetSiblingIndex(first + 1);
            var paws = ui.Rect<Image>("Talk paws", bust, parent);
            paws.sprite = ui.Art.Sprite("boss__paws"); paws.preserveAspect = true; paws.raycastTarget = false;
            paws.transform.SetSiblingIndex(first + 2);
            return box;
        }

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
