using System;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The composed screens, laid out as the v3 wireframes (ux/screens-v3.html) lay
    // them out, by the same box rules as their CSS: one column from the safe top to
    // the bottom with 12u gutters and 10u between pieces, spacers sharing what is
    // left; cards padded 10u by 12u with 4u between their parts; rows at least 50u;
    // text measured as CSS measures it, lines times size times line height. u
    // follows the screen's height, from 0.8 dp at 640 dp to 1.1 dp at 890 dp and
    // above, and some sizes come in two steps, the Seeker's and the compact
    // phone's. The pages and the board's pause draw with the same pieces;
    // WireframeGeometryTests holds every page to the wireframe's rects.
    public sealed class ScreenKit
    {
        // A piece of a composed screen: its height in pixels, or a spacer, and
        // how it draws into the rect it is given.
        public readonly struct Piece
        {
            public readonly float Height;
            public readonly Action<Rect> Draw;
            // How far it draws above its box (a title plate's outset).
            public readonly float Above;
            // How much taller it may draw when the screen has room to spare;
            // spacers take what is left.
            public readonly float Stretch;
            public Piece(float height, Action<Rect> draw, float above = 0, float stretch = 0) { Height = height; Draw = draw; Above = above; Stretch = stretch; }
            public static readonly Piece Grow = new Piece(-1, null);
        }
        // What a row holds on its right: its size and how it draws.
        public readonly struct Side
        {
            public readonly float Width, Height;
            public readonly Action<Rect> Draw;
            public Side(float width, float height, Action<Rect> draw) { Width = width; Height = height; Draw = draw; }
        }
        // A button: its words and icon, what it does and its kind: the lit
        // primary, the teal secondary or the quiet dark pill.
        public enum Kind { Primary, Secondary, Quiet }
        // What a control is on its page. A role has one place (the placement rule,
        // owner 2026-10-06): the kit names it on every control it places, and
        // EveryPagePlacesItsControlsByRole holds each to its band and its slot.
        public enum Role { Back, Skip, Primary, Secondary, Tertiary, Destructive, Step, Tab, Setting, WayIn, CardAction, ViewSwitch, Choice, Status }
        public static T As<T>(T control, Role role) where T : Component
        {
            var placed = control.GetComponent<Placed>(); if (placed == null) placed = control.gameObject.AddComponent<Placed>();
            placed.Role = role; return control;
        }
        // One control of a slot: its name, its words and icon, what it does, and
        // what its page does with the button once it is drawn (bind it, mark its progress).
        public sealed class Control
        {
            public string Name, Label, Icon, Shorter;
            public Action Click;
            public Action<Button, TMP_Text> Made;
        }
        // A page, as it hands itself to the composer: what it shows, and its
        // controls by role. The page places none of them.
        public sealed class Slots
        {
            // Top left, beside the title; drawn in Chrome where the body runs under the whole screen.
            public Control Back;
            public string BackIcon = SkinSlots.IconBack;
            public Transform Chrome;
            // The title row's piece: a title plate, or a page's own header.
            public Piece? Title;
            // The middle band, with the page's own spacers.
            public IEnumerable<Piece> Body = Array.Empty<Piece>();
            // Directly above the foot row.
            public Piece? Notices;
            // The foot row, in its reading order.
            public Control Primary, Secondary, Tertiary, Destructive;
            // The lowest row, on the tab bar.
            public Piece? Stepper;
            // Draws the tab bar into its rect, on a page that has one.
            public Action<Rect> Tabs;
            // Wraps the foot row's drawing, for a page that brings its buttons in as one (a result's entrance).
            public Func<Piece, Piece> FootAs;
        }

        public readonly SkinUi Ui;
        public readonly Transform Parent;
        public readonly Rect Safe;
        public readonly float K, U;
        private readonly float width, bottom;
        private readonly Rect screen;
        // bottom is the column's foot over the safe area's (the tab bar's top for a
        // tab page); width narrows the column (a card's inside).
        public ScreenKit(SkinUi ui, Transform parent, Rect screen, Rect safe, float? bottom = null, float? width = null)
        {
            Ui = ui; Parent = parent; Safe = safe; this.screen = screen;
            K = Mathf.Clamp(.8f + (screen.height / ui.Density - 640) * .0012f, .8f, 1.1f);
            U = K * ui.Density;
            this.width = width ?? Mathf.Min(safe.width - 24 * U, PageViews.ColumnDp * ui.Density);
            this.bottom = bottom ?? safe.y + (K > .95f ? 16 : 10) * ui.Density;
        }
        private ScreenKit(ScreenKit kit, float width)
        {
            Ui = kit.Ui; Parent = kit.Parent; Safe = kit.Safe; K = kit.K; U = kit.U; this.width = width; bottom = kit.bottom; screen = kit.screen;
        }
        // The wireframes draw some sizes in two steps: the Seeker's and the compact phone's.
        public float Step(float seeker, float compact) => K > .95f ? seeker : compact;
        public float Width => width;
        // The column's foot: the safe bottom less its 16 dp (10 on a compact phone), or a tab page's tab bar.
        public float Bottom => bottom;
        // The top of a page: nothing drawn rises past Edge, TopClearDp under the
        // safe top, so a cutout or the screen's corner never crops a title plate
        // or a header card. A column starts there, less what its first piece
        // draws above its box; Top is a titled column's.
        public const float TopClearDp = 8;
        public float Edge => Safe.yMax - TopClearDp * Ui.Density;
        public float Top => Edge - PlateOutsetU * U;
        // A card's inside: the column less its 12u padding each side.
        public ScreenKit Inside(float padU = 12) => new ScreenKit(this, width - 2 * padU * U);
        public float Inner => width - 24 * U;

        // The type sizes, in dp, as the wireframe's CSS sets them.
        public float TitleDp => 28 * K;
        public float SubtitleDp => Mathf.Max(12, 13 * K);
        public float CaptionDp => Caption(K);
        // The caption size at scale k: 15 dp, never under 13 (the pages' readable minimum).
        public static float Caption(float k) => Mathf.Max(13, 15 * k);
        public float SmallDp => Mathf.Max(12, 12 * K);
        public float HeaderDp => Mathf.Max(13, 15 * K);
        public float NumeralDp => 24 * K;
        public float QuietDp => Mathf.Max(13, 14 * K);
        // Every place a finger lands is at least 48 dp: the wireframe's size, or that floor.
        public float Touch(float sizeU) => Mathf.Max(BoardLayout.MinimumTouchDp * Ui.Density, sizeU * U);
        public float QuietHeight => Touch(44);
        // CSS line heights: the title 1.05, captions 1.2, notes 1.3, the bubble
        // 1.25; "normal" is each face's own, Lilita One 1.14 and Nunito 1.364.
        public const float TitleLeading = 1.05f, CaptionLeading = 1.2f, NoteLeading = 1.3f, BubbleLeading = 1.25f, DisplayNormal = 1.14f, BodyNormal = 1.364f;

        // A block of text, measured as CSS measures it: its lines times its size and line height.
        public float Block(string text, float widthPx, float sizeDp, SkinUi.Type type, float leading) =>
            string.IsNullOrEmpty(text) ? 0 : Ui.Lines(text, widthPx, sizeDp, type) * sizeDp * Ui.Scale * Ui.Density * leading;
        // Text in its CSS line box: the label is drawn a little taller than the box
        // when the face's own line is taller than the leading, as CSS lets glyphs
        // overflow their line box, and its lines step at the leading.
        public TMP_Text Text(string name, string text, Rect box, float sizeDp, string token, SkinUi.Type type, float leading,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center, Transform parent = null)
        {
            var label = Ui.Label(name, text, box, sizeDp, token, parent ?? Parent, type, alignment);
            var face = label.font.faceInfo;
            float natural = (face.ascentLine - face.descentLine) / face.pointSize, size = sizeDp * Ui.Scale * Ui.Density;
            float spill = Mathf.Max(0, (natural - leading) * size / 2);
            // The words never rise past the page's edge: a box there spills downward.
            float top = Mathf.Min(box.yMax + spill, Mathf.Max(box.yMax, Edge));
            if (spill > 0) SkinUi.Place(label.rectTransform, new Rect(box.x, top - box.height - 2 * spill, box.width, box.height + 2 * spill), parent ?? Parent);
            label.lineSpacing = SkinUi.LineSpacing(label.font, leading);
            return label;
        }
        public float TextWidth(string text, float sizeDp, SkinUi.Type type) => Ui.TextWidth(text, sizeDp, type);

        // Lays the pieces down the column; spacers take an equal share of what
        // is left. Returns the column, from the bottom of its last piece up.
        // The room Compose would leave over these pieces, before stretching and spacers.
        public float Spare(params Piece[] pieces)
        {
            float top = Edge - pieces.Where(piece => piece.Height >= 0).Select(piece => piece.Above).FirstOrDefault();
            float taken = pieces.Where(piece => piece.Height >= 0).Sum(piece => piece.Height) + 10 * U * (pieces.Length - 1);
            return Mathf.Max(0, top - bottom - taken);
        }
        // Whether the pieces fit the column's height, spacers at nothing.
        public bool Fits(params Piece[] pieces)
        {
            float top = Edge - pieces.Where(piece => piece.Height >= 0).Select(piece => piece.Above).FirstOrDefault();
            return pieces.Where(piece => piece.Height >= 0).Sum(piece => piece.Height) + 10 * U * (pieces.Length - 1) <= top - bottom + .5f;
        }
        // How wide a hero guardian card of sizeU draws when the screen leaves it spare room.
        public float HeroWidth(float sizeU, Piece guardian, float spare) => sizeU * U + Mathf.Min(guardian.Stretch, spare) / Ui.Art.GuardianRailY;
        public Rect Compose(params Piece[] pieces)
        {
            float u = U, left = Safe.center.x - width / 2, gap = 10 * u;
            float top = Edge - pieces.Where(piece => piece.Height >= 0).Select(piece => piece.Above).FirstOrDefault();
            float taken = pieces.Where(piece => piece.Height >= 0).Sum(piece => piece.Height) + gap * (pieces.Length - 1);
            int spacers = pieces.Count(piece => piece.Height < 0);
            float leftOver = Mathf.Max(0, top - bottom - taken);
            var grown = new float[pieces.Length];
            for (int i = 0; i < pieces.Length; i++)
                if (pieces[i].Height >= 0) { grown[i] = Mathf.Min(pieces[i].Stretch, leftOver); leftOver -= grown[i]; }
            float spare = leftOver / Mathf.Max(1, spacers), y = top;
            for (int i = 0; i < pieces.Length; i++)
            {
                var piece = pieces[i];
                float height = piece.Height < 0 ? spare : piece.Height + grown[i];
                piece.Draw?.Invoke(new Rect(left, y - height, width, height));
                y -= height + gap;
            }
            return new Rect(left, y + gap, width, top - y - gap);
        }
        // The one composer (the placement rule, owner 2026-10-06). A page is three
        // bands: the top says where you are, the middle shows, the bottom does.
        // From the top: Back beside the title, in a row as tall as its tablet;
        // the page's body; its notices, directly over the foot; the foot row;
        // the stepper, the lowest row; and the tab bar on the bottom edge. What
        // the screen has left goes above the foot, so the bottom band never
        // moves with the content. A page hands its controls over by role and
        // places none itself.
        private Piece[] Pieces(Slots slots, bool oneRow)
        {
            var pieces = new List<Piece>();
            if (slots.Title.HasValue) pieces.Add(TitleRow(slots));
            pieces.AddRange(slots.Body);
            if (pieces.Count == 0 || pieces[pieces.Count - 1].Height >= 0) pieces.Add(Piece.Grow);
            if (slots.Notices.HasValue) pieces.Add(slots.Notices.Value);
            var foot = Foot(slots.Primary, slots.Secondary, slots.Tertiary, slots.Destructive, oneRow);
            if (foot.HasValue) pieces.Add(slots.FootAs?.Invoke(foot.Value) ?? foot.Value);
            if (slots.Stepper.HasValue) pieces.Add(slots.Stepper.Value);
            return pieces.ToArray();
        }
        // Whether the page fits its screen with its foot in two rows, where it takes two.
        public bool Fits(Slots slots) => Fits(Pieces(slots, false));
        public Rect Page(Slots slots)
        {
            // Three buttons that need two rows the page has no room for share one row.
            var pieces = Pieces(slots, false);
            if (!Fits(pieces)) pieces = Pieces(slots, true);
            var used = Compose(pieces);
            // A page with no title at its top (a preview, whose title stands with its hero)
            // hangs Back alone in the corner, over the room its body leaves there.
            if (slots.Back != null && !slots.Title.HasValue) BackAt(slots, Edge);
            slots.Tabs?.Invoke(TabRect(Ui, screen, Safe));
            return used;
        }
        private void BackAt(Slots slots, float top)
        {
            var back = slots.Back; float tablet = BackSize;
            var button = Ui.IconButton(back.Name ?? back.Label, new Rect(Safe.x + 12 * U, top - tablet, tablet, tablet), slots.BackIcon, back.Click,
                slots.Chrome ?? Parent, false, out _, out _);
            As(button, Role.Back); back.Made?.Invoke(button, null);
        }
        // Back's tablet: 48 dp at least, 12u in from the side, its top on the page's edge.
        public float BackSize => Touch(40);
        private Piece TitleRow(Slots slots)
        {
            if (slots.Back == null) return slots.Title.Value;
            float tablet = BackSize, above = slots.Title?.Above ?? 0, words = slots.Title?.Height ?? 0;
            // The row is as tall as the tablet, so the next piece never touches it;
            // a shorter title stands level with the tablet's middle.
            return new Piece(Mathf.Max(words, tablet - 2 * above), rect => {
                BackAt(slots, rect.yMax + above);
                slots.Title?.Draw(new Rect(rect.x, rect.center.y - words / 2, rect.width, words));
            }, above);
        }
        // The foot row: the primary, then the secondary, the tertiary and the
        // destructive one last, each an icon and a word. The tertiary and the
        // destructive one are the outline pill.
        public Piece? Foot(Control primary, Control secondary, Control tertiary, Control destructive, bool oneRow = false)
        {
            var slots = new[] { (control: primary, role: Role.Primary, kind: Kind.Primary), (control: secondary, role: Role.Secondary, kind: Kind.Secondary),
                (control: tertiary, role: Role.Tertiary, kind: Kind.Quiet), (control: destructive, role: Role.Destructive, kind: Kind.Quiet) }
                .Where(slot => slot.control != null).ToArray();
            if (slots.Length == 0) return null;
            return Buttons(slots.Select(slot => (slot.control.Name ?? slot.control.Label, slot.control.Label, slot.control.Click, slot.kind, slot.control.Icon)).ToArray(),
                (i, button, text) => { As(button, slots[i].role); slots[i].control.Made?.Invoke(button, text); },
                shorter: slots.Select(slot => slot.control.Shorter).ToArray(), oneRow: oneRow);
        }
        // A stepper (the Boards page's days, the map's realms): one bar holding
        // the previous step's arrow, what it steps over that step's state, and
        // the next step's arrow, 48 dp each at the bar's two ends. The bar never
        // changes shape: an arrow that cannot step is dimmed and takes no tap.
        public Piece Stepper(string name, string labelName, string label, Side? state, Side? mark, Control previous, Control next)
        {
            float u = U, arrow = Touch(48), labelDp = 17 * K, glyph = 18 * u;
            float labelHeight = labelDp * Ui.Scale * Ui.Density * DisplayNormal;
            float words = labelHeight + (state.HasValue ? 2 * u + state.Value.Height : 0);
            return new Piece(Mathf.Max(arrow, words + 12 * u), rect => {
                Ui.Pill(name, rect, Parent, new Color(15 / 255f, 42 / 255f, 56 / 255f, .94f));
                for (int side = 0; side < 2; side++)
                {
                    // An arrow with nothing to do has no click.
                    var control = side == 0 ? previous : next; bool steps = control.Click != null;
                    var at = new Rect(side == 0 ? rect.x : rect.xMax - arrow, rect.center.y - arrow / 2, arrow, arrow);
                    var face = Ui.Rect<Image>(control.Name, at, Parent); face.color = Color.clear;
                    var chevron = Ui.Piece(control.Name + " chevron", SkinSlots.IconBack, new Rect(at.center.x - glyph / 2, at.center.y - glyph / 2, glyph, glyph), face.transform);
                    chevron.color = SkinUi.WithAlpha(Ui.Art.Token(SkinTokens.Text), steps ? 1 : .28f); chevron.raycastTarget = false;
                    if (side == 1)
                    {
                        var turned = chevron.rectTransform; turned.pivot = new Vector2(.5f, .5f); turned.anchoredPosition += turned.sizeDelta / 2;
                        turned.localScale = new Vector3(-1, 1, 1);
                    }
                    var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = face;
                    face.raycastTarget = true; face.gameObject.AddComponent<PressSquash>();
                    As(button, Role.Step);
                    if (!steps) { button.interactable = false; continue; }
                    button.onClick.AddListener(() => control.Click()); control.Made?.Invoke(button, null);
                }
                float top = rect.center.y + words / 2;
                Text(labelName, label, new Rect(rect.x + arrow, top - labelHeight, rect.width - 2 * arrow, labelHeight), labelDp, SkinTokens.Text, SkinUi.Type.Display,
                    DisplayNormal).textWrappingMode = TextWrappingModes.NoWrap;
                if (!state.HasValue) return;
                float markWide = mark.HasValue ? mark.Value.Width + 4 * u : 0, left = rect.center.x - (state.Value.Width + markWide) / 2;
                if (mark.HasValue) mark.Value.Draw(new Rect(left, top - words + state.Value.Height / 2 - mark.Value.Height / 2, mark.Value.Width, mark.Value.Height));
                state.Value.Draw(new Rect(left + markWide, top - words, state.Value.Width, state.Value.Height));
            });
        }

        // A stepper round the foot row, for a page that has no room for the bar (the
        // Campaign map, whose path needs the height): the same two arrows, 48 dp
        // tablets at the two ends of the lowest row, with the page's foot between
        // them and what they step named in the page's header. An arrow that cannot
        // step is dimmed and takes no tap, so the row never changes shape.
        public Piece StepperRow(Control previous, Control next, Piece? foot)
        {
            float u = U, arrow = Touch(48), gap = 10 * u;
            return new Piece(Mathf.Max(arrow, foot?.Height ?? 0), rect => {
                // The arrows stand level with the foot's first row.
                float middle = rect.yMax - Mathf.Min(rect.height, Mathf.Max(arrow, 62 * u)) / 2;
                for (int side = 0; side < 2; side++)
                {
                    var control = side == 0 ? previous : next; bool steps = control.Click != null;
                    var at = new Rect(side == 0 ? rect.x : rect.xMax - arrow, middle - arrow / 2, arrow, arrow);
                    var button = Ui.IconButton(control.Name, at, SkinSlots.IconBack, steps ? control.Click : () => { }, Parent, false, out var glyph, out _);
                    if (side == 1)
                    {
                        var turned = glyph.rectTransform; turned.pivot = new Vector2(.5f, .5f); turned.anchoredPosition += turned.sizeDelta / 2;
                        turned.localScale = new Vector3(-1, 1, 1);
                    }
                    As(button, Role.Step);
                    if (!steps) { button.interactable = false; button.gameObject.AddComponent<CanvasGroup>().alpha = .35f; continue; }
                    control.Made?.Invoke(button, null);
                }
                foot?.Draw(new Rect(rect.x + arrow + gap, rect.y, rect.width - 2 * (arrow + gap), rect.height));
            });
        }

        // Pieces stacked with gapU between them, as one piece (a card's inside).
        public Piece Stack(float gapU, params Piece[] pieces)
        {
            pieces = pieces.Where(piece => piece.Draw != null || piece.Height > 0).ToArray();
            float gap = gapU * U, height = pieces.Sum(piece => piece.Height) + Mathf.Max(0, pieces.Length - 1) * gap;
            return new Piece(height, rect => {
                float y = rect.yMax;
                foreach (var piece in pieces) { piece.Draw?.Invoke(new Rect(rect.x, y - piece.Height, rect.width, piece.Height)); y -= piece.Height + gap; }
            });
        }
        public Piece Space(float heightU) => new Piece(heightU * U, null);

        // A title too wide for its room shrinks toward 20u before it wraps,
        // 2% under the room so rounding never wraps a line that just fits.
        public float TitleFit(string title, float room, float? sizeDp = null)
        {
            float size = sizeDp ?? TitleDp, wide = TextWidth(title, size, SkinUi.Type.Display);
            return wide > room ? Mathf.Max(Mathf.Min(20 * K, size), .98f * size * room / wide) : size;
        }
        // A screen whose guardian is its hero (a level's preview, a result)
        // titles it smaller, under the guardian's size.
        public float HeroTitleDp => 18 * K;
        // A screen's title (.t3): the 28u title at 1.05 and the subtitle under it
        // 2u down at 1.3, centred; the plate is drawn 6u outside the words, so
        // the layout keeps the wireframe's box.
        public const float PlateOutsetU = 6;
        public Piece Title(string title, string subtitle, string subtitleToken = SkinTokens.TextMuted, string icon = null, float? room = null, float? sizeDp = null)
        {
            float u = U, iconSize = icon == null ? 0 : 30 * u, lead = icon == null ? 0 : iconSize + 6 * u;
            // A room the title cannot keep to one line in, even at its 20u floor, is not taken.
            if (room.HasValue && TextWidth(title, Mathf.Min(20 * K, sizeDp ?? TitleDp), SkinUi.Type.Display) + lead + 32 * u > .98f * room.Value) room = null;
            float space = Mathf.Min(room ?? float.PositiveInfinity, width) - 32 * u;
            float titleDp = TitleFit(title, space - lead, sizeDp);
            float titleWidth = Mathf.Min(space, TextWidth(title, titleDp, SkinUi.Type.Display) + lead);
            float subtitleWidth = subtitle == null ? 0 : Mathf.Min(space, TextWidth(subtitle, SubtitleDp, SkinUi.Type.Caption));
            float inner = Mathf.Max(titleWidth, subtitleWidth);
            // An icon sits 4u under the title's baseline, which deepens its line by 3u.
            float titleHeight = Block(title, titleWidth - lead + 1, titleDp, SkinUi.Type.Display, TitleLeading) + (icon == null ? 0 : 3 * u);
            float subtitleHeight = subtitle == null ? 0 : 2 * u + Block(subtitle, inner + 1, SubtitleDp, SkinUi.Type.Caption, NoteLeading);
            return new Piece(titleHeight + subtitleHeight, rect => {
                float outset = PlateOutsetU * u;
                Ui.Piece("Screen title plate", SkinSlots.TitlePlate, new Rect(rect.center.x - (inner + 32 * u) / 2, rect.y - outset, inner + 32 * u, rect.height + 2 * outset), Parent);
                float x = rect.center.x - titleWidth / 2;
                if (icon != null) Ui.Piece("Screen title icon", icon, new Rect(x, rect.yMax - titleHeight / 2 - iconSize / 2, iconSize, iconSize), Parent);
                Text("Screen title", title, new Rect(x + lead, rect.yMax - titleHeight, titleWidth - lead, titleHeight), titleDp, SkinTokens.Text, SkinUi.Type.Display,
                    TitleLeading);
                if (subtitle != null)
                    Text("Screen subtitle", subtitle, new Rect(rect.center.x - inner / 2, rect.y, inner, subtitleHeight - 2 * u), SubtitleDp, subtitleToken,
                        SkinUi.Type.Caption, NoteLeading);
            }, PlateOutsetU * u);
        }

        // A card (.card3): padding 10u by 12u, its header in the display face's
        // muted capitals, then its parts 4u apart. The parts are drawn by pieces
        // measured at the card's inside (Inside()).
        // A ledge is empty room kept at the card's top, under its padding, for what rests on its edge.
        public const float CardPadU = 10;
        // padU is the card's padding above and below, for a screen that has to tighten.
        // end is the card's own action: a chip at the end of its header line.
        public Piece Card(string header, IEnumerable<Piece> parts, string name = "Screen card", Side? tag = null, float ledge = 0, float padU = CardPadU, Side? end = null)
        {
            const float padHU = 12;
            float u = U, pad = padU * u;
            var stack = Stack(4, parts.ToArray());
            float headerHeight = header == null ? 0 : HeaderDp * Ui.Scale * Ui.Density * DisplayNormal + 4 * u;
            return new Piece(2 * pad + ledge + headerHeight + stack.Height, rect => {
                Ui.Piece(name, SkinSlots.Card, rect, Parent);
                var inside = new Rect(rect.x + padHU * u, rect.y + pad, rect.width - 2 * padHU * u, rect.height - 2 * pad - ledge);
                if (header != null)
                {
                    var head = Text(name + " heading", header.ToUpperInvariant(), new Rect(inside.x, inside.yMax - headerHeight + 4 * u, inside.width, headerHeight - 4 * u),
                        HeaderDp, SkinTokens.TextMuted, SkinUi.Type.Display, DisplayNormal, TextAlignmentOptions.Left);
                    head.characterSpacing = 6;
                    // A tag (.tag) follows the heading 6u on.
                    if (tag.HasValue)
                    {
                        head.ForceMeshUpdate();
                        float x = inside.x + head.textBounds.size.x + 6 * u, middle = inside.yMax - (headerHeight - 4 * u) / 2;
                        tag.Value.Draw(new Rect(x, middle - tag.Value.Height / 2, tag.Value.Width, tag.Value.Height));
                    }
                    if (end.HasValue)
                    {
                        float middle = inside.yMax - (headerHeight - 4 * u) / 2;
                        end.Value.Draw(new Rect(inside.xMax - end.Value.Width, middle - end.Value.Height / 2, end.Value.Width, end.Value.Height));
                    }
                }
                stack.Draw(new Rect(inside.x, inside.y, inside.width, inside.height - headerHeight));
            });
        }
        public Piece Card(string header, params Piece[] parts) => Card(header, (IEnumerable<Piece>)parts);

        // A row (.row3): what leads it (its icon), its caption with a smaller
        // line under it, and what sits on its right, 10u apart and centred, at
        // least 50u tall. A row after another is ruled from it.
        public Piece Row(string name, Side? lead, string caption, string small, Side? right, bool ruled, string captionToken = SkinTokens.Text)
        {
            float u = U;
            float text = width - (lead.HasValue ? lead.Value.Width + 10 * u : 0) - (right.HasValue ? right.Value.Width + 10 * u : 0);
            float captionHeight = Block(caption, text, CaptionDp, SkinUi.Type.Caption, CaptionLeading);
            float smallHeight = Block(small, text, SmallDp, SkinUi.Type.Caption, CaptionLeading);
            float height = Mathf.Max(Touch(50), Mathf.Max(lead?.Height ?? 0, Mathf.Max(captionHeight + smallHeight, right?.Height ?? 0)));
            return new Piece(height, rect => {
                if (ruled) Rule(name + " rule", rect);
                float x = rect.x;
                if (lead.HasValue) { lead.Value.Draw(new Rect(x, rect.center.y - lead.Value.Height / 2, lead.Value.Width, lead.Value.Height)); x += lead.Value.Width + 10 * u; }
                float top = rect.center.y + (captionHeight + smallHeight) / 2;
                if (caption != null)
                    Text(name + " label", caption, new Rect(x, top - captionHeight, text, captionHeight), CaptionDp, captionToken, SkinUi.Type.Caption, CaptionLeading,
                        TextAlignmentOptions.Left);
                if (small != null)
                    Text(name + " detail", small, new Rect(x, top - captionHeight - smallHeight, text, smallHeight), SmallDp, SkinTokens.TextMuted, SkinUi.Type.Caption,
                        CaptionLeading, TextAlignmentOptions.Left);
                if (right.HasValue)
                    right.Value.Draw(new Rect(rect.xMax - right.Value.Width, rect.center.y - right.Value.Height / 2, right.Value.Width, right.Value.Height));
            });
        }
        // Words as a row's part: one line in the caption face.
        public Side Word(string name, string text, float sizeDp, string token)
        {
            float w = TextWidth(text, sizeDp, SkinUi.Type.Caption), h = Ui.TextHeight(text, w, sizeDp, SkinUi.Type.Caption);
            return new Side(w, h, rect => Ui.Label(name, text, rect, sizeDp, token, Parent, SkinUi.Type.Caption).textWrappingMode = TextWrappingModes.NoWrap);
        }
        // The kit's divider along a row's top edge.
        public void Rule(string name, Rect row) => Ui.Piece(name, SkinSlots.Divider, new Rect(row.x, row.yMax - 2 * Ui.Density, row.width, 4 * Ui.Density), Parent);

        // A value (.val3): the 24u display numeral at line height 1.
        public Side Value(string name, string text, string token = SkinTokens.Score, float? sizeDp = null)
        {
            float size = sizeDp ?? NumeralDp;
            float w = TextWidth(System.Text.RegularExpressions.Regex.Replace(text, "<[^>]+>", ""), size, SkinUi.Type.Display), h = size * Ui.Scale * Ui.Density;
            return new Side(w, h, rect => {
                var label = Text(name, text, rect, size, token, SkinUi.Type.Display, 1, TextAlignmentOptions.Right);
                label.textWrappingMode = TextWrappingModes.NoWrap; label.richText = true;
            });
        }
        // A progress count over its 4u bar (the pause's rows), at least 86u wide.
        public Side Progress(string name, string count, string plain, float share, bool met)
        {
            float u = U, w = Mathf.Max(86 * u, TextWidth(plain, NumeralDp, SkinUi.Type.Display)), h = NumeralDp * Ui.Scale * Ui.Density + 8 * u;
            return new Side(w, h, rect => {
                var label = Text(name, count, new Rect(rect.x, rect.yMax - (h - 8 * u), rect.width, h - 8 * u), NumeralDp, met ? SkinTokens.Accent : SkinTokens.Score,
                    SkinUi.Type.Display, 1, TextAlignmentOptions.Right);
                label.textWrappingMode = TextWrappingModes.NoWrap; label.richText = true;
                var track = new Rect(rect.x, rect.y, rect.width, 4 * u);
                Ui.Piece(name + " track", SkinSlots.CounterTrack, track, Parent);
                if (share > 0) Ui.Piece(name + " fill", met ? SkinSlots.CounterFillDone : SkinSlots.CounterFill,
                    new Rect(track.x, track.y, Mathf.Max(track.height, track.width * Mathf.Clamp01(share)), track.height), Parent);
            });
        }
        public Side Icon(string name, string slot, float sizeU) =>
            new Side(sizeU * U, sizeU * U, rect => Ui.Piece(name, slot, rect, Parent));
        // A goal's pictogram with its chip (SkinUi.Pictogram); drawn receives the picture.
        public Side Pictogram(string name, string slot, string chip, float sizeU, Action<Image> drawn = null) =>
            new Side(sizeU * U, sizeU * U, rect => { var image = Ui.Pictogram(name, slot, chip, rect, Parent); drawn?.Invoke(image); });
        // The multiplier's pictogram in a column sizeU wide: its ring 5/6 of it across, half its height.
        public Side Multiplier(string name, float sizeU) =>
            new Side(sizeU * U, sizeU * U / 2, rect => Ui.MultiplierPictogram(name, new Rect(rect.center.x - rect.width * 5 / 12, rect.y, rect.width * 5 / 6, rect.height), Parent));
        // A row's lead centred in its card's icon column, so every row's words start at one x.
        public Side Column(Side lead, float columnU) =>
            new Side(columnU * U, lead.Height, rect => lead.Draw(new Rect(rect.center.x - lead.Width / 2, rect.y, lead.Width, lead.Height)));
        public Side Blank(float widthU) => new Side(widthU * U, 0, _ => { });
        // Sides side by side, gapU apart.
        public Side Beside(float gapU, params Side[] sides)
        {
            float gap = gapU * U;
            return new Side(sides.Sum(side => side.Width) + gap * Mathf.Max(0, sides.Length - 1), sides.Max(side => side.Height), rect => {
                float x = rect.x;
                foreach (var side in sides) { side.Draw(new Rect(x, rect.center.y - side.Height / 2, side.Width, side.Height)); x += side.Width + gap; }
            });
        }

        // Sides one under another, gapU apart, at their left.
        public Side Over(float gapU, params Side[] sides)
        {
            float gap = gapU * U;
            return new Side(sides.Max(side => side.Width), sides.Sum(side => side.Height) + gap * Mathf.Max(0, sides.Length - 1), rect => {
                float y = rect.yMax;
                foreach (var side in sides) { side.Draw(new Rect(rect.x, y - side.Height, side.Width, side.Height)); y -= side.Height + gap; }
            });
        }

        // A chip (.chip3): an optional icon, a display number and words, on the dark pill.
        public Side Chip(string name, string icon, float iconU, string number, string words)
        {
            float u = U, numberDp = 16 * K, wordsDp = SubtitleDp;
            float iconSize = icon == null ? 0 : iconU * u;
            float numberWidth = number == null ? 0 : TextWidth(System.Text.RegularExpressions.Regex.Replace(number, "[0-9]", "8"), numberDp, SkinUi.Type.Display);
            // Its parts are 6u apart (.chip3).
            float wordsWidth = words == null ? 0 : TextWidth(words, wordsDp, SkinUi.Type.Caption), between = number != null && words != null ? 6 * u : 0;
            float w = 5 * u + iconSize + (icon == null ? 0 : 6 * u) + numberWidth + between + wordsWidth + 10 * u;
            float h = Mathf.Max(iconSize, Mathf.Max(numberDp * Ui.Scale * Ui.Density * DisplayNormal, wordsDp * Ui.Scale * Ui.Density * BodyNormal)) + 8 * u;
            return new Side(w, h, rect => {
                Ui.Pill(name, rect, Parent, new Color(11 / 255f, 20 / 255f, 28 / 255f, 1));
                float x = rect.x + 5 * u;
                if (icon != null) { Ui.Piece(name + " icon", icon, new Rect(x, rect.center.y - iconSize / 2, iconSize, iconSize), Parent); x += iconSize + 6 * u; }
                if (number != null)
                {
                    var n = Ui.Label(name + " number", number, new Rect(x, rect.y, numberWidth + 2, rect.height), numberDp, SkinTokens.Text, Parent, SkinUi.Type.Display,
                        TextAlignmentOptions.Left);
                    n.textWrappingMode = TextWrappingModes.NoWrap; x += numberWidth + between;
                }
                if (words != null)
                    Ui.Label(name + " words", words, new Rect(x, rect.y, wordsWidth + 2, rect.height), wordsDp, SkinTokens.Text, Parent, SkinUi.Type.Caption,
                        TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
            });
        }

        // A centred line of text (.t3b): the note size at 1.3.
        public Piece Note(string text, string name = "Screen note", string token = SkinTokens.TextMuted)
        {
            float size = SubtitleDp, height = Block(text, width, size, SkinUi.Type.Caption, NoteLeading);
            return new Piece(height, rect => Text(name, text, rect, size, token, SkinUi.Type.Caption, NoteLeading));
        }

        // Three star sockets (.crown3), the side ones 14% lower, bare over the
        // scene; lit ones hold the earned star. sockets receives them left to right.
        public Piece Crown(bool[] lit, float sizeU, Image[] sockets)
        {
            float u = U, s = sizeU * u, gap = .25f * s;
            return new Piece(s * 1.34f, rect => {
                float w = 3 * s + 2 * gap;
                var crown = Ui.Rect<Image>("Star crown", new Rect(rect.center.x - w / 2 - .22f * s, rect.y, w + .44f * s, rect.height), Parent);
                crown.color = Color.clear; crown.raycastTarget = false;
                for (int i = 0; i < 3; i++)
                {
                    var socket = new Rect(rect.center.x - w / 2 + i * (s + gap), rect.yMax - .1f * s - s - (i == 1 ? 0 : .14f * s), s, s);
                    sockets[i] = Ui.Piece("Result star " + (i + 1), lit[i] ? SkinSlots.StarLit : SkinSlots.StarSocket, socket, Parent);
                }
            });
        }

        // The guardian over its card (.gw then .card3): the c-wide canvas stands
        // over the card's top by its own rail line, which rests there, the paws
        // drawn over the card's edge, its line in a bubble beside its head. As
        // a screen's hero it grows from sizeU into the room the screen has to
        // spare, up to heroU and as wide as leaves its bubble room beside it.
        // The paws hang below the rail, so the card, built for the ledge it is
        // given, keeps its top clear as deep as they hang: the paws rest on the
        // card and never cover what it says, however large the guardian grows.
        public Piece GuardianCard(string frame, string line, float sizeU, Func<float, Piece> card, float heroU = 0)
        {
            float u = U, rail = Ui.Art.GuardianRailY, hang = Ui.Art.GuardianPawsY - rail, least = sizeU * u, most = Mathf.Max(least, HeroGuardian(heroU));
            float bare = card(0).Height, pad = CardPadU * u;
            float Ledge(float c) => Mathf.Max(0, hang * c - pad);
            float Tall(float c) => rail * c + bare + Ledge(c);
            return new Piece(Tall(least), rect => {
                // The widest guardian whose canvas, card and ledge fit the room.
                float c = (rect.height - bare) / rail;
                if (Ledge(c) > 0) c = (rect.height - bare + pad) / (rail + hang);
                c = Mathf.Clamp(c, least, most);
                var drawn = card(Ledge(c));
                var cardRect = new Rect(rect.x, rect.y, rect.width, drawn.Height);
                var canvas = new Rect(rect.center.x - c / 2, cardRect.yMax - (1 - rail) * c, c, c);
                var body = Ui.Rect<Image>("Screen guardian", canvas, Parent);
                body.preserveAspect = true; body.raycastTarget = false; SkinUi.GuardianFrame(Ui.Art, body, frame);
                drawn.Draw(cardRect);
                var paws = Ui.Rect<Image>("Screen guardian paws", canvas, Parent);
                paws.sprite = Ui.Art.Sprite("boss__paws"); paws.preserveAspect = true; paws.raycastTarget = false;
                if (line != null) Bubble(line, canvas, c, cardRect.yMax);
            }, 0, Tall(most) - Tall(least));
        }
        // The widest a hero guardian may grow: up to heroU, and no wider than
        // leaves its bubble's 122u beside it, from 0.8c of a centred canvas to
        // 4u in from the safe edge.
        public float HeroGuardian(float heroU) => Mathf.Min(heroU * U, (Safe.xMax - 4 * U - 122 * U - Safe.center.x) / .3f);
        // The guardian's line (.bub): 122u wide, 0.8c from the canvas's left,
        // padded 8u by 10u, 12.5u at 1.25. It stands level with the mouth, no
        // higher than 0.06c under the canvas's top and clear of the card, and
        // its tail reaches for the mouth (SkinUi.SpeechTail). A long line widens
        // into the room rather than reach the card.
        private void Bubble(string line, Rect guardian, float c, float cardTop)
        {
            float u = U, textDp = 12.5f * K;
            float room = Safe.xMax - 12 * u - (guardian.x + .8f * c);
            float Height(float w) => Block(line, w - 20 * u, textDp, SkinUi.Type.Caption, BubbleLeading) + 16 * u;
            float w = 122 * u;
            if (guardian.yMax - .06f * c - Height(w) < cardTop + 6 * u) w = Mathf.Clamp(room, 122 * u, 180 * u);
            float height = Height(w);
            bool right = guardian.x + .8f * c + w <= Safe.xMax - 4 * u;
            float x = right ? guardian.x + .8f * c : guardian.xMax - .8f * c - w;
            float top = Mathf.Max(Mathf.Min(guardian.yMax - .06f * c, Ui.Art.MouthIn(guardian).y + height / 2), cardTop + 6 * u + height);
            var body = new Rect(x, top - height, w, height);
            Ui.SpeechTail("Guardian bubble tail", body, guardian, u, Parent);
            Ui.Piece("Guardian bubble", SkinSlots.TapBubble, body, Parent);
            Text("Guardian line", line, new Rect(body.x + 10 * u, body.y + 8 * u, w - 20 * u, height - 16 * u), textDp, SkinTokens.TextOnPrimary, SkinUi.Type.Caption,
                BubbleLeading, TextAlignmentOptions.TopLeft);
        }

        // One goal of a level: the score, or a catalog goal in the realm's
        // bonus, as its pictogram, its caption and its counter.
        public sealed class GoalLine
        {
            public string Name, Pictogram, Chip, Caption, Counter;
            public uint Target, Progress;
            public bool Met;
        }
        public static GoalLine[] Goals(PageCatalog catalog, CampaignGoals goals, byte bonus)
        {
            var primary = catalog.Goal(goals.PrimaryKind, goals.PrimaryValue, goals.PrimaryCount);
            var secondary = catalog.Goal(goals.SecondaryKind, goals.SecondaryValue, goals.SecondaryCount);
            return new[] {
                new GoalLine { Name = "Score goal", Pictogram = SkinSlots.GoalScore, Caption = "Score", Counter = "fill", Target = goals.Points },
                new GoalLine { Name = "Primary goal", Pictogram = primary.Pictogram(bonus), Chip = primary.chip, Caption = primary.text, Counter = primary.counter,
                    Target = goals.PrimaryCount },
                new GoalLine { Name = "Secondary goal", Pictogram = secondary.Pictogram(bonus), Chip = secondary.chip, Caption = secondary.text,
                    Counter = secondary.counter, Target = goals.SecondaryCount },
            };
        }
        // A filled count reads "progress/target", the target muted.
        public string Count(GoalLine goal) => goal.Progress.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + "<color=#"
            + ColorUtility.ToHtmlStringRGB(Ui.Art.Token(SkinTokens.TextMuted)) + ">/" + goal.Target.ToString("N0", System.Globalization.CultureInfo.InvariantCulture)
            + "</color>";
        public string Plain(GoalLine goal) => goal.Progress.ToString("N0", System.Globalization.CultureInfo.InvariantCulture) + "/"
            + goal.Target.ToString("N0", System.Globalization.CultureInfo.InvariantCulture);
        // The goal rows (goalRows): target ("10" or a ring), progress (the count
        // over its bar, or a ring and a tick) or result (the count with its tick).
        public enum GoalMode { Target, Progress, Result }
        public Piece[] GoalRows(GoalLine[] goals, GoalMode mode, float iconU)
        {
            float u = U;
            return goals.Select((goal, i) => {
                bool once = goal.Counter != "fill";
                Side right;
                if (mode == GoalMode.Target) right = once ? Icon(goal.Name + " ring", SkinSlots.CounterRing, 26) : Value(goal.Name, goal.Target.ToString("N0", System.Globalization.CultureInfo.InvariantCulture));
                else if (once) right = goal.Met ? Icon(goal.Name + " tick", SkinSlots.Tick, 28) : Icon(goal.Name + " ring", SkinSlots.CounterRing, 26);
                else if (mode == GoalMode.Progress)
                    right = Progress(goal.Name + " value", Count(goal), Plain(goal), goal.Target == 0 ? 1 : (float)goal.Progress / goal.Target, goal.Met);
                else
                {
                    var count = Value(goal.Name, Count(goal), goal.Met ? SkinTokens.Accent : SkinTokens.Score);
                    right = Beside(10, new Side(Mathf.Max(86 * u, count.Width), count.Height, rect => count.Draw(new Rect(rect.xMax - count.Width, rect.y, count.Width, rect.height))),
                        goal.Met ? Icon(goal.Name + " tick", SkinSlots.Tick, 24) : Blank(24));
                }
                return Row(goal.Name, Pictogram(goal.Name, goal.Pictogram, goal.Chip, iconU), goal.Caption, null,
                    right, i > 0);
            }).ToArray();
        }

        // Three tiles side by side (.stat3), 8u apart: an icon, a number and what it counts.
        public Piece Stats(params (string name, string icon, string number)[] tiles)
        {
            float u = U, gap = 8 * u, tile = (width - 2 * gap) / tiles.Length, smallDp = Mathf.Max(11, 11 * K);
            float smallHeight = tiles.Max(entry => Block(entry.name, tile - 16 * u, smallDp, SkinUi.Type.Caption, BodyNormal));
            float numberHeight = NumeralDp * Ui.Scale * Ui.Density;
            return new Piece(8 * u + 24 * u + 2 * u + numberHeight + 2 * u + smallHeight + 8 * u, rect => {
                for (int i = 0; i < tiles.Length; i++)
                {
                    var (name, slot, number) = tiles[i];
                    var card = new Rect(rect.x + i * (tile + gap), rect.y, tile, rect.height);
                    Ui.Piece(name + " tile", SkinSlots.Card, card, Parent);
                    float y = card.yMax - 8 * u;
                    Ui.Piece(name + " icon", slot, new Rect(card.center.x - 12 * u, y - 24 * u, 24 * u, 24 * u), Parent);
                    y -= 26 * u;
                    var numberRect = new Rect(card.x + 8 * u, y - numberHeight, tile - 16 * u, numberHeight);
                    NumberFit.Apply(Ui, Text(name, number, numberRect, NumeralDp, SkinTokens.Score, SkinUi.Type.Display, 1), numberRect.width, NumeralDp);
                    Text(name + " label", name, new Rect(card.x + 8 * u, card.y + 8 * u, tile - 16 * u, smallHeight), smallDp, SkinTokens.TextMuted, SkinUi.Type.Caption,
                        BodyNormal);
                }
            });
        }

        // A screen's buttons in one row (.btns): the primary fills up to 300u,
        // the others hug their words, 10u apart and centred; each leads with its
        // icon. Two buttons too wide for the column first set their words a step
        // smaller, then stack, the primary on top. Three buttons that do not fit
        // one row are a band and never three rows: the primary across the column,
        // 56u tall, over the other two side by side at equal widths and the touch
        // height. Where the page has no room for the band's two rows (oneRow),
        // the three share one row, their words as small as it takes. Either way
        // they read in their order, the destructive one last. made receives each
        // button and its label, by its index.
        // A small row (a pack's price on its row) keeps every button at the quiet
        // height, its lit words at 18u.
        // A button's words shrink toward 14 dp to fit it and, past that, take
        // their shorter form (shorter, by index) where there is one.
        public Piece Buttons((string name, string label, Action click, Kind kind, string icon)[] items, Action<int, Button, TMP_Text> made = null, bool small = false,
            string[] shorter = null, bool oneRow = false)
        {
            float u = U, gap = 10 * u, column = width;
            float primaryDp = small ? 18 * K : 24 * K, secondaryDp = small ? 18 * K : 20 * K;
            float Size((string name, string label, Action click, Kind kind, string icon) item) =>
                item.kind == Kind.Primary ? primaryDp : item.kind == Kind.Secondary ? secondaryDp : QuietDp;
            SkinUi.Type Face((string name, string label, Action click, Kind kind, string icon) item) => item.kind == Kind.Quiet ? SkinUi.Type.Caption : SkinUi.Type.Display;
            float Tall((string name, string label, Action click, Kind kind, string icon) item) => item.kind == Kind.Quiet || small ? QuietHeight : 62 * u;
            float Wide((string name, string label, Action click, Kind kind, string icon) item) =>
                TextWidth(item.label, Size(item), Face(item)) + (item.icon == null ? 0 : 28 * u + 8 * u) + 32 * u;
            float Row() => items.Sum(Wide) + gap * (items.Length - 1);
            bool three = items.Length == 3 && items.Count(item => item.kind == Kind.Primary) == 1 && items[0].kind == Kind.Primary;
            if (three && !oneRow && Row() > column)
            {
                float tall = Touch(56), low = QuietHeight;
                return new Piece(tall + gap + low, rect => {
                    float half = (rect.width - gap) / 2;
                    for (int i = 0; i < 3; i++)
                    {
                        var at = i == 0 ? new Rect(rect.x, rect.yMax - tall, rect.width, tall) : new Rect(i == 1 ? rect.x : rect.xMax - half, rect.y, half, low);
                        var button = ButtonIn(items[i], at, i == 0 ? 24 * K : items[i].kind == Kind.Quiet ? QuietDp : 18 * K, shorter?[i], out var text);
                        made?.Invoke(i, button, text);
                    }
                });
            }
            if (!small && Row() > column) { primaryDp = 20 * K; secondaryDp = 18 * K; }
            bool stacked = Row() > column && !oneRow;
            var order = Enumerable.Range(0, items.Length).OrderBy(i => stacked && items[i].kind != Kind.Primary).ToArray();
            float rowHeight = items.Length == 0 ? 0 : items.Max(Tall);
            float height = stacked ? items.Sum(Tall) + gap * (items.Length - 1) : rowHeight;
            return new Piece(height, rect => {
                // A row forced into the column gives each button its share of it.
                float squeeze = !stacked && Row() > rect.width ? (rect.width - gap * (items.Length - 1)) / items.Sum(Wide) : 1;
                float others = items.Where(item => item.kind != Kind.Primary).Sum(item => Wide(item) * squeeze) + gap * (items.Length - 1);
                float primary = items.Any(item => item.kind == Kind.Primary)
                    ? Mathf.Clamp(rect.width - others, Wide(items.First(item => item.kind == Kind.Primary)) * squeeze, 300 * u) : 0;
                float x = rect.center.x - (primary + others) / 2, y = rect.yMax;
                foreach (int i in order)
                {
                    var item = items[i];
                    float w = stacked ? Mathf.Min(column, Mathf.Max(primary, Wide(item))) : item.kind == Kind.Primary ? primary : Wide(item) * squeeze, h = Tall(item);
                    var at = stacked ? new Rect(rect.center.x - w / 2, y - h, w, h) : new Rect(x, rect.yMax - rowHeight / 2 - h / 2, w, h);
                    var button = ButtonIn(item, at, Size(item), shorter?[i], out var text);
                    made?.Invoke(i, button, text);
                    x += w + gap; y -= h + gap;
                }
            });
        }
        // One button of a row or a band, in its rect: its face by its kind, its
        // icon and words centred together (.b3), 8u apart. Words too wide for it
        // take their shorter form where there is one, then shrink toward 14 dp.
        private Button ButtonIn((string name, string label, Action click, Kind kind, string icon) item, Rect at, float size, string shorter, out TMP_Text text)
        {
            float u = U;
            Button button;
            if (item.kind == Kind.Quiet) button = QuietButton(item.name, at, item.label, item.click, item.icon, out text);
            else
            {
                button = Ui.TextButton(item.name, at, item.label, item.click, item.kind == Kind.Primary, Parent, out text,
                    item.icon, SkinUi.Type.Display, size, 28 * K);
                // The carved icons keep their own colours.
                foreach (var image in button.GetComponentsInChildren<Image>().Where(image => image.name.EndsWith(" icon"))) image.color = Color.white;
            }
            text.textWrappingMode = TextWrappingModes.NoWrap;
            float lead = item.icon == null ? 0 : 36 * u, room = at.width - 32 * u - lead, floor = PageColumn.ButtonMinimumDp / Ui.Scale;
            // Measured on the label itself, as it draws.
            var label = text;
            float Measure() => label.GetPreferredValues(label.text, float.PositiveInfinity, float.PositiveInfinity).x + Ui.Density;
            float words = Measure();
            if (words > room && shorter != null && room / words * size < floor) { text.text = shorter; words = Measure(); }
            if (words > room)
            {
                size = Mathf.Max(floor, size * room / words);
                text.fontSize = size * Ui.Density * Ui.Scale; words = Measure();
            }
            float left = Mathf.Max(at.x + 16 * u, at.center.x - (lead + words) / 2);
            var glyph = button.transform.Find(item.name + " icon");
            if (glyph != null) SkinUi.Place((RectTransform)glyph, new Rect(left, at.center.y - 14 * u, 28 * u, 28 * u), button.transform);
            SkinUi.Place(text.rectTransform, new Rect(left + lead, at.y, Mathf.Min(words, at.xMax - 16 * u - left - lead), at.height), button.transform);
            if (item.kind == Kind.Primary)
            {
                var halo = Ui.Glow(button.name + " halo", new Rect(at.x - at.width * .15f, at.y - at.height * .15f, at.width * 1.3f, at.height * 1.3f),
                    SkinUi.WithAlpha(Ui.Art.Token(SkinTokens.Accent), .4f), Parent, PageViews.HaloSeconds);
                halo.transform.SetSiblingIndex(button.transform.GetSiblingIndex());
            }
            return button;
        }
        // A quiet button (.b3.q): the dark pill with its words in the caption face, padded 16u.
        public Button QuietButton(string name, Rect rect, string label, Action click, string icon, out TMP_Text text)
        {
            float u = U;
            var face = Ui.Pill(name, rect, Parent, new Color(15 / 255f, 42 / 255f, 56 / 255f, 1));
            face.raycastTarget = true;
            var rim = Ui.Pill(name + " rim", rect, face.transform, new Color(63 / 255f, 113 / 255f, 133 / 255f, .9f));
            var hole = Ui.Pill(name + " fill", new Rect(rect.x + 1.5f * u, rect.y + 1.5f * u, rect.width - 3 * u, rect.height - 3 * u), face.transform,
                new Color(15 / 255f, 42 / 255f, 56 / 255f, 1));
            var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = face;
            button.onClick.AddListener(() => click());
            face.gameObject.AddComponent<PressSquash>();
            if (icon != null) Ui.Piece(name + " icon", icon, new Rect(rect.x + 16 * u, rect.center.y - 14 * u, 28 * u, 28 * u), face.transform);
            text = Ui.Label(name + " label", label, new Rect(rect.x + 16 * u, rect.y, rect.width - 32 * u, rect.height), QuietDp,
                SkinTokens.Text, face.transform, SkinUi.Type.Caption);
            return button;
        }

        // The tab bar's rect as the wireframe draws it (.tabs3), the last piece of
        // a tab page: inside the gutters, its bottom on the column's foot, padded
        // 4u round cells of 6u, a 26u icon, 2u and the label's line.
        public static Rect TabRect(SkinUi ui, Rect screen, Rect safe)
        {
            var kit = new ScreenKit(ui, null, screen, safe);
            float u = kit.U, k = kit.K, label = Mathf.Max(11, 11 * k) * ui.Scale * ui.Density * BodyNormal;
            float height = 4 * u + 6 * u + 26 * u + 2 * u + label + 6 * u + 4 * u;
            return new Rect(safe.center.x - kit.Width / 2, kit.bottom, kit.Width, height);
        }
    }

    // A control's role, set by the kit where it places the control (ScreenKit.As).
    public sealed class Placed : MonoBehaviour { public ScreenKit.Role Role; }
}
