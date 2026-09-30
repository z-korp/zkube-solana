using System;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Identity pages and the identity's blocks on the shared pages: an identity
    // describes what it shows as panel blocks, and these draw them from the kit
    // with the same spacing the shared pages use.
    public sealed partial class PageViews
    {
        private PanelPageView shownPanel;
        public string ShownPanel => shownPanel?.Key;

        public void RenderPanel(PanelPageView page, IEnumerable<string> notices = null)
        {
            if (page == null) throw new ArgumentNullException(nameof(page));
            if (shell.Artwork == null) throw new InvalidOperationException("Load the page realm before drawing it");
            shownNotices = notices?.ToArray();
            Retire();
            bool entering = Shown.HasValue || shownPanel?.Key != page.Key;
            reducedMotion = source.SettingsPage().ReducedMotion;
            editedName = null; savedName = null; editingName = false;
            Shown = null; shownPanel = page;
            ui = new SkinUi(shell.Artwork, Mathf.Max(.5f, density()), textScale);
            var messages = (notices ?? Enumerable.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)).ToArray();
            float kept = entering ? -1 : shell.Offset;
            Frame(page.Tab, page.Title, page.Subtitle, page.Back ?? page.Corner, null, messages,
                leftIcon: page.Back == null && page.CornerIcon != null ? page.CornerIcon : SkinSlots.IconBack);
            Blocks(page.Blocks);
            shell.Finish(column.Top - (16 + FadeDp) * ui.Density);
            if (kept >= 0) shell.Offset = kept;
            if (entering) shell.Enter(reducedMotion, ui.Density);
        }

        private void Blocks(IEnumerable<PanelBlock> blocks) { foreach (var block in blocks) Block(column, block, false); }

        private void Block(PageColumn at, PanelBlock block, bool inCard)
        {
            float d = ui.Density;
            var align = block.Centered ?? !inCard ? TextAlignmentOptions.Center : TextAlignmentOptions.Left;
            if (block.Kind != PanelKind.Talk) at.Gap(block.Lead);
            switch (block.Kind)
            {
                case PanelKind.Talk:
                {
                    at.Gap(block.Lead - 4);
                    var box = Speak(block.Name, shell.Page, at.Left, at.Top, at.Width, catalog.Realm(ui.Art.RealmId),
                        new[] { new TalkPage(block.Copy, block.Mood) }, null, false);
                    at.Top = box.y - (block.Gap ?? 38) * d;
                    break;
                }
                case PanelKind.Title:
                {
                    var title = at.Typed(block.Name, block.Copy, SkinUi.Type.Title, block.Size, block.Token, block.Gap ?? 14, align);
                    Loose(title, inCard);
                    if (block.Tag != null)
                        ui.Label(block.Name + " tag", block.Tag, SkinUi.ScreenRect(title.rectTransform), 11, block.TagToken, at.Parent, SkinUi.Type.Label,
                            TextAlignmentOptions.Right);
                    break;
                }
                case PanelKind.Text:
                    if (block.Action != null) { Status(at, block); break; }
                    Loose(at.Typed(block.Name, block.Copy, SkinUi.Type.Caption, block.Size, block.Token, block.Gap ?? 10, align), inCard);
                    break;
                case PanelKind.Eyebrow:
                {
                    float height = ui.TextHeight(block.Copy, at.Width, 12, SkinUi.Type.Label);
                    var rect = at.Take(height, block.Gap ?? 14);
                    ui.Label(block.Name, block.Copy, rect, 12, block.Token, at.Parent, SkinUi.Type.Label, TextAlignmentOptions.Left);
                    if (block.Tag != null)
                        ui.Label(block.Name + " tag", block.Tag, rect, 11, block.TagToken, at.Parent, SkinUi.Type.Label, TextAlignmentOptions.Right);
                    break;
                }
                case PanelKind.Figure: Figure(at, block); break;
                case PanelKind.Split: Split(at, block); break;
                case PanelKind.Row:
                    if (block.Sprite != null) Choice(at, block, inCard);
                    else ValueRow(at, block, inCard);
                    break;
                case PanelKind.Icon:
                {
                    float size = block.Size * d;
                    var rect = at.Take(size, block.Gap ?? 22);
                    Tinted(block.Name, block.Sprite, new Rect(rect.center.x - size / 2, rect.y, size, size), block.Token, at.Parent);
                    break;
                }
                case PanelKind.Portrait:
                {
                    float size = block.Size * d;
                    var rect = at.Take(size, block.Gap ?? 16);
                    ui.Medallion(block.Name, new Rect(rect.center.x - size / 2, rect.y, size, size), EmblemArt(block.Emblem), at.Parent, block.Ring);
                    break;
                }
                case PanelKind.Button:
                {
                    // Pills keep the kit's 320 dp width, centred on the page.
                    float width = Mathf.Min(320 * d, at.Width);
                    var pill = new PageColumn(ui, at.Parent, actions, at.Left + (at.Width - width) / 2, width, at.Top);
                    Pill(pill, block.Action, block.Primary == 0, null, block.Gap ?? 20);
                    at.Top = pill.Top;
                    break;
                }
                case PanelKind.Pair:
                {
                    // Two 160 dp pills with 16 dp between them, over the list rows' width.
                    float width = Mathf.Min(336 * d, at.Width + (inCard ? 16 : -32) * d), gap = 16 * d, half = (width - gap) / 2;
                    float left = at.Left + (at.Width - width) / 2, top = at.Top;
                    float bottom = top;
                    for (int i = 0; i < 2; i++)
                    {
                        if (block.Actions[i] == null) continue;
                        var halfColumn = new PageColumn(ui, at.Parent, actions, left + i * (half + gap), half, top);
                        Pill(halfColumn, block.Actions[i], block.Primary == i, null, block.Gap ?? 20);
                        bottom = Mathf.Min(bottom, halfColumn.Top);
                    }
                    at.Top = bottom;
                    break;
                }
                case PanelKind.Card:
                {
                    var card = at.Card(block.Name, null, 24, 22, 22);
                    foreach (var line in block.Lines) Block(card, line, true);
                    card.End(block.Gap ?? 18);
                    break;
                }
                default: throw new ArgumentOutOfRangeException(nameof(block));
            }
        }

        // Text over the painting is lifted by the kit's underpaint, under its ink.
        private void Loose(TMP_Text text, bool inCard)
        {
            if (inCard) return;
            var rect = SkinUi.ScreenRect(text.rectTransform);
            text.ForceMeshUpdate();
            float ink = Mathf.Min(rect.width, text.textBounds.size.x + 8 * ui.Density);
            if (text.alignment == TextAlignmentOptions.Center) Shade(rect, ink, text.transform.parent);
            else ui.Underpaint("Text shade", new Rect(rect.x - 4 * ui.Density, rect.y, ink, rect.height), text.transform.parent);
            text.transform.SetAsLastSibling();
        }

        // A state on the left and the half-width pill that changes it on the right.
        private void Status(PageColumn at, PanelBlock block)
        {
            float d = ui.Density, pill = Mathf.Min(160 * d, at.Width / 2);
            var rect = at.Take(PageColumn.ButtonDp * d, block.Gap ?? 10);
            ui.Label(block.Name, block.Copy, new Rect(rect.x, rect.y, rect.width - pill - 8 * d, rect.height), block.Size, block.Token, at.Parent,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
            var right = new PageColumn(ui, at.Parent, actions, rect.xMax - pill + 8 * d, pill, rect.yMax);
            Pill(right, block.Action, false, null, 0);
        }

        // A caption over a big number and its unit, with a sprite on the left:
        // the confirmed balance.
        private void Figure(PageColumn at, PanelBlock block)
        {
            float d = ui.Density, icon = block.Sprite == null ? 0 : 56 * d, indent = block.Sprite == null ? 0 : icon + 28 * d;
            float captionHeight = block.Caption == null ? 0 : ui.TextHeight(block.Caption, at.Width - indent, 12, SkinUi.Type.Label);
            // The number takes what the unit leaves, on one line.
            float unit = block.Copy == null ? 0 : ui.TextWidth(block.Copy, 18, SkinUi.Type.Caption) + 12 * d;
            var (shown, size) = NumberFit.Fit(ui, block.Value, at.Width - indent - unit, block.Size);
            float valueWidth = ui.TextWidth(shown, size, SkinUi.Type.Number);
            float valueHeight = ui.TextHeight(shown, float.PositiveInfinity, size, SkinUi.Type.Number);
            float height = Mathf.Max(icon, captionHeight + (block.Caption == null ? 0 : 12 * d) + valueHeight);
            var rect = at.Take(height, block.Gap ?? 14);
            if (block.Sprite != null)
                Tinted(block.Name + " icon", block.Sprite, new Rect(rect.x + 8 * d, rect.center.y - icon / 2 - 4 * d, icon, icon), block.Token, at.Parent);
            float x = rect.x + indent, top = rect.yMax;
            if (block.Caption != null)
                ui.Label(block.Name + " caption", block.Caption, new Rect(x, top - captionHeight, rect.xMax - x, captionHeight), 12, SkinTokens.TextMuted,
                    at.Parent, SkinUi.Type.Label, TextAlignmentOptions.Left);
            var value = new Rect(x, rect.y, valueWidth, valueHeight);
            ui.Label(block.Name, shown, value, size, SkinTokens.Score, at.Parent, SkinUi.Type.Number, TextAlignmentOptions.BottomLeft)
                .textWrappingMode = TextWrappingModes.NoWrap;
            if (block.Copy != null)
                ui.Label(block.Name + " unit", block.Copy, new Rect(value.xMax + 12 * d, rect.y + 4 * d, rect.xMax - value.xMax - 12 * d, valueHeight), 18,
                    SkinTokens.Text, at.Parent, SkinUi.Type.Caption, TextAlignmentOptions.BottomLeft);
        }

        // A captioned number on the left and, 136 dp across, a second value: a
        // payout, or a tier's badge and name.
        private void Split(PageColumn at, PanelBlock block)
        {
            // The second value starts 136 dp across, or further when the first is
            // wider; each number stays on one line in its part.
            float d = ui.Density, across = Mathf.Clamp(ui.TextWidth(block.Value, block.Size, SkinUi.Type.Number) + 16 * d, 136 * d, at.Width - 150 * d);
            float captionHeight = block.Caption == null ? 0 : ui.TextHeight(block.Caption, across, 11, SkinUi.Type.Label);
            float valueHeight = ui.TextHeight("0", float.PositiveInfinity, block.Size, SkinUi.Type.Number);
            var rect = at.Take(captionHeight + (block.Caption == null ? 0 : 10 * d) + valueHeight, block.Gap ?? 14);
            if (block.Caption != null)
                ui.Label(block.Name + " caption", block.Caption, new Rect(rect.x, rect.yMax - captionHeight, rect.width, captionHeight), 11,
                    SkinTokens.TextMuted, at.Parent, SkinUi.Type.Label, TextAlignmentOptions.Left);
            var line = new Rect(rect.x, rect.y, rect.width, valueHeight);
            FittedNumber(block.Name, block.Value, new Rect(line.x, line.y, across - 12 * d, line.height), block.Size, SkinTokens.Score, at.Parent,
                TextAlignmentOptions.Left);
            if (block.Badge == null && across + ui.TextWidth(block.Copy, block.Size - 2, SkinUi.Type.Number) > line.width)
            {
                // Too wide for one row (larger text on a small phone): the second value goes under the first.
                var under = at.Take(ui.TextHeight("0", float.PositiveInfinity, block.Size - 2, SkinUi.Type.Number), block.Gap ?? 14);
                FittedNumber(block.Name + " side", block.Copy, under, block.Size - 2, SkinTokens.Score, at.Parent, TextAlignmentOptions.Left);
                return;
            }
            if (block.Badge == null)
            {
                FittedNumber(block.Name + " side", block.Copy, new Rect(line.x + across, line.y, line.width - across, line.height), block.Size - 2,
                    SkinTokens.Score, at.Parent, TextAlignmentOptions.Left);
                return;
            }
            float badge = 40 * d, x = line.x + Mathf.Max(168 * d, across + 16 * d);
            var image = ui.Rect<Image>(block.Name + " badge", new Rect(x, line.center.y - badge / 2, badge, badge), at.Parent);
            image.sprite = ui.Art.SkinUi(block.Badge); image.preserveAspect = true; image.raycastTarget = false;
            ui.Label(block.Name + " side", block.Copy, new Rect(x + badge + 7 * d, line.y, line.xMax - x - badge - 7 * d, line.height), 23,
                SkinTokens.Text, at.Parent, SkinUi.Type.Title, TextAlignmentOptions.Left);
        }

        // A 52 dp list row with its label and number. In a card it reaches 8 dp
        // past the card's text; on the page it sits 16 dp inside the column.
        private void ValueRow(PageColumn at, PanelBlock block, bool inCard)
        {
            float d = ui.Density, inset = (inCard ? -8 : 16) * d;
            var rows = new PageColumn(ui, at.Parent, actions, at.Left + inset, at.Width - 2 * inset, at.Top);
            var row = ResultRow(rows, block.Name, block.Copy, block.Value, block.Dim ? SkinTokens.TextMuted : block.Token, block.Gap ?? 12);
            at.Top = rows.Top;
            if (block.Action != null) Tap(row, block.Action);
        }

        // A 56 dp choice row: a border and its badge, the name, and the choice's
        // state on the right; a choice that cannot be made is dimmed and takes no tap.
        private void Choice(PageColumn at, PanelBlock block, bool inCard)
        {
            float d = ui.Density, inset = (inCard ? -16 : 8) * d;
            var rect = new Rect(at.Left + inset, 0, at.Width - 2 * inset, 56 * d);
            rect.y = at.Take(rect.height, block.Gap ?? 10).y;
            var row = ui.Piece(block.Name, SkinSlots.ListRow, rect, at.Parent);
            var group = Holder(block.Name + " pictures", shell.ScreenArea, row.transform).gameObject.AddComponent<CanvasGroup>();
            group.alpha = block.Dim ? .35f : 1;
            var border = ui.Rect<Image>(block.Name + " border", new Rect(rect.x + 10 * d, rect.y + 3 * d, 50 * d, 50 * d), group.transform);
            border.sprite = ui.Art.SkinUi(block.Sprite); border.preserveAspect = true; border.raycastTarget = false;
            if (block.Badge != null)
            {
                var badge = ui.Rect<Image>(block.Name + " badge", new Rect(rect.x + 66 * d, rect.y + 10 * d, 36 * d, 36 * d), group.transform);
                badge.sprite = ui.Art.SkinUi(block.Badge); badge.preserveAspect = true; badge.raycastTarget = false;
            }
            float valueWidth = ui.TextWidth(block.Value, 14, SkinUi.Type.Caption);
            ui.Label(block.Name + " label", block.Copy, new Rect(rect.x + 112 * d, rect.y, rect.width - 150 * d - valueWidth, rect.height), 17, SkinTokens.Text,
                row.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            ui.Label(block.Name + " value", block.Value, new Rect(rect.xMax - 24 * d - valueWidth, rect.y, valueWidth, rect.height), 14,
                block.Dim ? SkinTokens.TextMuted : block.Token, row.transform, SkinUi.Type.Caption, TextAlignmentOptions.Right);
            if (block.Action != null && !block.Dim) Tap(row, block.Action);
        }

        // Makes a drawn row one button bound to its action.
        private void Tap(Image row, PageAction action)
        {
            row.raycastTarget = true; row.name = action.Name ?? action.Label;
            var button = row.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = row;
            row.gameObject.AddComponent<PressSquash>();
            actions.Wire(button, action, fade: false);
        }

        // An emblem's picture: a guardian's is its realm's portrait (the page is
        // drawn in that realm), an achievement's is its own painting.
        private Sprite EmblemArt(byte emblem) => emblem > Protocol.Realms.Length ? ui.Art.SkinUi(ProfileEmblems.Painting(emblem)) :
            ui.Art.Sprite("boss__portrait");

        // The Arcade's Daily panel, as drawn at 400 dp: the guardian's portrait
        // beside the realm, guardian and objective; the entry clock beside the
        // prize pool; then the entry action, or the reason there is none.
        private void Arcade(DailyPageView value, PageCatalog.RealmPage realm, string objective)
        {
            float d = ui.Density; var arcade = value.Arcade;
            var card = column.Card("Daily card", null, 24, 22, 16);
            card.Typed("Daily heading", "TODAY’S DAILY", SkinUi.Type.Label, 12, SkinTokens.Accent, 27, TextAlignmentOptions.Left);
            float portrait = 116 * d, indent = 116 * d;
            var text = new PageColumn(ui, card.Parent, actions, card.Left + indent, card.Width - indent, card.Top - 6 * d);
            text.Typed("Daily realm", realm.realmName, SkinUi.Type.Title, 28, SkinTokens.Text, 6, TextAlignmentOptions.Left);
            text.Typed("Daily guardian name", realm.guardianName, SkinUi.Type.Caption, 15, SkinTokens.TextMuted, 14, TextAlignmentOptions.Left);
            text.Typed("Daily objective", Sentence(objective), SkinUi.Type.Caption, 19, SkinTokens.Objective, 0, TextAlignmentOptions.Left);
            var head = card.Take(Mathf.Max(portrait, card.Top - text.Top), 20);
            ui.Medallion("Daily guardian", new Rect(card.Left - 10 * d, head.yMax - portrait, portrait, portrait), ui.Art.Sprite("boss__portrait"), card.Parent);

            // The clock on the left, the prize pool from 229 dp across, or as far
            // right as its widest line lets it sit.
            float pool = arcade.Pot == null ? 0 : Mathf.Min(card.Width * .45f,
                Mathf.Max(ui.TextWidth(arcade.Pot, 18, SkinUi.Type.Number), ui.TextWidth("PRIZE POOL", 11, SkinUi.Type.Label)) + 4 * d);
            float across = Mathf.Min(229 * d, card.Width - pool);
            var clock = new PageColumn(ui, card.Parent, actions, card.Left, across - 8 * d, card.Top);
            string headline = arcade.Headline ?? (value.ClosesAt > 0 && value.Now != null ? Remaining(value.ClosesAt - countdownSecond) : null);
            if (headline != null)
            {
                var label = clock.Typed("Daily countdown", headline, SkinUi.Type.Number, 21, SkinTokens.Accent, 8, TextAlignmentOptions.Left);
                if (arcade.Headline == null) countdown = label;
            }
            if (arcade.Closes != null) clock.Typed("Daily closes", arcade.Closes, SkinUi.Type.Caption, 12, SkinTokens.TextMuted, 0, TextAlignmentOptions.Left);
            float bottom = clock.Top;
            if (arcade.Pot != null)
            {
                var pot = new PageColumn(ui, card.Parent, actions, card.Left + across, card.Width - across, card.Top);
                pot.Typed("Prize pool caption", "PRIZE POOL", SkinUi.Type.Label, 11, SkinTokens.TextMuted, 10, TextAlignmentOptions.Left);
                pot.Typed("Prize pool", arcade.Pot, SkinUi.Type.Number, 18, SkinTokens.Score, 0, TextAlignmentOptions.Left);
                bottom = Mathf.Min(bottom, pot.Top);
            }
            card.Top = bottom - 30 * d;
            if (arcade.Reason != null)
            {
                card.Typed("Daily reason", arcade.Reason, SkinUi.Type.Caption, 18, arcade.Warning ? SkinTokens.Negative : SkinTokens.Text, 10);
                if (arcade.Detail != null) card.Typed("Daily reason detail", arcade.Detail, SkinUi.Type.Caption, 14, arcade.Warning ? SkinTokens.Text : SkinTokens.TextMuted, 16);
            }
            else card.Gap(6);
            for (int i = 0; i < value.Actions.Length; i++) Pill(card, value.Actions[i], i == 0, null, i == value.Actions.Length - 1 ? 4 : 12);
            column = card.End(18);
        }
    }
}
