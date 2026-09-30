using System;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The composed screens, as the v3 wireframes lay them out: one column from
    // the safe top to the bottom, 12u gutters and 10u between pieces, with
    // spacers sharing the height left over. u follows the screen's height, from
    // 0.8 dp at 640 dp to 1.1 dp at 890 dp and above; a few sizes are drawn in
    // two steps, the Seeker's and the compact phone's. The pages and the
    // board's pause draw with the same pieces.
    public sealed class ScreenKit
    {
        // A piece of a composed screen: its height in pixels, or a spacer, and
        // how it draws into the rect it is given.
        public readonly struct Piece
        {
            public readonly float Height;
            public readonly Action<Rect> Draw;
            public Piece(float height, Action<Rect> draw) { Height = height; Draw = draw; }
            public static readonly Piece Grow = new Piece(-1, null);
        }

        public readonly SkinUi Ui;
        public readonly Transform Parent;
        public readonly Rect Safe;
        public readonly float K, U;
        public ScreenKit(SkinUi ui, Transform parent, Rect screen, Rect safe)
        {
            Ui = ui; Parent = parent; Safe = safe;
            K = Mathf.Clamp(.8f + (screen.height / ui.Density - 640) * .0012f, .8f, 1.1f);
            U = K * ui.Density;
        }
        // The wireframes draw some sizes in two steps: the Seeker's and the compact phone's.
        public float Step(float seeker, float compact) => K > .95f ? seeker : compact;
        public float Width => Mathf.Min(Safe.width - 24 * U, PageViews.ColumnDp * Ui.Density);
        // A card's width inside its 12u padding.
        public float Inner => Width - 24 * U;

        // Lays the pieces down the column; spacers take an equal share of what
        // is left. Returns the column, from the bottom of its last piece up.
        public Rect Compose(params Piece[] pieces)
        {
            float d = Ui.Density, u = U, width = Width, left = Safe.center.x - width / 2;
            float top = Safe.yMax, bottom = Safe.y + (K > .95f ? 16 : 10) * d, gap = 10 * u;
            float taken = pieces.Where(piece => piece.Height >= 0).Sum(piece => piece.Height) + gap * (pieces.Length - 1);
            int spacers = pieces.Count(piece => piece.Height < 0);
            float spare = Mathf.Max(0, top - bottom - taken) / Mathf.Max(1, spacers), y = top;
            foreach (var piece in pieces)
            {
                float height = piece.Height < 0 ? spare : piece.Height;
                piece.Draw?.Invoke(new Rect(left, y - height, width, height));
                y -= height + gap;
            }
            return new Rect(left, y + gap, width, top - y - gap);
        }

        // A screen's title on its plate: an optional icon before the title, and
        // a line under it in its token.
        public Piece TitlePlate(string title, string subtitle, string subtitleToken = SkinTokens.TextMuted, string icon = null)
        {
            float k = K, u = U, titleDp = 28 * k, subtitleDp = Mathf.Max(12, 13 * k), iconSize = icon == null ? 0 : 30 * u;
            float room = Width - 32 * u;
            float titleWidth = Mathf.Min(room, Ui.TextWidth(title, titleDp, SkinUi.Type.Display) + (icon == null ? 0 : iconSize + 6 * u));
            float subtitleWidth = subtitle == null ? 0 : Mathf.Min(room, Ui.TextWidth(subtitle, subtitleDp, SkinUi.Type.Caption));
            float inner = Mathf.Max(titleWidth, subtitleWidth);
            float titleHeight = Ui.TextHeight(title, titleWidth - (icon == null ? 0 : iconSize + 6 * u), titleDp, SkinUi.Type.Display);
            float subtitleHeight = subtitle == null ? 0 : Ui.TextHeight(subtitle, inner, subtitleDp, SkinUi.Type.Caption);
            return new Piece(titleHeight + subtitleHeight + 14 * u, rect => {
                var plate = new Rect(rect.center.x - (inner + 32 * u) / 2, rect.y, inner + 32 * u, rect.height);
                Ui.Piece("Screen title plate", SkinSlots.TitlePlate, plate, Parent);
                float x = rect.center.x - titleWidth / 2, y = rect.yMax - 7 * u;
                if (icon != null)
                    Ui.Piece("Screen title icon", icon, new Rect(x, y - titleHeight / 2 - iconSize / 2, iconSize, iconSize), Parent);
                float textX = x + (icon == null ? 0 : iconSize + 6 * u);
                Ui.Label("Screen title", title, new Rect(textX, y - titleHeight, titleWidth - (textX - x), titleHeight), titleDp, SkinTokens.Text,
                    Parent, SkinUi.Type.Display);
                if (subtitle != null)
                    Ui.Label("Screen subtitle", subtitle, new Rect(rect.center.x - inner / 2, y - titleHeight - subtitleHeight, inner, subtitleHeight),
                        subtitleDp, subtitleToken, Parent, SkinUi.Type.Caption);
            });
        }

        // A card of rows drawn by fill, which gets the card's rect.
        public Piece Card(float height, Action<Rect> fill) => new Piece(height, rect => {
            Ui.Piece("Screen card", SkinSlots.Card, rect, Parent);
            fill(rect);
        });

        // Three star sockets on the dark pill, the side ones 14% lower; lit ones
        // hold the earned star. sockets receives them left to right.
        public Piece Crown(bool[] lit, float sizeU, Image[] sockets)
        {
            float u = U, s = sizeU * u, gap = .25f * s;
            return new Piece(s * 1.14f + .2f * s, rect => {
                float width = 3 * s + 2 * gap;
                Ui.Pill("Star crown", new Rect(rect.center.x - width / 2 - .22f * s, rect.y, width + .44f * s, rect.height), Parent);
                for (int i = 0; i < 3; i++)
                {
                    var socket = new Rect(rect.center.x - width / 2 + i * (s + gap), rect.yMax - .1f * s - s - (i == 1 ? 0 : .14f * s), s, s);
                    sockets[i] = Ui.Piece("Result star " + (i + 1), lit[i] ? SkinSlots.StarLit : SkinSlots.StarSocket, socket, Parent);
                }
            });
        }

        // The guardian leaning on its card: its body behind the card, its paws
        // over the card's top edge 10u down, and its line in a bubble beside its
        // head. The card holds rows drawn by fill, top-down from its padding.
        public Piece GuardianCard(string frame, string line, float sizeU, float cardHeight, Action<Rect> fill)
        {
            float u = U, c = sizeU * u, overlap = 10 * u, above = c * Ui.Art.GuardianRailY - overlap;
            return new Piece(above + cardHeight, rect => {
                var card = new Rect(rect.x, rect.y, rect.width, cardHeight);
                float rail = card.yMax - overlap;
                var canvas = new Rect(rect.center.x - c / 2, rail - (1 - Ui.Art.GuardianRailY) * c, c, c);
                var body = Ui.Rect<Image>("Screen guardian", canvas, Parent);
                body.sprite = Ui.Art.Sprite("boss__" + frame); body.preserveAspect = true; body.raycastTarget = false;
                Ui.Piece("Screen card", SkinSlots.Card, card, Parent);
                fill(card);
                var paws = Ui.Rect<Image>("Screen guardian paws", canvas, Parent);
                paws.sprite = Ui.Art.Sprite("boss__paws"); paws.preserveAspect = true; paws.raycastTarget = false;
                if (line != null) Bubble(line, canvas, c, card.yMax);
            });
        }
        // The guardian's line, beside its head with the tail pointing at it: 122u
        // wide, or up to 180u when a long line has the room, left of the head when
        // there is no room on its right, and never down over the card.
        private void Bubble(string line, Rect guardian, float c, float cardTop)
        {
            float u = U, textDp = 12.5f * K, pad = 9 * u;
            float room = Safe.xMax - 12 * u - (guardian.x + .8f * c);
            float width = Mathf.Clamp(room, 122 * u, 180 * u);
            float Height(float w) => Ui.TextHeight(line, w - 2 * pad, textDp, SkinUi.Type.Caption, HudLayout.BubbleLeading) + 2 * pad;
            // The narrow bubble serves a short line; a long one widens into the room.
            if (Height(122 * u) <= guardian.yMax - .06f * c - cardTop - 6 * u) width = 122 * u;
            float height = Height(width);
            bool right = guardian.x + .8f * c + width <= Safe.xMax - 4 * u;
            float x = right ? guardian.x + .8f * c : guardian.xMax - .8f * c - width;
            float top = Mathf.Max(guardian.yMax - .06f * c, cardTop + 6 * u + height);
            var body = new Rect(x, top - height, width, height);
            Ui.Piece("Guardian bubble", SkinSlots.TapBubble, body, Parent, .5f);
            var tail = Ui.Piece("Guardian bubble tail", SkinSlots.TapBubbleTail,
                new Rect(right ? body.x - 12 * u : body.xMax - 2 * u, top - 18 * u - 7 * u, 14 * u, 16 * u), Parent);
            if (right) tail.rectTransform.localScale = new Vector3(-1, 1, 1);
            if (right) tail.rectTransform.anchoredPosition += new Vector2(14 * u, 0);
            var label = Ui.Label("Guardian line", line, new Rect(body.x + pad, body.y + pad, width - 2 * pad, height - 2 * pad), textDp,
                SkinTokens.TextOnPrimary, Parent, SkinUi.Type.Caption, TextAlignmentOptions.TopLeft);
            label.lineSpacing = SkinUi.LineSpacing(label.font, HudLayout.BubbleLeading);
        }

        // A row: its icon, its caption (with a smaller line under it) and what
        // sits on its right; rows are at least 50u and ruled apart.
        public float CaptionDp => Mathf.Max(13, 15 * K);
        public float RowHeight(string caption, string small, float inner, float iconU, float rightWidth)
        {
            float u = U, width = inner - (iconU > 0 ? iconU * u + 10 * u : 0) - rightWidth - 10 * u;
            float text = Ui.TextHeight(caption, width, CaptionDp, SkinUi.Type.Caption)
                + (small == null ? 0 : Ui.TextHeight(small, width, 12, SkinUi.Type.Caption));
            return Mathf.Max(50 * u, text + 8 * u);
        }
        public void Rule(string name, Rect row)
        {
            var rule = Ui.Rect<Image>(name, new Rect(row.x, row.yMax, row.width, Mathf.Max(1, U)), Parent);
            rule.color = new Color(35 / 255f, 57 / 255f, 74 / 255f, 1); rule.raycastTarget = false;
        }
        public Image Row(string name, Rect row, string icon, float iconU, string caption, string small, float rightWidth, bool ruled)
        {
            float u = U, iconSize = iconU * u;
            if (ruled) Rule(name + " rule", row);
            var picture = icon == null ? null : Ui.Piece(name + " icon", icon, new Rect(row.x, row.center.y - iconSize / 2, iconSize, iconSize), Parent);
            float x = row.x + (iconU > 0 ? iconSize + 10 * u : 0), width = row.xMax - rightWidth - 10 * u - x;
            float captionHeight = Ui.TextHeight(caption, width, CaptionDp, SkinUi.Type.Caption);
            float smallHeight = small == null ? 0 : Ui.TextHeight(small, width, 12, SkinUi.Type.Caption);
            float top = row.center.y + (captionHeight + smallHeight) / 2;
            Ui.Label(name + " label", caption, new Rect(x, top - captionHeight, width, captionHeight), CaptionDp, SkinTokens.Text, Parent,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
            if (small != null)
                Ui.Label(name + " detail", small, new Rect(x, top - captionHeight - smallHeight, width, smallHeight), 12, SkinTokens.TextMuted,
                    Parent, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            return picture;
        }
        public float NumeralDp => 24 * K;
        public TMP_Text Numeral(string name, string text, Rect rect, string token = SkinTokens.Score)
        {
            var label = Ui.Label(name, text, rect, NumeralDp, token, Parent, SkinUi.Type.Display, TextAlignmentOptions.Right);
            label.textWrappingMode = TextWrappingModes.NoWrap; label.richText = true;
            return label;
        }
        public float NumeralWidth(string text) => Ui.TextWidth(text, NumeralDp, SkinUi.Type.Display);

        // One goal of a level: the score, or a catalog goal in the realm's
        // bonus, as its pictogram, its caption and its counter.
        public sealed class GoalLine
        {
            public string Name, Pictogram, Caption, Counter;
            public uint Target, Progress;
            public bool Met;
        }
        public static GoalLine[] Goals(PageCatalog catalog, CampaignGoals goals, byte bonus)
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
        // A filled count reads "progress/target", the target muted; other goals
        // are met in one move and show a ring, or a tick once met.
        public string Count(GoalLine goal) => goal.Progress.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + "<color=#"
            + ColorUtility.ToHtmlStringRGB(Ui.Art.Token(SkinTokens.TextMuted)) + ">/" + goal.Target.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)
            + "</color>";
        public float CountWidth(GoalLine goal) =>
            NumeralWidth(goal.Progress.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + "/"
                + goal.Target.ToString("N0", System.Globalization.CultureInfo.InvariantCulture));

        // A centred line of muted words between a screen's pieces.
        public Piece Note(string text)
        {
            float size = Mathf.Max(12, 13 * K), height = Ui.TextHeight(text, Width, size, SkinUi.Type.Caption);
            return new Piece(height, rect => Ui.Label("Screen note", text, rect, size, SkinTokens.TextMuted, Parent, SkinUi.Type.Caption));
        }

        // A screen's buttons in one row: the primary fills up to 300u,
        // secondaries hug their words; each leads with its icon. A row too wide
        // for the column (larger text) stacks them, the primary on top, each as
        // wide as the widest. made receives each button and its label, in order.
        public Piece Buttons((string name, string label, Action click, bool primary, string icon)[] items, Action<int, Button, TMP_Text> made = null)
        {
            float u = U, height = 62 * u, gap = 10 * u, column = Width;
            float Wide((string name, string label, Action click, bool primary, string icon) item) =>
                Ui.TextWidth(item.label, item.primary ? 24 * K : 20 * K, SkinUi.Type.Display) + (item.icon == null ? 0 : (28 * K + 12) * Ui.Density)
                    + 32 * Ui.Density;
            var widths = items.Select(Wide).ToArray();
            bool stacked = widths.Sum() + gap * (items.Length - 1) > column;
            // A stack puts the primary on top; made still gets each button's own index.
            var order = Enumerable.Range(0, items.Length).OrderBy(i => stacked && !items[i].primary).ToArray();
            float stackWidth = Mathf.Clamp(items.Select(Wide).DefaultIfEmpty(0).Max(), 0, column);
            return new Piece(stacked ? items.Length * height + (items.Length - 1) * gap : height, rect => {
                float secondary = items.Where(item => !item.primary).Sum(Wide) + gap * (items.Length - 1);
                float primary = items.Any(item => item.primary) ? Mathf.Clamp(rect.width - secondary, Wide(items.First(item => item.primary)), 300 * u) : 0;
                float x = rect.center.x - (primary + secondary) / 2, y = rect.yMax - height;
                foreach (int i in order)
                {
                    var item = items[i];
                    float width = stacked ? stackWidth : item.primary ? primary : Wide(item);
                    var at = stacked ? new Rect(rect.center.x - width / 2, y, width, height) : new Rect(x, rect.y, width, height);
                    var button = Ui.TextButton(item.name, at, item.label, item.click, item.primary, Parent, out var text,
                        item.icon, SkinUi.Type.Display, item.primary ? 24 * K : 20 * K, 28 * K);
                    // The carved icons keep their own colours.
                    foreach (var image in button.GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" icon"))) image.color = Color.white;
                    text.textWrappingMode = TextWrappingModes.NoWrap;
                    made?.Invoke(i, button, text);
                    if (item.primary)
                    {
                        var halo = Ui.Glow(button.name + " halo", new Rect(at.x - width * .15f, at.y - height * .15f, width * 1.3f, height * 1.3f),
                            SkinUi.WithAlpha(Ui.Art.Token(SkinTokens.Accent), .4f), Parent, PageViews.HaloSeconds);
                        halo.transform.SetSiblingIndex(button.transform.GetSiblingIndex());
                    }
                    x += width + gap; y -= height + gap;
                }
            });
        }
    }
}
