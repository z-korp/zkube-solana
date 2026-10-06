using System;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using Piece = ZKube.Presentation.ScreenKit.Piece;

namespace ZKube.Presentation
{
    // Identity pages and the identity's blocks on the shared pages: an identity
    // describes what it shows as panel blocks, and these compose them from the
    // screen kit as the wireframes draw the Arena's pages: the title, the blocks
    // top-down, and the page's foot (its primary button and any buttons after
    // it) at the bottom.
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
            Shown = null; shownPanel = page; unavailable = null;
            ui = new SkinUi(shell.Artwork, Mathf.Max(.5f, density()), textScale);
            var messages = (notices ?? Enumerable.Empty<string>()).Where(value => !string.IsNullOrEmpty(value)).ToArray();
            float kept = entering ? -1 : shell.Offset;
            pageNotices = messages;
            Frame(page.Tab, null, null, page.Back ?? page.Corner, null,
                leftIcon: page.Back == null && page.CornerIcon != null ? page.CornerIcon : SkinSlots.IconBack);
            var kit = Kit; var pieces = new List<Piece>();
            if ((page.Title ?? page.Subtitle) != null) pieces.Add(kit.Title(page.Title ?? page.Subtitle, page.Title == null ? null : page.Subtitle, room: TitleRoom(kit)));
            PanelBody(page.Blocks, pieces, page.Tab.HasValue);
            FinishPage();
            if (kept >= 0) shell.Offset = kept;
            if (entering) shell.Enter(reducedMotion, ui.Density);
            Music(true); Drawn();
        }

        // A page's blocks under its title: a page without tabs centres them
        // between spacers; the foot, from the page's last primary button on,
        // sits at the bottom with its other buttons as secondaries.
        private void PanelBody(PanelBlock[] blocks, List<Piece> pieces, bool tabs)
        {
            var kit = Kit;
            int foot = Array.FindLastIndex(blocks, block => block.Kind == PanelKind.Button && block.Primary == 0);
            if (foot < 0 || blocks.Skip(foot).Any(block => block.Kind != PanelKind.Button)) foot = blocks.Length;
            if (!tabs) pieces.Add(Piece.Grow);
            pieces.AddRange(BlockPieces(blocks.Take(foot).ToList(), kit, false));
            pieces.Add(Piece.Grow);
            if (foot < blocks.Length)
                pieces.Add(Buttons(kit, blocks.Skip(foot).Select(block => (block.Action, block.Primary == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Secondary,
                    block.Sprite)).ToArray()));
            Compose(pieces.ToArray());
        }

        // An identity's blocks as pieces of a composed screen (Home's Arcade
        // words, Settings' device card).
        private Piece BlockPiece(string name, IEnumerable<PanelBlock> blocks, ScreenKit kit) => kit.Stack(10, BlockPieces(blocks.ToList(), kit, false).ToArray());

        // Blocks top-down; buttons side by side share a row. An identity page is a
        // utility page and carries no guardian (owner, 2026-10-06): no block draws one.
        private List<Piece> BlockPieces(IReadOnlyList<PanelBlock> blocks, ScreenKit kit, bool inCard)
        {
            var pieces = new List<Piece>();
            for (int i = 0; i < blocks.Count; i++)
            {
                var block = blocks[i];
                if (block.Kind == PanelKind.Button)
                {
                    var run = blocks.Skip(i).TakeWhile(next => next.Kind == PanelKind.Button).ToArray();
                    pieces.Add(Buttons(kit, run.Select(button => (button.Action, button.Primary == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet, button.Sprite))
                        .ToArray()));
                    i += run.Length - 1;
                    continue;
                }
                if (block.Kind == PanelKind.Space) { pieces.Add(Piece.Grow); continue; }
                var piece = Block(block, kit, inCard);
                if (piece.Height > 0 || piece.Draw != null) pieces.Add(piece);
            }
            return pieces;
        }

        private Piece Block(PanelBlock block, ScreenKit kit, bool inCard)
        {
            float u = kit.U, k = kit.K;
            switch (block.Kind)
            {
                case PanelKind.Title:
                {
                    float size = (inCard ? 20 : 22) * k, height = kit.Block(block.Copy, kit.Width, size, SkinUi.Type.Display, ScreenKit.TitleLeading);
                    var align = block.Centered ?? !inCard ? TextAlignmentOptions.Center : TextAlignmentOptions.Left;
                    return new Piece(height, rect => kit.Text(block.Name, block.Copy, rect, size, block.Token, SkinUi.Type.Display, ScreenKit.TitleLeading, align));
                }
                case PanelKind.Text:
                    if (block.Action == null) return TextPiece(block, kit, inCard);
                    // A state and the quiet button that changes it.
                    return kit.Row(block.Name, null, block.Copy, null, Quiet(kit, block.Action), false, block.Token);
                case PanelKind.Eyebrow:
                {
                    float height = kit.HeaderDp * ui.Scale * ui.Density * ScreenKit.DisplayNormal;
                    return new Piece(height, rect => Header(kit, block.Name, block.Copy, block.Tag == null ? (ScreenKit.Side?)null : Tag(kit, block.Tag, block.TagToken), rect));
                }
                case PanelKind.Figure:
                {
                    // The balance (.card3 row): its icon, if any, the 48u number and its unit over the caption, centred.
                    float icon = block.Sprite == null ? 0 : Step(52, 40) * u, size = 48 * k;
                    var (shown, fitted) = NumberFit.Fit(ui, block.Value, kit.Width / 2, size);
                    float number = ui.TextWidth(shown, fitted, SkinUi.Type.Display);
                    string unit = block.Copy ?? "";
                    float words = Mathf.Max(ui.TextWidth(unit, kit.CaptionDp, SkinUi.Type.Caption), ui.TextWidth(block.Caption ?? "", kit.SmallDp, SkinUi.Type.Caption));
                    float lead = icon == 0 ? 0 : icon + 10 * u, width = lead + number + 10 * u + words, height = Mathf.Max(icon, size * ui.Scale * ui.Density);
                    return new Piece(height, rect => {
                        float x = rect.center.x - width / 2;
                        if (block.Sprite != null) ui.Piece(block.Name + " icon", block.Sprite, new Rect(x, rect.center.y - icon / 2, icon, icon), shell.Page);
                        x += lead;
                        kit.Text(block.Name, shown, new Rect(x, rect.y, number, rect.height), fitted, SkinTokens.Score, SkinUi.Type.Display, 1,
                            TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
                        x += number + 10 * u;
                        float unitHeight = kit.Block(unit, words + 2, kit.CaptionDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                        float captionHeight = kit.Block(block.Caption, words + 2, kit.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                        float top = rect.center.y + (unitHeight + captionHeight) / 2;
                        kit.Text(block.Name + " unit", unit, new Rect(x, top - unitHeight, words + 2, unitHeight), kit.CaptionDp, SkinTokens.Text, SkinUi.Type.Caption,
                            ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
                        if (block.Caption != null)
                            kit.Text(block.Name + " caption", block.Caption, new Rect(x, top - unitHeight - captionHeight, words + 2, captionHeight), kit.SmallDp,
                                SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
                    });
                }
                case PanelKind.Split:
                {
                    // A captioned number and, beside it, a second value: a payout, or a tier's badge and name.
                    var first = Fitted(kit, block.Name, block.Value, kit.Width * .4f);
                    ScreenKit.Side second = block.Badge == null ? Fitted(kit, block.Name + " side", block.Copy, kit.Width * .4f)
                        : kit.Beside(8, kit.Icon(block.Name + " badge", block.Badge, 40), Fitted(kit, block.Name + " side", block.Copy, kit.Width * .3f));
                    return kit.Row(block.Name, null, block.Caption, null, kit.Beside(16, first, second), false);
                }
                case PanelKind.Row: return RowPiece(block, kit);
                case PanelKind.Icon:
                {
                    float size = 56 * u;
                    return new Piece(size, rect => Tinted(block.Name, block.Sprite, new Rect(rect.center.x - size / 2, rect.y, size, size), block.Token, shell.Page));
                }
                case PanelKind.Portrait:
                {
                    float size = Step(120, 96) * u;
                    return new Piece(size, rect => ui.Medallion(block.Name, new Rect(rect.center.x - size / 2, rect.y, size, size), EmblemArt(block.Emblem), shell.Page,
                        block.Ring));
                }
                case PanelKind.Pair:
                    // A pair with one shown is two views of one thing; without, two actions.
                    if (block.Primary >= 0) return Segments(block, kit);
                    return Buttons(kit, block.Actions.Select((action, i) => (action, block.Primary == i ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet, (string)null))
                        .ToArray());
                case PanelKind.Bar:
                {
                    // A chip and quiet buttons on one line, 8u apart, the chip at one end (.chip3 beside .b3.q).
                    var chip = kit.Chip(block.Name + " chip", block.Sprite, 20, block.Value, block.Copy);
                    var buttons = block.Actions.Where(action => action != null).Select(action => Quiet(kit, action)).ToArray();
                    float height = Mathf.Max(chip.Height, buttons.Length == 0 ? 0 : buttons.Max(button => button.Height));
                    return new Piece(height, rect => {
                        float x = block.ChipAtEnd ? rect.x : rect.xMax - buttons.Sum(button => button.Width) - 8 * u * Mathf.Max(0, buttons.Length - 1);
                        foreach (var button in buttons) { button.Draw(new Rect(x, rect.center.y - button.Height / 2, button.Width, button.Height)); x += button.Width + 8 * u; }
                        float chipX = block.ChipAtEnd ? rect.xMax - chip.Width : rect.x;
                        chip.Draw(new Rect(chipX, rect.center.y - chip.Height / 2, chip.Width, chip.Height));
                    });
                }
                case PanelKind.Card: return CardPiece(block, kit);
                case PanelKind.Stepper: return StepperPiece(block, kit);
                case PanelKind.Rows: return RowsPiece(block, kit);
                case PanelKind.Balance: return BalancePiece(block, kit);
                case PanelKind.Packs: return PacksPiece(block, kit);
                default: throw new ArgumentOutOfRangeException(nameof(block));
            }
        }

        // Words: centred notes on the page (.t3b), left-aligned captions in a
        // card, muted ones a step smaller.
        private Piece TextPiece(PanelBlock block, ScreenKit kit, bool inCard)
        {
            bool muted = block.Token == SkinTokens.TextMuted;
            float size = !inCard ? kit.SubtitleDp : muted ? kit.SmallDp : kit.CaptionDp, leading = inCard ? ScreenKit.CaptionLeading : ScreenKit.NoteLeading;
            var align = block.Centered ?? !inCard ? TextAlignmentOptions.Center : TextAlignmentOptions.Left;
            float height = kit.Block(block.Copy, kit.Width, size, SkinUi.Type.Caption, leading);
            return new Piece(height, rect => kit.Text(block.Name, block.Copy, rect, size, block.Token, SkinUi.Type.Caption, leading, align));
        }

        // A card (.card3): its first line, small capitals or a titled tag line,
        // is its header.
        private Piece CardPiece(PanelBlock block, ScreenKit kit)
        {
            var lines = block.Lines.ToList();
            string header = null; ScreenKit.Side? tag = null;
            if (lines.Count != 0 && (lines[0].Kind == PanelKind.Eyebrow || lines[0].Kind == PanelKind.Title && lines[0].Tag != null))
            {
                header = lines[0].Copy;
                if (lines[0].Tag != null) tag = Tag(kit, lines[0].Tag, lines[0].TagToken);
                lines.RemoveAt(0);
            }
            return kit.Card(header, BlockPieces(lines, kit.Inside(), true), block.Name, tag);
        }

        // A row (.row3): its icon, or a choice's border and badge, the label and
        // its detail, and the value, a tag or a button on the right. A row with
        // an action is one button; a dimmed choice takes no tap.
        private Piece RowPiece(PanelBlock block, ScreenKit kit)
        {
            float u = kit.U;
            ScreenKit.Side? lead = null;
            if (block.Sprite != null)
            {
                var border = kit.Icon(block.Name + " border", block.Sprite, 44);
                lead = block.Badge == null ? border : kit.Beside(6, border, kit.Icon(block.Name + " badge", block.Badge, 32));
            }
            else if (block.Pictogram != null) lead = kit.Pictogram(block.Name, block.Pictogram, block.Chip, 30);
            ScreenKit.Side? right = block.Value == null ? (ScreenKit.Side?)null : block.Tag != null ? Tag(kit, block.Value, block.TagToken, block.Name)
                : Fitted(kit, block.Name, block.Value, kit.Width * .45f, block.Dim ? SkinTokens.TextMuted : block.Token);
            if (block.Action != null && block.Sprite == null && block.Value == null) right = Small(kit, block.Action, block.Primary == 0);
            var row = kit.Row(block.Name + " row", lead, block.Copy, block.Caption, right, false);
            bool tapped = block.Action != null && block.Value != null && !block.Dim || block.Action != null && block.Sprite != null && !block.Dim;
            return new Piece(row.Height, rect => {
                var face = ui.Rect<Image>(block.Name, rect, shell.Page); face.color = Color.clear; face.raycastTarget = false;
                if (block.Dim) face.gameObject.AddComponent<CanvasGroup>().alpha = .35f;
                row.Draw(rect);
                if (tapped) Tap(face, block.Action);
            });
        }
        // A value on a row's right, set smaller to fit its share of the row.
        private ScreenKit.Side Fitted(ScreenKit kit, string name, string value, float width, string token = SkinTokens.Score)
        {
            var (shown, size) = NumberFit.Fit(ui, value, width, kit.NumeralDp);
            return kit.Value(name, shown, token, size);
        }
        // A small pill on a row's right (.b3 at the quiet height): a pack's price.
        private ScreenKit.Side Small(ScreenKit kit, PageAction action, bool primary)
        {
            var buttons = kit.Buttons(new[] { (action.Name ?? action.Label, action.Label, actions.Click(action), primary ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet,
                (string)null) }, (i, button, text) => actions.Bind(button, action, relabel: value => text.text = value), small: true);
            float width = ui.TextWidth(action.Label, primary ? 18 * kit.K : kit.QuietDp, primary ? SkinUi.Type.Display : SkinUi.Type.Caption) + 32 * kit.U;
            return new ScreenKit.Side(width, buttons.Height, buttons.Draw);
        }
        // A card's header line (.hd): the display face's muted capitals, and its tag beside it.
        private void Header(ScreenKit kit, string name, string text, ScreenKit.Side? tag, Rect rect)
        {
            var label = kit.Text(name, text.ToUpperInvariant(), rect, kit.HeaderDp, SkinTokens.TextMuted, SkinUi.Type.Display, ScreenKit.DisplayNormal,
                TextAlignmentOptions.Left);
            label.characterSpacing = 6;
            if (!tag.HasValue) return;
            label.ForceMeshUpdate();
            float x = rect.x + label.textBounds.size.x + 6 * kit.U;
            tag.Value.Draw(new Rect(x, rect.center.y - tag.Value.Height / 2, tag.Value.Width, tag.Value.Height));
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
    }
}
