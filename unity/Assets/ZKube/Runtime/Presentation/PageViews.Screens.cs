using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The composed screens around the board, as the v3 wireframes lay them out:
    // one column from the safe top to the bottom, 12u gutters and 10u between
    // pieces, with spacers sharing the height left over. u follows the screen's
    // height, from 0.8 dp at 640 dp to 1.1 dp at 890 dp and above; a few sizes
    // are drawn in two steps, the Seeker's and the compact phone's.
    public sealed partial class PageViews
    {
        // A piece of a composed screen: its height in pixels, or a spacer, and
        // how it draws into the rect it is given.
        private readonly struct Piece
        {
            public readonly float Height;
            public readonly Action<Rect> Draw;
            public Piece(float height, Action<Rect> draw) { Height = height; Draw = draw; }
            public static readonly Piece Grow = new Piece(-1, null);
        }
        private float K => Mathf.Clamp(.8f + (shell.ScreenArea.height / ui.Density - 640) * .0012f, .8f, 1.1f);
        private float U => K * ui.Density;
        // The wireframes draw some sizes in two steps: the Seeker's and the compact phone's.
        private float Step(float seeker, float compact) => K > .95f ? seeker : compact;

        // Lays the pieces down the column; spacers take an equal share of what is left.
        private void Compose(params Piece[] pieces)
        {
            float d = ui.Density, u = U; var safe = shell.SafeArea;
            float width = Mathf.Min(safe.width - 24 * u, ColumnDp * d), left = safe.center.x - width / 2;
            float top = safe.yMax, bottom = safe.y + (K > .95f ? 16 : 10) * d, gap = 10 * u;
            float taken = pieces.Where(piece => piece.Height >= 0).Sum(piece => piece.Height) + gap * (pieces.Length - 1);
            int spacers = pieces.Count(piece => piece.Height < 0);
            float spare = Mathf.Max(0, top - bottom - taken) / Mathf.Max(1, spacers), y = top;
            foreach (var piece in pieces)
            {
                float height = piece.Height < 0 ? spare : piece.Height;
                piece.Draw?.Invoke(new Rect(left, y - height, width, height));
                y -= height + gap;
            }
            column = new PageColumn(ui, shell.Page, actions, left, width, y + gap);
        }

        // A screen's title on its plate: an optional icon before the title, and
        // a line under it in its token.
        private Piece TitlePlate(string title, string subtitle, string subtitleToken = SkinTokens.TextMuted, string icon = null)
        {
            float d = ui.Density, k = K, u = U, titleDp = 28 * k, subtitleDp = Mathf.Max(12, 13 * k), iconSize = icon == null ? 0 : 30 * u;
            float room = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * d) - 32 * u;
            float titleWidth = Mathf.Min(room, ui.TextWidth(title, titleDp, SkinUi.Type.Display) + (icon == null ? 0 : iconSize + 6 * u));
            float subtitleWidth = subtitle == null ? 0 : Mathf.Min(room, ui.TextWidth(subtitle, subtitleDp, SkinUi.Type.Caption));
            float inner = Mathf.Max(titleWidth, subtitleWidth);
            float titleHeight = ui.TextHeight(title, titleWidth - (icon == null ? 0 : iconSize + 6 * u), titleDp, SkinUi.Type.Display);
            float subtitleHeight = subtitle == null ? 0 : ui.TextHeight(subtitle, inner, subtitleDp, SkinUi.Type.Caption);
            return new Piece(titleHeight + subtitleHeight + 14 * u, rect => {
                var plate = new Rect(rect.center.x - (inner + 32 * u) / 2, rect.y, inner + 32 * u, rect.height);
                ui.Piece("Screen title plate", SkinSlots.TitlePlate, plate, shell.Page);
                float x = rect.center.x - titleWidth / 2, y = rect.yMax - 7 * u;
                if (icon != null)
                    ui.Piece("Screen title icon", icon, new Rect(x, y - titleHeight / 2 - iconSize / 2, iconSize, iconSize), shell.Page);
                float textX = x + (icon == null ? 0 : iconSize + 6 * u);
                ui.Label("Screen title", title, new Rect(textX, y - titleHeight, titleWidth - (textX - x), titleHeight), titleDp, SkinTokens.Text,
                    shell.Page, SkinUi.Type.Display);
                if (subtitle != null)
                    ui.Label("Screen subtitle", subtitle, new Rect(rect.center.x - inner / 2, y - titleHeight - subtitleHeight, inner, subtitleHeight),
                        subtitleDp, subtitleToken, shell.Page, SkinUi.Type.Caption);
            });
        }

        // Three star sockets on the dark pill, the side ones 14% lower; lit ones
        // hold the earned star. sockets receives them left to right.
        private Piece Crown(bool[] lit, float sizeU, Image[] sockets)
        {
            float u = U, s = sizeU * u, gap = .25f * s;
            return new Piece(s * 1.14f + .2f * s, rect => {
                float width = 3 * s + 2 * gap;
                ui.Pill("Star crown", new Rect(rect.center.x - width / 2 - .22f * s, rect.y, width + .44f * s, rect.height), shell.Page);
                for (int i = 0; i < 3; i++)
                {
                    var socket = new Rect(rect.center.x - width / 2 + i * (s + gap), rect.yMax - .1f * s - s - (i == 1 ? 0 : .14f * s), s, s);
                    sockets[i] = ui.Piece("Result star " + (i + 1), lit[i] ? SkinSlots.StarLit : SkinSlots.StarSocket, socket, shell.Page);
                }
            });
        }

        // The guardian leaning on its card: its body behind the card, its paws
        // over the card's top edge 10u down, and its line in a bubble beside its
        // head. The card holds rows drawn by fill, top-down from its padding.
        private Piece GuardianCard(string frame, string line, float sizeU, float cardHeight, Action<Rect> fill)
        {
            float d = ui.Density, u = U, c = sizeU * u, overlap = 10 * u, above = c * ui.Art.GuardianRailY - overlap;
            return new Piece(above + cardHeight, rect => {
                var card = new Rect(rect.x, rect.y, rect.width, cardHeight);
                float rail = card.yMax - overlap;
                var canvas = new Rect(rect.center.x - c / 2, rail - (1 - ui.Art.GuardianRailY) * c, c, c);
                var body = ui.Rect<Image>("Screen guardian", canvas, shell.Page);
                body.sprite = ui.Art.Sprite("boss__" + frame); body.preserveAspect = true; body.raycastTarget = false;
                ui.Piece("Screen card", SkinSlots.Card, card, shell.Page);
                fill(card);
                var paws = ui.Rect<Image>("Screen guardian paws", canvas, shell.Page);
                paws.sprite = ui.Art.Sprite("boss__paws"); paws.preserveAspect = true; paws.raycastTarget = false;
                if (line != null) Bubble(line, canvas, c);
            });
        }
        // The guardian's line, beside its head with the tail pointing at it: 122u
        // wide, left of the head when there is no room on its right.
        private void Bubble(string line, Rect guardian, float c)
        {
            float u = U, width = 122 * u, textDp = 12.5f * K, pad = 9 * u;
            var safe = shell.SafeArea;
            float height = ui.TextHeight(line, width - 2 * pad, textDp, SkinUi.Type.Caption, HudLayout.BubbleLeading) + 2 * pad;
            bool right = guardian.x + .8f * c + width + 8 * u <= safe.xMax;
            float x = right ? guardian.x + .8f * c : guardian.xMax - .8f * c - width, top = guardian.yMax - .06f * c;
            var body = new Rect(x, top - height, width, height);
            ui.Piece("Guardian bubble", SkinSlots.TapBubble, body, shell.Page, .5f);
            var tail = ui.Piece("Guardian bubble tail", SkinSlots.TapBubbleTail,
                new Rect(right ? body.x - 12 * u : body.xMax - 2 * u, top - 18 * u - 7 * u, 14 * u, 16 * u), shell.Page);
            if (right) tail.rectTransform.localScale = new Vector3(-1, 1, 1);
            if (right) tail.rectTransform.anchoredPosition += new Vector2(14 * u, 0);
            var label = ui.Label("Guardian line", line, new Rect(body.x + pad, body.y + pad, width - 2 * pad, height - 2 * pad), textDp,
                SkinTokens.TextOnPrimary, shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.TopLeft);
            label.lineSpacing = SkinUi.LineSpacing(label.font, HudLayout.BubbleLeading);
        }

        // A goal row: its pictogram, its caption (with a smaller line under it)
        // and what sits on its right; rows are at least 50u and ruled apart.
        private float RowHeight(string caption, string small, float inner, float iconU, float rightWidth)
        {
            float u = U, width = inner - iconU * u - rightWidth - 20 * u;
            float text = ui.TextHeight(caption, width, Mathf.Max(13, 15 * K), SkinUi.Type.Caption)
                + (small == null ? 0 : ui.TextHeight(small, width, 12, SkinUi.Type.Caption));
            return Mathf.Max(50 * u, text + 8 * u);
        }
        private Image Row(string name, Rect row, string icon, float iconU, string caption, string small, float rightWidth, bool ruled)
        {
            float u = U, iconSize = iconU * u;
            if (ruled)
            {
                var rule = ui.Rect<Image>(name + " rule", new Rect(row.x, row.yMax, row.width, Mathf.Max(1, u)), shell.Page);
                rule.color = new Color(35 / 255f, 57 / 255f, 74 / 255f, 1); rule.raycastTarget = false;
            }
            var picture = icon == null ? null : ui.Piece(name + " icon", icon, new Rect(row.x, row.center.y - iconSize / 2, iconSize, iconSize), shell.Page);
            float x = row.x + (icon == null ? 0 : iconSize + 10 * u), width = row.xMax - rightWidth - 10 * u - x;
            float captionDp = Mathf.Max(13, 15 * K);
            float captionHeight = ui.TextHeight(caption, width, captionDp, SkinUi.Type.Caption);
            float smallHeight = small == null ? 0 : ui.TextHeight(small, width, 12, SkinUi.Type.Caption);
            float top = row.center.y + (captionHeight + smallHeight) / 2;
            ui.Label(name + " label", caption, new Rect(x, top - captionHeight, width, captionHeight), captionDp, SkinTokens.Text, shell.Page,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
            if (small != null)
                ui.Label(name + " detail", small, new Rect(x, top - captionHeight - smallHeight, width, smallHeight), 12, SkinTokens.TextMuted,
                    shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            return picture;
        }
        private float NumeralDp => 24 * K;
        private TMP_Text Numeral(string name, string text, Rect rect, string token = SkinTokens.Score)
        {
            var label = ui.Label(name, text, rect, NumeralDp, token, shell.Page, SkinUi.Type.Display, TextAlignmentOptions.Right);
            label.textWrappingMode = TextWrappingModes.NoWrap; label.richText = true;
            return label;
        }
        private float NumeralWidth(string text) => ui.TextWidth(text, NumeralDp, SkinUi.Type.Display);

        // One goal of a level: the score, or a catalog goal in the realm's
        // bonus, as its pictogram, its caption and its counter.
        private sealed class GoalLine
        {
            public string Name, Pictogram, Caption, Counter;
            public uint Target, Progress;
            public bool Met;
        }
        private GoalLine[] Goals(CampaignGoals goals, byte realm, byte bonus)
        {
            var primary = catalog.Goal(goals.PrimaryKind, goals.PrimaryValue, goals.PrimaryCount);
            var secondary = catalog.Goal(goals.SecondaryKind, goals.SecondaryValue, goals.SecondaryCount);
            return new[] {
                new GoalLine { Name = "Score goal", Pictogram = SkinSlots.GoalScore, Caption = "Score", Counter = "fill", Target = goals.Points },
                new GoalLine { Name = "Primary goal", Pictogram = primary.Pictogram(bonus), Caption = primary.text, Counter = primary.counter,
                    Target = goals.PrimaryCount },
                new GoalLine { Name = "Secondary goal", Pictogram = secondary.Pictogram(bonus), Caption = secondary.text, Counter = secondary.counter,
                    Target = goals.SecondaryCount },
            };
        }
        private static byte RealmBonus(byte realm) => (byte)Protocol.Realms.Single(value => value.MapId == realm).GuardianAndHeight[0];

        // Draws a screen's buttons in one row: the primary fills up to 300u,
        // secondaries hug their words; each leads with its icon.
        private Piece Buttons(params (PageAction action, bool primary, string icon)[] items)
        {
            float u = U, height = 62 * u, gap = 10 * u;
            items = items.Where(item => item.action != null).ToArray();
            return new Piece(height, rect => {
                float Width((PageAction action, bool primary, string icon) item) =>
                    ui.TextWidth(item.action.Label, item.primary ? 24 * K : 20 * K, SkinUi.Type.Display) + (item.icon == null ? 0 : (28 * K + 12) * ui.Density)
                        + 32 * ui.Density;
                float secondary = items.Where(item => !item.primary).Sum(Width) + gap * (items.Length - 1);
                float primary = items.Any(item => item.primary) ? Mathf.Clamp(rect.width - secondary, Width(items.First(item => item.primary)), 300 * u) : 0;
                float total = primary + secondary, x = rect.center.x - total / 2;
                foreach (var item in items)
                {
                    float width = item.primary ? primary : Width(item);
                    var button = ui.TextButton(item.action.Name ?? item.action.Label, new Rect(x, rect.y, width, height), item.action.Label,
                        actions.Click(item.action), item.primary, shell.Page, out var text, item.icon, SkinUi.Type.Display, item.primary ? 24 * K : 20 * K, 28 * K);
                    // The carved icons keep their own colours.
                    foreach (var image in button.GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" icon"))) image.color = Color.white;
                    text.textWrappingMode = TextWrappingModes.NoWrap;
                    actions.Bind(button, item.action, relabel: value => text.text = value);
                    if (item.primary)
                    {
                        var halo = ui.Glow(button.name + " halo", new Rect(x - width * .15f, rect.y - height * .15f, width * 1.3f, height * 1.3f),
                            SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .4f), shell.Page, HaloSeconds);
                        halo.transform.SetSiblingIndex(button.transform.GetSiblingIndex());
                    }
                    x += width + gap;
                }
            });
        }

        // A level's preview over its map: the title and realm, the empty crown,
        // the guardian speaking its line over the card of goals (each with its
        // caption and target), the moves and the guardian's rule, and Play.
        private void LevelScreen(LevelPageView value, string[] notices)
        {
            float d = ui.Density, u = U, k = K;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Map), .45f);
            byte bonus = RealmBonus(value.Realm);
            var goals = Goals(value.Goals, value.Realm, bonus);
            var rule = catalog.Rule(value.Realm);
            float iconU = Step(40, 34), inner = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * d) - 24 * u;
            string Target(GoalLine goal) => goal.Counter == "ring" ? null : goal.Target.ToString("N0", CultureInfo.InvariantCulture);
            float RightWidth(GoalLine goal) => Target(goal) == null ? 26 * u : NumeralWidth(Target(goal));
            var rowHeights = goals.Select(goal => RowHeight(goal.Caption, null, inner, iconU, RightWidth(goal))).ToArray();
            // The moves and the rule share the last row: the moves chip, then the
            // trigger pictogram, an arrow, the bonus icon and the rule's words.
            string moves = value.Moves.ToString(CultureInfo.InvariantCulture), earns = "Earns a " + Sentence(HudLayout.PowerName(bonus).ToLowerInvariant());
            float chipWidth = 22 * u + ui.TextWidth(moves, 16 * k, SkinUi.Type.Display) + ui.TextWidth(" moves", Mathf.Max(12, 13 * k), SkinUi.Type.Caption) + 22 * u;
            float ruleLead = chipWidth + 12 * u + 30 * u + 20 * u + 30 * u + 10 * u;
            float ruleHeight = Mathf.Max(50 * u, ui.TextHeight(rule.description, inner - ruleLead, Mathf.Max(13, 15 * k), SkinUi.Type.Caption)
                + ui.TextHeight(earns, inner - ruleLead, 12, SkinUi.Type.Caption) + 8 * u);
            float cardHeight = rowHeights.Sum() + ruleHeight + 20 * u;
            var sockets = new Image[3];
            var line = LevelLine(realm.guardianLines, value.Level).Line;
            var pieces = new List<Piece> { Piece.Grow, TitlePlate("Level " + Number(value.Realm, value.Level), realm.realmName + " · " + realm.guardianName),
                Crown(new bool[3], Step(38, 30), sockets),
                GuardianCard("talk-open", line, Step(170, 118), cardHeight, card => {
                    float y = card.yMax - 10 * u, x = card.x + 12 * u, width = card.width - 24 * u;
                    for (int i = 0; i < goals.Length; i++)
                    {
                        var goal = goals[i]; var row = new Rect(x, y - rowHeights[i], width, rowHeights[i]);
                        Row(goal.Name, row, goal.Pictogram, iconU, goal.Caption, null, RightWidth(goal), i > 0);
                        if (Target(goal) != null) Numeral(goal.Name, Target(goal), new Rect(row.xMax - RightWidth(goal), row.y, RightWidth(goal), row.height));
                        else ui.Piece(goal.Name + " ring", SkinSlots.CounterRing, new Rect(row.xMax - 26 * u, row.center.y - 13 * u, 26 * u, 26 * u), shell.Page);
                        y -= rowHeights[i];
                    }
                    var last = new Rect(x, y - ruleHeight, width, ruleHeight);
                    var rulerLine = ui.Rect<Image>("Level rule rule", new Rect(last.x, last.yMax, last.width, Mathf.Max(1, u)), shell.Page);
                    rulerLine.color = new Color(35 / 255f, 57 / 255f, 74 / 255f, 1); rulerLine.raycastTarget = false;
                    var chip = new Rect(last.x, last.center.y - 16 * u, chipWidth, 32 * u);
                    ui.Pill("Level moves chip", chip, shell.Page, new Color(11 / 255f, 20 / 255f, 28 / 255f, 1));
                    ui.Piece("Level moves icon", SkinSlots.IconHourglass, new Rect(chip.x + 6 * u, chip.center.y - 10 * u, 20 * u, 20 * u), shell.Page);
                    var count = ui.Label("Level moves", moves + "<size=" + Mathf.RoundToInt(100 * Mathf.Max(12, 13 * k) / (16 * k)) + "%> moves</size>",
                        new Rect(chip.x + 28 * u, chip.y, chip.width - 32 * u, chip.height), 16 * k, SkinTokens.Text, shell.Page, SkinUi.Type.Display,
                        TextAlignmentOptions.Left);
                    count.richText = true; count.textWrappingMode = TextWrappingModes.NoWrap;
                    float rx = chip.xMax + 12 * u;
                    if (rule.pictogram != null) ui.Piece("Level rule trigger", rule.pictogram, new Rect(rx, last.center.y - 15 * u, 30 * u, 30 * u), shell.Page);
                    ui.Label("Level rule arrow", "→", new Rect(rx + 30 * u, last.center.y - 15 * u, 20 * u, 30 * u), 16 * k, SkinTokens.TextMuted,
                        shell.Page, SkinUi.Type.Display);
                    ui.Piece("Level rule bonus", HudLayout.BonusIcon(bonus, true), new Rect(rx + 50 * u, last.center.y - 15 * u, 30 * u, 30 * u), shell.Page);
                    var words = new Rect(rx + 90 * u, last.y, last.xMax - rx - 90 * u, last.height);
                    Row("Level rule", words, null, 0, rule.description, earns, 0, false);
                }) };
            foreach (var notice in notices.Concat(string.IsNullOrEmpty(value.Notice) ? Array.Empty<string>() : new[] { value.Notice }))
                pieces.Add(Note(notice));
            pieces.Add(Piece.Grow);
            pieces.Add(Buttons((value.Play, true, SkinSlots.IconPlay)));
            Compose(pieces.ToArray());
            if (value.Back != null)
            {
                float size = IconDp * d;
                HeaderButton(value.Back, new Rect(shell.SafeArea.xMax - 12 * u - size, shell.SafeArea.yMax - 4 * d - size, size, size), SkinSlots.IconClose, false);
            }
        }
        // A centred line of muted words between a screen's pieces.
        private Piece Note(string text)
        {
            float u = U, width = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * ui.Density), size = Mathf.Max(12, 13 * K);
            float height = ui.TextHeight(text, width, size, SkinUi.Type.Caption);
            return new Piece(height, rect => ui.Label("Screen note", text, rect, size, SkinTokens.TextMuted, shell.Page, SkinUi.Type.Caption));
        }

        // What a Campaign result says, from how the run ended and the stars it
        // kept: the title and its icon, and whether the line under it is good
        // news or a warning.
        public static (string Title, string Subtitle, string Icon, bool Good) ResultWords(ResultPageView value)
        {
            int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
            bool last = value.Realm == Protocol.Realms.Length && value.Level == Protocol.CampaignTargets.Length;
            string next = last ? null : "Level " + HudLayout.LevelNumber(value.Realm, (byte)(value.Level + 1));
            string kept = stars == 0 ? "No stars kept" : stars + (stars == 1 ? " star" : " stars") + " kept";
            string opened = next == null ? null : stars > 0 ? next + " is open" : value.NextOpen == false ? "earn one to open " + next : null;
            string Kept() => opened == null ? kept : kept + " · " + opened;
            if (value.EndReason == 1) return ("Level cleared!", next == null ? "Every level is cleared" : next + " is open", null, true);
            if (value.EndReason == 3) return ("Run ended", "An ended run keeps no stars.", SkinSlots.IconFlag, false);
            return value.MovesLeft == 0 ? ("Out of moves", Kept(), SkinSlots.IconHourglassEmpty, stars > 0)
                : ("Board full", Kept(), SkinSlots.IconBoardFull, stars > 0);
        }

        // A Campaign result: the title from the end reason, the crown with the
        // kept stars (each rising from its goal's row), the guardian's line, the
        // goal rows with their final counts and ticks, "New best!" and the
        // actions by outcome. There is no Share on Campaign.
        private void CampaignScreen(ResultPageView value)
        {
            float d = ui.Density, u = U;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .55f);
            int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
            var (title, subtitle, icon, good) = ResultWords(value);
            bool cleared = value.EndReason == 1;
            // Kept stars speak their star line (the guardian falls on its own level);
            // an ended or starless run hears that the tide returns.
            var talk = TalkPage.For(realm.guardianLines, value.EndReason == 3 || stars == 0 ? TalkMoment.Ended
                : cleared && value.Level == Protocol.CampaignTargets.Length ? TalkMoment.GuardianDefeated : TalkMoment.Win, stars);
            string frame = stars == 3 ? "celebrate" : stars == 0 ? "defeated" : "satisfied";
            var lit = new[] { (value.StarSources & 1) != 0, (value.StarSources & 2) != 0, (value.StarSources & 4) != 0 };
            var goals = value.Goals == null ? Array.Empty<GoalLine>() : Goals(value.Goals, value.Realm, RealmBonus(value.Realm));
            for (int i = 0; i < goals.Length; i++) goals[i].Met = lit[i];
            if (goals.Length == 3)
            {
                goals[0].Progress = (uint)Math.Min(value.Score, uint.MaxValue);
                goals[1].Progress = lit[1] ? goals[1].Target : value.PrimaryProgress;
            }
            float iconU = Step(38, 32), inner = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * d) - 24 * u, tick = 24 * u;
            string Count(GoalLine goal) => goal.Counter == "fill" ? goal.Progress.ToString("N0", CultureInfo.InvariantCulture) + "<color=#"
                + ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted)) + ">/" + goal.Target.ToString("N0", CultureInfo.InvariantCulture) + "</color>" : null;
            float RightWidth(GoalLine goal) => goal.Counter == "fill"
                ? NumeralWidth(goal.Progress.ToString("N0", CultureInfo.InvariantCulture) + "/" + goal.Target.ToString("N0", CultureInfo.InvariantCulture)) + 6 * u + tick
                : 28 * u;
            var rowHeights = goals.Select(goal => RowHeight(goal.Caption, null, inner, iconU, RightWidth(goal))).ToArray();
            float bestHeight = value.NewBest ? 26 * u + 4 * u : 0, cardHeight = rowHeights.Sum() + bestHeight + 20 * u;
            var sockets = new Image[3]; var rowIcons = new Image[3];
            var first = stars > 0 ? value.Done : value.Retry; var second = stars == 3 ? null : stars > 0 ? value.Retry : value.Done;
            RectTransform finish = null;
            Compose(Piece.Grow, TitlePlate(title, subtitle, good ? SkinTokens.Positive : SkinTokens.Negative, icon),
                Crown(lit, Step(54, 40), sockets),
                GuardianCard(frame, talk.Line, Step(156, 112), cardHeight, card => {
                    float y = card.yMax - 10 * u, x = card.x + 12 * u, width = card.width - 24 * u;
                    for (int i = 0; i < goals.Length; i++)
                    {
                        var goal = goals[i]; var row = new Rect(x, y - rowHeights[i], width, rowHeights[i]);
                        rowIcons[i] = Row(goal.Name, row, goal.Pictogram, iconU, goal.Caption, null, RightWidth(goal), i > 0);
                        if (goal.Counter == "fill")
                        {
                            Numeral(goal.Name, Count(goal), new Rect(row.xMax - RightWidth(goal), row.y, RightWidth(goal) - tick - 6 * u, row.height),
                                goal.Met ? SkinTokens.Accent : SkinTokens.Score);
                            if (goal.Met) ui.Piece(goal.Name + " tick", SkinSlots.Tick, new Rect(row.xMax - tick, row.center.y - tick / 2, tick, tick), shell.Page);
                        }
                        else ui.Piece(goal.Name + (goal.Met ? " tick" : " ring"), goal.Met ? SkinSlots.Tick : SkinSlots.CounterRing,
                            new Rect(row.xMax - 26 * u, row.center.y - 13 * u, 26 * u, 26 * u), shell.Page);
                        y -= rowHeights[i];
                    }
                    if (value.NewBest)
                    {
                        float width2 = ui.TextWidth("New best!", 13, SkinUi.Type.Display) + 24 * u;
                        var tag = new Rect(card.center.x - width2 / 2, y - 4 * u - 26 * u, width2, 26 * u);
                        ui.Pill("New best", tag, shell.Page, new Color(1, 233 / 255f, 168 / 255f, 1));
                        ui.Label("New best label", "New best!", tag, 13, SkinTokens.TextOnPrimary, shell.Page, SkinUi.Type.Display);
                    }
                }),
                Piece.Grow,
                new Piece(62 * u, rect => finish = Group("Result actions", shell.Page, () =>
                    Buttons((first, true, stars > 0 ? SkinSlots.IconPlay : SkinSlots.IconRetry),
                        (second, false, second == value.Retry ? SkinSlots.IconRetry : SkinSlots.IconMap)).Draw(rect))));
            if (!string.IsNullOrEmpty(value.Notice))
            {
                var note = Note(value.Notice);
                note.Draw(new Rect(column.Left, SkinUi.ScreenRect(finish.GetComponentsInChildren<RectTransform>().Skip(1).First()).yMax + 8 * d, column.Width, note.Height));
            }
            if (!reducedMotion) Rise(lit, sockets, rowIcons, finish, stars == 3);
        }

        // The result's entrance: each kept star rises from its goal row to its
        // socket and ignites there, 450 ms apart (faster when the level was not
        // cleared); the actions arrive last. A tap anywhere jumps to the end.
        private void Rise(bool[] lit, Image[] sockets, Image[] rowIcons, RectTransform finish, bool cleared)
        {
            float pace = cleared ? 1 : .6f, flight = .45f * pace, apart = .45f * pace, start = .3f * pace;
            var sequence = finish.parent.gameObject.AddComponent<PageSequence>();
            int order = 0;
            for (int i = 0; i < 3; i++)
            {
                if (!lit[i] || rowIcons[i] == null) continue;
                var socket = sockets[i]; var to = SkinUi.ScreenRect(socket.rectTransform); var from = SkinUi.ScreenRect(rowIcons[i].rectTransform).center;
                var star = ui.Piece("Result star flight", SkinSlots.StarLit, to, shell.Page);
                var at = star.rectTransform.anchoredPosition; var socketAt = socket.rectTransform.anchoredPosition;
                float begin = start + order++ * apart;
                sequence.Add(begin, flight, t => {
                    float e = PageSequence.EaseOut(t);
                    var center = Vector2.Lerp(from, to.center, e) + Vector2.up * Mathf.Sin(Mathf.PI * t) * 30 * U;
                    star.rectTransform.anchoredPosition = at + (center - to.center);
                    star.enabled = t < 1; socket.sprite = ui.Art.SkinUi(t < 1 ? SkinSlots.StarSocket : SkinSlots.StarLit);
                });
                sequence.Add(begin + flight, .4f, t => PageSequence.ScaleAbout(socket.rectTransform, socketAt, to.center, t == 0 ? 1 : PageSequence.Ignite(t)));
            }
            var group = finish.GetComponent<CanvasGroup>();
            sequence.Add(start + order * apart + .2f, .2f, t => { group.alpha = t; group.interactable = group.blocksRaycasts = t >= 1; });
            var skip = ui.Rect<Image>("Skip", shell.ScreenArea, shell.Overlay); skip.color = Color.clear; skip.raycastTarget = true;
            skip.gameObject.AddComponent<Button>().onClick.AddListener(sequence.Finish);
            sequence.Finished += () => { if (skip != null) { skip.gameObject.SetActive(false); Destroy(skip.gameObject); } };
        }
    }
}
