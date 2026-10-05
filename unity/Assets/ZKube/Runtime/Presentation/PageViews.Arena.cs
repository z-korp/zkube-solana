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
    // The Arena's landing page and the pieces its boards are drawn with.
    public sealed partial class PageViews
    {
        // How many of a board's top rows the landing page shows: as many as fit
        // under the Daily card without scrolling, ten at most and never under
        // five (what the compact phone holds with a reason line, the rewards
        // badge and the larger text size).
        public const int LandingRowsSeeker = 10, LandingRowsCompact = 5;

        // The Arena's Home, one glanceable page: the Arena lockup over the
        // painting; today's Daily card with the prize pool, the Kredit figure
        // and the one action, which is the player's next step (and why no entry
        // can be made, when none can); then today's boards side by side.
        private void ArcadeHome(DailyPageView value)
        {
            var kit = Kit;
            var arcade = value.Arcade; var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            long? clock = arcade.Headline == null && value.ClosesAt > 0 && value.Now != null ? value.ClosesAt - countdownSecond : (long?)null;
            var inside = kit.Inside();
            var rows = new List<Piece>();
            if (arcade.Pot != null || arcade.Kredits != null) rows.Add(PotRow(inside, arcade));
            if (arcade.Reason != null)
            {
                rows.Add(CardLine("Daily reason", arcade.Reason, arcade.Warning ? SkinTokens.Negative : SkinTokens.Text, inside));
                if (arcade.Detail != null) rows.Add(CardLine("Daily reason detail", arcade.Detail, arcade.Warning ? SkinTokens.Text : SkinTokens.TextMuted, inside));
            }
            var pieces = new List<Piece> { Lockup(kit, Step(90, 72)), DailyCard(kit, value, realm.guardianName + " · " + realm.realmName, clock, false, rows.ToArray(),
                Buttons(inside, value.Actions.Select((action, i) => (action, i == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet,
                    i == 0 ? SkinSlots.IconPlay : (string)null)).ToArray())) };
            if (arcade.HasBoards)
            {
                // The boards take the room the Daily card leaves, less the gaps to it and to the page's foot.
                float room = kit.Spare(pieces.ToArray()) - 20 * kit.U;
                int shown = (int)Step(LandingRowsSeeker, LandingRowsCompact);
                while (shown > LandingRowsCompact && BoardsCard(kit, arcade, shown).Height > room) shown--;
                pieces.Add(BoardsCard(kit, arcade, shown));
            }
            pieces.Add(Piece.Grow);
            Compose(pieces.ToArray());
            ShowPortraits();
        }
        // A centred line inside a card, in its own name and ink.
        private Piece CardLine(string name, string text, string token, ScreenKit inside)
        {
            float height = inside.Block(text, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            return new Piece(height, rect => inside.Text(name, text, rect, inside.SmallDp, token, SkinUi.Type.Caption, ScreenKit.CaptionLeading));
        }

        // The prize pool as the card's one big figure, and the Kredit figure at the line's end.
        private Piece PotRow(ScreenKit inside, ArcadeView arcade)
        {
            float u = inside.U;
            ScreenKit.Side? kredits = arcade.Kredits == null ? (ScreenKit.Side?)null : KreditFigure(inside, arcade);
            float room = inside.Width - (kredits.HasValue ? kredits.Value.Width + 10 * u : 0);
            ScreenKit.Side? pot = null;
            if (arcade.Pot != null)
            {
                var (shown, size) = NumberFit.Fit(ui, arcade.Pot, room, 28 * inside.K);
                pot = inside.Value("Prize pool value", shown, SkinTokens.Accent, size);
            }
            float height = Mathf.Max(pot?.Height ?? 0, kredits?.Height ?? 0);
            return new Piece(height, rect => {
                if (pot.HasValue) pot.Value.Draw(new Rect(rect.x, rect.center.y - pot.Value.Height / 2, pot.Value.Width, pot.Value.Height));
                if (kredits.HasValue)
                    kredits.Value.Draw(new Rect(rect.xMax - kredits.Value.Width, rect.center.y - kredits.Value.Height / 2, kredits.Value.Width, kredits.Value.Height));
            });
        }
        // The Kredit figure: the coin and the confirmed balance on the dark pill.
        // Its state is its own: plain when there is enough, a gold rim and a plus
        // on the last one, an ember rim and a plus at none. It opens Kredits.
        private ScreenKit.Side KreditFigure(ScreenKit inside, ArcadeView arcade)
        {
            float u = inside.U, plus = arcade.KreditLevel == KreditLevel.Enough ? 0 : 16 * u;
            var chip = inside.Chip("Kredit figure", SkinSlots.IconKredit, 18, arcade.Kredits, null);
            float width = chip.Width + (plus == 0 ? 0 : plus + 4 * u);
            return new ScreenKit.Side(width, chip.Height, rect => {
                string token = arcade.KreditLevel == KreditLevel.None ? SkinTokens.Negative : SkinTokens.Accent;
                if (plus > 0) ui.Pill("Kredit figure rim", new Rect(rect.x - 1.5f * u, rect.y - 1.5f * u, rect.width + 3 * u, rect.height + 3 * u), shell.Page, ui.Art.Token(token));
                if (plus > 0) ui.Pill("Kredit figure plate", rect, shell.Page, new Color(11 / 255f, 20 / 255f, 28 / 255f, 1));
                chip.Draw(new Rect(rect.x, rect.y, chip.Width, rect.height));
                if (plus > 0)
                {
                    // The top-up mark, in the state's ink like the rim.
                    ui.Piece("Kredit top-up", SkinSlots.IconPlus, new Rect(rect.xMax - plus - 5 * u, rect.center.y - plus / 2, plus, plus), shell.Page).color = ui.Art.Token(token);
                }
                if (arcade.OpenKredits == null) return;
                // The whole figure is the way to Kredits, at a finger's height.
                float touch = Mathf.Max(rect.height, inside.Touch(44));
                var hit = ui.Rect<Image>("Kredit figure tap", new Rect(rect.x, rect.center.y - touch / 2, rect.width, touch), shell.Page);
                hit.color = Color.clear; Tap(hit, arcade.OpenKredits);
            });
        }

        // Today's boards on the page: Score and the day's Theme side by side
        // (Score alone on a Classic day), each with its top rows and the
        // reader's own row, and a tap that opens it. The header carries the
        // rewards badge when rewards wait. While the boards are being read the
        // rows hold their places; a failed read says so in this card alone.
        private Piece BoardsCard(ScreenKit kit, ArcadeView arcade, int rows)
        {
            var inside = kit.Inside(); float u = inside.U;
            ScreenKit.Side? badge = arcade.Claims == null ? (ScreenKit.Side?)null : ClaimsBadge(inside, arcade.Claims);
            var parts = new List<Piece> { CardHeader(inside, "Boards", "Today’s boards", badge) };
            if (arcade.BoardsNotice != null)
            {
                parts.Add(CardLine("Boards notice", arcade.BoardsNotice, SkinTokens.TextMuted, inside));
                if (arcade.BoardsRetry != null) parts.Add(Buttons(inside, (arcade.BoardsRetry, ScreenKit.Kind.Quiet, SkinSlots.IconRetry)));
            }
            else parts.Add(BoardColumns(inside, arcade.Boards, rows));
            return kit.Card(null, parts, "Boards card");
        }
        // A card's header with something at the line's end (the rewards badge).
        private Piece CardHeader(ScreenKit inside, string name, string text, ScreenKit.Side? end)
        {
            float height = Mathf.Max(inside.HeaderDp * ui.Scale * ui.Density * ScreenKit.DisplayNormal, end?.Height ?? 0);
            return new Piece(height, rect => {
                var head = inside.Text(name + " heading", text.ToUpperInvariant(), rect, inside.HeaderDp, SkinTokens.TextMuted, SkinUi.Type.Display, ScreenKit.DisplayNormal,
                    TextAlignmentOptions.Left);
                head.characterSpacing = 6;
                if (end.HasValue) end.Value.Draw(new Rect(rect.xMax - end.Value.Width, rect.center.y - end.Value.Height / 2, end.Value.Width, end.Value.Height));
            });
        }
        // Rewards waiting: the trophy and the count on a gold-rimmed pill; a tap opens the oldest such day.
        private ScreenKit.Side ClaimsBadge(ScreenKit inside, PageAction claims)
        {
            float u = inside.U;
            var chip = inside.Chip("Rewards badge", SkinSlots.IconTrophy, 16, null, claims.Label);
            return new ScreenKit.Side(chip.Width, chip.Height, rect => {
                ui.Pill("Rewards badge rim", new Rect(rect.x - 1.5f * u, rect.y - 1.5f * u, rect.width + 3 * u, rect.height + 3 * u), shell.Page, ui.Art.Token(SkinTokens.Accent));
                chip.Draw(rect);
                float touch = Mathf.Max(rect.height, inside.Touch(44));
                var hit = ui.Rect<Image>("Rewards badge tap", new Rect(rect.x, rect.center.y - touch / 2, rect.width, touch), shell.Page);
                hit.color = Color.clear; Tap(hit, claims);
            });
        }

        // A board row's height and the gap under it, in u.
        private const float BoardRowU = 24, BoardRowGapU = 2;
        // The boards as columns: each its pictogram and name with the way in,
        // its top rows, and the reader's own row in the gold rim.
        private Piece BoardColumns(ScreenKit inside, BoardColumnView[] boards, int rows)
        {
            float u = inside.U, gap = 8 * u, head = BoardRowU * u, step = (BoardRowU + BoardRowGapU) * u;
            // Before the read lands the card keeps two columns' places.
            int columns = boards == null ? 2 : Mathf.Max(1, boards.Length);
            // Boards with few rows take only their room, one line at least.
            if (boards != null) rows = Mathf.Clamp(boards.Max(board => board?.Rows.Length ?? 0), 1, rows);
            float height = head + (rows + 1) * step + 3 * u;
            return new Piece(height, rect => {
                float width = (rect.width - gap * (columns - 1)) / columns;
                for (int c = 0; c < columns; c++)
                {
                    var column = new Rect(rect.x + c * (width + gap), rect.y, width, rect.height);
                    var board = boards == null ? null : boards[c];
                    float y = column.yMax - head;
                    if (board != null) BoardHead(inside, board, new Rect(column.x, y, column.width, head));
                    string name = board == null ? "Board " + c : board.Name + " board";
                    for (int i = 0; i < rows; i++)
                    {
                        y -= step;
                        var place = new Rect(column.x, y, column.width, BoardRowU * u);
                        if (board == null) ui.Pill(name + " place " + (i + 1), place, shell.Page, RowInk(false, true));
                        else if (i < board.Rows.Length) BoardRow(inside, name + " row " + (i + 1), board.Rows[i], place, shell.Page);
                        else if (i == 0 && board.Rows.Length == 0 && board.Empty != null)
                            inside.Text(name + " empty", board.Empty, place, inside.SmallDp, SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading,
                                TextAlignmentOptions.Left);
                    }
                    y -= step + 3 * u;
                    var own = new Rect(column.x, y, column.width, BoardRowU * u);
                    if (board == null) ui.Pill(name + " place own", own, shell.Page, RowInk(false, true));
                    else if (board.Yours != null) BoardRow(inside, name + " yours", board.Yours, own, shell.Page);
                    if (board?.Open == null) continue;
                    var hit = ui.Rect<Image>(name + " tap", column, shell.Page); hit.color = Color.clear; Tap(hit, board.Open);
                }
            });
        }
        // A column's head: the board's pictogram, its name and the chevron of a way in.
        private void BoardHead(ScreenKit inside, BoardColumnView board, Rect rect)
        {
            float u = inside.U, picture = 20 * u, chevron = 12 * u;
            ui.Pictogram(board.Name + " board pictogram", board.Pictogram, board.Chip, new Rect(rect.x, rect.center.y - picture / 2, picture, picture), shell.Page);
            float x = rect.x + picture + 6 * u, room = rect.xMax - chevron - 4 * u - x;
            float size = inside.SmallDp; string words = board.Name;
            var label = inside.Text(board.Name + " board name", words, new Rect(x, rect.y, room, rect.height), size, SkinTokens.Text, SkinUi.Type.Caption,
                ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
            label.textWrappingMode = TextWrappingModes.NoWrap; label.overflowMode = TextOverflowModes.Ellipsis; label.fontStyle = FontStyles.Bold;
            if (board.Open == null) return;
            var arrow = Tinted(board.Name + " board chevron", SkinSlots.IconBack, new Rect(rect.xMax - chevron, rect.center.y - chevron / 2, chevron, chevron),
                SkinTokens.TextMuted, shell.Page);
            arrow.rectTransform.pivot = new Vector2(.5f, .5f); arrow.rectTransform.anchoredPosition += arrow.rectTransform.sizeDelta / 2;
            arrow.rectTransform.localScale = new Vector3(-1, 1, 1);
        }
        private Color RowInk(bool yours, bool place = false) => yours ? new Color(42 / 255f, 36 / 255f, 16 / 255f, 1) :
            new Color(11 / 255f, 20 / 255f, 28 / 255f, place ? .35f : .7f);
        // One board row on its plate: rank, player, result and, where there is
        // one, the payout. The reader's own row sits in a gold rim; a place from
        // the public read model is drawn muted, without a plate.
        private void BoardRow(ScreenKit inside, string name, BoardRowView row, Rect rect, Transform parent)
        {
            float u = inside.U, pad = 5 * u;
            if (row.Yours) ui.Pill(name + " rim", new Rect(rect.x - 1.5f * u, rect.y - 1.5f * u, rect.width + 3 * u, rect.height + 3 * u), parent, ui.Art.Token(SkinTokens.Accent));
            if (!row.Unofficial) ui.Pill(name, rect, parent, RowInk(row.Yours));
            string ink = row.Unofficial ? SkinTokens.TextMuted : SkinTokens.Text;
            float rankWidth = Mathf.Max(14 * u, ui.TextWidth(row.Rank ?? "", inside.SmallDp, SkinUi.Type.Number) + 2 * u), x = rect.x + pad, right = rect.xMax - pad;
            var rank = ui.Label(name + " rank", row.Rank ?? "", new Rect(x, rect.y, rankWidth, rect.height), inside.SmallDp, row.Yours ? SkinTokens.Accent : SkinTokens.TextMuted,
                parent, SkinUi.Type.Number, TextAlignmentOptions.Left);
            rank.textWrappingMode = TextWrappingModes.NoWrap; x += rankWidth + 3 * u;
            if (row.Payout != null)
            {
                float payWidth = ui.TextWidth(row.Payout, inside.SmallDp, SkinUi.Type.Number) + 2 * u;
                ui.Label(name + " payout", row.Payout, new Rect(right - payWidth, rect.y, payWidth, rect.height), inside.SmallDp, SkinTokens.Accent, parent,
                    SkinUi.Type.Number, TextAlignmentOptions.Right).textWrappingMode = TextWrappingModes.NoWrap;
                right -= payWidth + 8 * u;
            }
            // The result keeps its 14 dp; a long one abbreviates before it crowds the name.
            float numberDp = Mathf.Max(14, 14 * inside.K);
            var (shown, size) = NumberFit.Fit(ui, row.Value ?? "", (right - x) * .55f, numberDp);
            float valueWidth = ui.TextWidth(shown, size, SkinUi.Type.Number) + 2 * u;
            ui.Label(name + " value", shown, new Rect(right - valueWidth, rect.y, valueWidth, rect.height), size, ink, parent, SkinUi.Type.Number,
                TextAlignmentOptions.Right).textWrappingMode = TextWrappingModes.NoWrap;
            var player = ui.Label(name + " player", row.Player ?? "", new Rect(x, rect.y, Mathf.Max(0, right - valueWidth - 4 * u - x), rect.height), inside.SmallDp,
                row.Yours ? SkinTokens.Accent : ink, parent, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            player.textWrappingMode = TextWrappingModes.NoWrap; player.overflowMode = TextOverflowModes.Ellipsis;
        }

        // The day stepper: an arrow at each end and, between them, the date over
        // the day's state. An arrow whose step cannot be taken is dimmed and takes no tap.
        private Piece StepperPiece(PanelBlock block, ScreenKit kit)
        {
            float u = kit.U, arrow = kit.Touch(44), dateDp = 17 * kit.K;
            ScreenKit.Side? state = block.Tag == null ? (ScreenKit.Side?)null : Tag(kit, block.Tag, block.TagToken, "Day state");
            // A live day's lit dot stands left of its state.
            float dot = block.Sprite == null ? 0 : 12 * u;
            float dateHeight = dateDp * ui.Scale * ui.Density * ScreenKit.DisplayNormal;
            return new Piece(Mathf.Max(arrow, dateHeight + (state.HasValue ? 2 * u + state.Value.Height : 0)), rect => {
                for (int side = 0; side < 2; side++)
                {
                    var action = block.Actions[side] ?? new PageAction { Label = side == 0 ? "Previous day" : "Next day", Enabled = false };
                    HeaderButton(action, new Rect(side == 0 ? rect.x : rect.xMax - arrow, rect.center.y - arrow / 2, arrow, arrow), SkinSlots.IconBack, side == 1, shell.Page);
                }
                float block2 = dateHeight + (state.HasValue ? 2 * u + state.Value.Height : 0), top = rect.center.y + block2 / 2;
                kit.Text("Day", block.Copy, new Rect(rect.x + arrow, top - dateHeight, rect.width - 2 * arrow, dateHeight), dateDp, SkinTokens.Text, SkinUi.Type.Display,
                    ScreenKit.DisplayNormal).textWrappingMode = TextWrappingModes.NoWrap;
                if (!state.HasValue) return;
                float left = rect.center.x - (state.Value.Width + (dot > 0 ? dot + 4 * u : 0)) / 2;
                if (dot > 0)
                { ui.Piece("Day state mark", block.Sprite, new Rect(left, top - block2 + state.Value.Height / 2 - dot / 2, dot, dot), shell.Page); left += dot + 4 * u; }
                state.Value.Draw(new Rect(left, top - block2, state.Value.Width, state.Value.Height));
            });
        }

        // Two views of one thing on one track, as the tab bar shows its tabs: the
        // one shown on the lit plate, the other a tap away.
        private Piece Segments(PanelBlock block, ScreenKit kit)
        {
            float u = kit.U, height = kit.Touch(44), inset = 3 * u;
            return new Piece(height, rect => {
                ui.Pill("Segments", rect, shell.Page, RowInk(false));
                float width = (rect.width - 2 * inset) / block.Actions.Length;
                for (int i = 0; i < block.Actions.Length; i++)
                {
                    var action = block.Actions[i]; bool shown = block.Primary == i;
                    var at = new Rect(rect.x + inset + i * width, rect.y + inset, width, rect.height - 2 * inset);
                    // A segment too narrow for its words takes its shorter ones.
                    string words = action.Short != null && ui.TextWidth(action.Label, kit.CaptionDp, SkinUi.Type.Caption) > ui.TabLabelRoom(width) ? action.Short : action.Label;
                    var face = shown ? ui.Piece("Segment", SkinSlots.TabSelected, at, shell.Page, SkinUi.TabChipBorder) : ui.Rect<Image>("Segment", at, shell.Page);
                    if (!shown) face.color = Color.clear;
                    kit.Text((action.Name ?? action.Label) + " label", words, at, kit.CaptionDp, shown ? SkinTokens.TextOnPrimary : SkinTokens.Text, SkinUi.Type.Caption,
                        ScreenKit.CaptionLeading).textWrappingMode = TextWrappingModes.NoWrap;
                    Tap(face, action);
                }
            });
        }

        // A board's rows on a card that takes the page's spare height: the rows
        // scroll inside it and nothing else on the page moves. A divider stands
        // before the first unofficial row; the last row may be a way to more.
        private Piece RowsPiece(PanelBlock block, ScreenKit kit)
        {
            var inside = kit.Inside(); float u = kit.U, step = (BoardRowU + BoardRowGapU) * u, pad = 10 * u;
            int first = Array.FindIndex(block.Rows, row => row.Unofficial);
            float divider = block.Caption == null || first < 0 ? 0 : step;
            float more = block.Action == null ? 0 : inside.Touch(40) + BoardRowGapU * u;
            float content = block.Rows.Length == 0 ? step : block.Rows.Length * step + divider + more;
            return new Piece(2 * pad + 4 * step, rect => {
                ui.Piece(block.Name, SkinSlots.Card, rect, shell.Page);
                var window = new Rect(rect.x + 12 * u, rect.y + pad, rect.width - 24 * u, rect.height - 2 * pad);
                var view = ui.Rect<RectMask2D>(block.Name + " viewport", window, shell.Page);
                // A transparent graphic lets a drag on empty list space reach the scroll view.
                var drag = view.gameObject.AddComponent<Image>(); drag.color = Color.clear;
                var rows = ui.Rect<RectTransform>(block.Name + " rows", new Rect(window.x, window.yMax - content, window.width, content), view.transform);
                // The list hangs from its top: a scroll view rests a shorter content on its pivot.
                rows.pivot = new Vector2(0, 1); rows.anchoredPosition += new Vector2(0, content);
                float y = window.yMax;
                if (block.Rows.Length == 0 && block.Copy != null)
                    inside.Text(block.Name + " empty", block.Copy, new Rect(window.x, y - step, window.width, step), inside.SmallDp, SkinTokens.TextMuted, SkinUi.Type.Caption,
                        ScreenKit.CaptionLeading, TextAlignmentOptions.Center, rows);
                for (int i = 0; i < block.Rows.Length; i++)
                {
                    if (i == first && divider > 0)
                    {
                        y -= step;
                        inside.Text(block.Name + " divider", block.Caption, new Rect(window.x, y, window.width, step), inside.SmallDp, SkinTokens.TextMuted, SkinUi.Type.Caption,
                            ScreenKit.CaptionLeading, TextAlignmentOptions.Center, rows);
                    }
                    y -= step;
                    BoardRow(inside, block.Name + " row " + block.Rows[i].Rank, block.Rows[i], new Rect(window.x, y + BoardRowGapU * u, window.width, BoardRowU * u), rows);
                }
                if (block.Action != null)
                {
                    y -= more;
                    var face = ui.Rect<Image>(block.Action.Name ?? block.Action.Label, new Rect(window.x, y, window.width, more - BoardRowGapU * u), rows);
                    face.color = Color.clear;
                    inside.Text(block.Name + " more", block.Action.Label, SkinUi.ScreenRect(face.rectTransform), inside.SmallDp, SkinTokens.Accent, SkinUi.Type.Caption,
                        ScreenKit.CaptionLeading, TextAlignmentOptions.Center, rows);
                    Tap(face, block.Action);
                }
                var scroll = view.gameObject.AddComponent<ScrollRect>(); scroll.horizontal = false; scroll.movementType = ScrollRect.MovementType.Clamped;
                scroll.viewport = (RectTransform)view.transform; scroll.content = rows; scroll.scrollSensitivity = 24;
                // A list that grew opens where the reader was: at its Primary row.
                if (block.Primary > 0 && content > window.height)
                    rows.anchoredPosition += new Vector2(0, Mathf.Min(block.Primary * step, content - window.height));
            }, stretch: 4000 * u);
        }
    }
}
