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
        // painting; today's Daily card with its one action, which is the
        // player's next step; then today's boards side by side.
        private void ArcadeHome(DailyPageView value)
        {
            var kit = Kit;
            var arcade = value.Arcade; var realm = catalog.Realm(value.Realm);
            if (value.Now != null) { countdownView = value; countdownSecond = value.Now(); }
            long? clock = arcade.Headline == null && value.ClosesAt > 0 && value.Now != null ? value.ClosesAt - countdownSecond : (long?)null;
            var pieces = new List<Piece> { Lockup(kit, Step(90, 72)), ArenaDailyCard(kit, value, realm.guardianName + " · " + realm.realmName, clock) };
            if (arcade.HasBoards)
            {
                // The boards take the room the Daily card leaves, less the gaps to it and to the page's foot.
                float room = kit.Spare(pieces.ToArray()) - 20 * kit.U;
                int shown = (int)Step(LandingRowsSeeker, LandingRowsCompact);
                while (shown > LandingRowsCompact && BoardsCard(kit, arcade, shown).Height > room) shown--;
                pieces.Add(BoardsCard(kit, arcade, shown));
            }
            Place(kit, new ScreenKit.Slots { Body = pieces });
            ShowPortraits();
        }
        // A centred line inside a card, in its own name and ink.
        private Piece CardLine(string name, string text, string token, ScreenKit inside)
        {
            float height = inside.Block(text, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            return new Piece(height, rect => inside.Text(name, text, rect, inside.SmallDp, token, SkinUi.Type.Caption, ScreenKit.CaptionLeading));
        }

        // Today's Daily on the Arena: one grid on the card's two edges (owner,
        // 2026-10-06). Three rows and nothing between them but the card's line:
        //   who and what   the guardian's portrait, its name and realm, and the
        //                  objective under them
        //   the strip      three equal cells on one plate and one baseline, each a
        //                  mark and a figure and no word: the pot, the time left,
        //                  the Kredits (which open Kredits)
        //   the button     the player's next step, across the card
        // The card's line stands over the button as its reason: one line is
        // always kept for it, so the card is as tall in every state, and only a
        // reason that needs a second line grows it. The day's state, where
        // entries are not open, is a tag beside the card's heading.
        public const float DailyRowGapU = 10, DailyLineGapU = 4, StripGapU = 6, StripHeightU = 34;
        private Piece ArenaDailyCard(ScreenKit kit, DailyPageView value, string title, long? clock)
        {
            var inside = kit.Inside(); var arcade = value.Arcade; float u = inside.U;
            // Who and what.
            float face = Step(56, 48), room = inside.Width - face * u - 12 * u;
            string caption = catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            ScreenKit.Side? objective = null;
            if (value.ObjectiveKind != 0)
            {
                var goal = catalog.Goal(value.ObjectiveKind, value.ObjectiveValue);
                var picture = inside.Pictogram("Daily objective", goal.Pictogram(RealmBonus(value.Realm)), goal.chip, 24);
                // The caption takes the room beside its pictogram, on as many lines as it needs.
                float width = Mathf.Min(inside.TextWidth(caption, inside.SmallDp, SkinUi.Type.Caption) + 2, room - picture.Width - 8 * u);
                float height = inside.Block(caption, width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                string words = caption;
                objective = inside.Beside(8, picture, new ScreenKit.Side(width, height, rect => inside.Text("Daily line", words, rect, inside.SmallDp,
                    SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left)));
                caption = null;
            }
            var identity = PortraitRow(inside, "Daily", face, image => Portrait(value.Realm, image), title, caption, objective, null);

            // The day's state beside the heading, where the two fit one line; else it is the card's line.
            ScreenKit.Side? state = arcade.Headline == null ? (ScreenKit.Side?)null
                : Tag(kit, arcade.Headline, arcade.Warning ? SkinTokens.Negative : SkinTokens.TextMuted, "Daily headline");
            float heading = ui.TextWidth(Words.DailyToday.ToUpperInvariant(), inside.HeaderDp, SkinUi.Type.Display) * 1.12f;
            bool tagged = state.HasValue && heading + 6 * u + state.Value.Width <= inside.Width;

            // The card's line: the reason, or the deposit against what an entry needs, or the day's state.
            float numeral = Mathf.Max(14, inside.SmallDp), lineHeight = numeral * ui.Scale * ui.Density * ScreenKit.CaptionLeading;
            string said = arcade.Reason ?? (tagged ? null : arcade.Headline);
            string saidName = arcade.Reason != null ? "Daily reason" : "Daily headline";
            string saidToken = arcade.Warning ? SkinTokens.Negative : arcade.Reason != null ? SkinTokens.Text : SkinTokens.TextMuted;
            float saidHeight = said == null ? 0 : inside.Block(said, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            float detailHeight = arcade.Reason == null || arcade.Detail == null ? 0 : inside.Block(arcade.Detail, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            bool deposit = said == null && arcade.Deposit != null && arcade.EntryNeeds != null;
            var line = new Piece(Mathf.Max(lineHeight, saidHeight + detailHeight), rect => {
                if (said != null)
                {
                    float top = rect.center.y + (saidHeight + detailHeight) / 2;
                    inside.Text(saidName, said, new Rect(rect.x, top - saidHeight, rect.width, saidHeight), inside.SmallDp, saidToken, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                    if (detailHeight > 0)
                        inside.Text("Daily reason detail", arcade.Detail, new Rect(rect.x, top - saidHeight - detailHeight, rect.width, detailHeight), inside.SmallDp,
                            arcade.Warning ? SkinTokens.Text : SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                }
                else if (deposit)
                {
                    // What the device holds, short of what an entry needs: two amounts and the device's mark, no sentence.
                    string low = ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.Negative)), need = ColorUtility.ToHtmlStringRGB(ui.Art.Token(SkinTokens.TextMuted));
                    string figures = "<color=#" + low + ">" + arcade.Deposit + "</color><color=#" + need + "> / " + arcade.EntryNeeds + "</color>";
                    float icon = 16 * u, width = ui.TextWidth(figures, numeral, SkinUi.Type.Display), x = rect.center.x - (icon + 6 * u + width) / 2;
                    Tinted("Daily deposit icon", SkinSlots.IconDevice, new Rect(x, rect.center.y - icon / 2, icon, icon), SkinTokens.TextMuted, shell.Page);
                    var label = ui.Label("Daily deposit", figures, new Rect(x + icon + 6 * u, rect.y, width, rect.height), numeral, SkinTokens.Text, shell.Page, SkinUi.Type.Display,
                        TextAlignmentOptions.Left);
                    label.richText = true; label.textWrappingMode = TextWrappingModes.NoWrap;
                }
            });
            // The one action wears its own icon: the play triangle only where it plays.
            // A card with no step to offer yet (its read is on its way) keeps the button's place.
            var buttons = value.Actions.Length == 0 ? inside.Space(62) : Buttons(inside, ScreenKit.Role.CardAction, true, value.Actions.Select((action, i) =>
                (action, i == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet, action.Icon ?? (i == 0 ? SkinSlots.IconPlay : null))).ToArray());
            var rows = inside.Stack(DailyLineGapU, inside.Stack(DailyRowGapU, identity, StatStrip(inside, arcade, clock)), line, buttons);
            return kit.Card(Words.DailyToday, new[] { rows }, "Daily card", tag: tagged ? state : null);
        }

        // The strip: the pot, the time left and the Kredits, three equal cells on
        // one plate each and one baseline, each a mark and a figure at one size.
        // A value the page does not have is a dash. The Kredit cell is the way to
        // Kredits and shows its own state: plain when there is enough, a gold rim
        // and a plus on the last one, an ember rim and a plus at none.
        private Piece StatStrip(ScreenKit inside, ArcadeView arcade, long? clock)
        {
            float u = inside.U, gap = StripGapU * u, cell = (inside.Width - 2 * gap) / 3, mark = 16 * u, pad = 8 * u;
            bool plus = arcade.Kredits != null && arcade.KreditLevel != KreditLevel.Enough;
            const string none = "—";
            string pot = arcade.Pot ?? none + CurrencyMark.Tag, kredits = arcade.Kredits ?? none;
            string time = clock.HasValue ? DayClock(clock.Value) : none, widest = System.Text.RegularExpressions.Regex.Replace(time, "[0-9]", "8");
            // One numeral size for the three: the largest at which the widest of them fits its cell.
            float size = 18 * inside.K;
            float Room(bool marked, bool topUp) => cell - 2 * pad - (marked ? mark + 5 * u : 0) - (topUp ? mark + 4 * u : 0);
            foreach (var (words, room) in new[] { (pot, Room(false, false)), (widest, Room(true, false)), (kredits, Room(true, plus)) })
                size = Mathf.Min(size, NumberFit.Fit(ui, words, room, size, false).Size);
            pot = NumberFit.Fit(ui, pot, Room(false, false), size).Text;
            clockEm = (inside.TextWidth("88", size, SkinUi.Type.Display) - inside.TextWidth("8", size, SkinUi.Type.Display)) / (size * ui.Scale * ui.Density);
            return new Piece(StripHeightU * u, rect => {
                var plate = new Color(11 / 255f, 20 / 255f, 28 / 255f, 1);
                TMP_Text Cell(int index, string name, string icon, string words, string token, bool topUp)
                {
                    var at = new Rect(rect.x + index * (cell + gap), rect.y, cell, rect.height);
                    ui.Pill(name, at, shell.Page, plate);
                    float width = ui.TextWidth(System.Text.RegularExpressions.Regex.Replace(words, "<mspace[^>]*>|</mspace>", ""), size, SkinUi.Type.Display);
                    float content = (icon == null ? 0 : mark + 5 * u) + width + (topUp ? 4 * u + mark : 0), x = at.center.x - content / 2;
                    if (icon != null) { ui.Piece(name + " icon", icon, new Rect(x, at.center.y - mark / 2, mark, mark), shell.Page); x += mark + 5 * u; }
                    var label = ui.Label(name + " number", words, new Rect(x, at.y, width, at.height), size, token, shell.Page, SkinUi.Type.Display, TextAlignmentOptions.Left);
                    label.richText = true; label.textWrappingMode = TextWrappingModes.NoWrap;
                    return label;
                }
                Cell(0, "Prize pool value", null, pot, arcade.Pot == null ? SkinTokens.TextMuted : SkinTokens.Accent, false);
                var left = Cell(1, "Daily countdown", SkinSlots.IconClock, widest, clock.HasValue ? SkinTokens.Score : SkinTokens.TextMuted, false);
                if (clock.HasValue) { left.text = Tabular(time); countdown = left; }
                // The Kredit cell's rim is drawn under its plate, in its state's ink like its plus.
                var kredit = new Rect(rect.x + 2 * (cell + gap), rect.y, cell, rect.height);
                string ink = arcade.KreditLevel == KreditLevel.None ? SkinTokens.Negative : SkinTokens.Accent;
                if (plus) ui.Pill("Kredit figure rim", new Rect(kredit.x - 1.5f * u, kredit.y - 1.5f * u, kredit.width + 3 * u, kredit.height + 3 * u), shell.Page, ui.Art.Token(ink));
                var count = Cell(2, "Kredit figure", SkinSlots.IconKredit, kredits, arcade.Kredits == null ? SkinTokens.TextMuted : SkinTokens.Score, plus);
                if (plus)
                {
                    float x = SkinUi.ScreenRect(count.rectTransform).xMax + 4 * u;
                    ui.Piece("Kredit top-up", SkinSlots.IconPlus, new Rect(x, kredit.center.y - mark / 2, mark, mark), shell.Page).color = ui.Art.Token(ink);
                }
                if (arcade.OpenKredits == null) return;
                // The whole cell is the way to Kredits, at a finger's height.
                float touch = Mathf.Max(kredit.height, inside.Touch(44));
                var hit = ui.Rect<Image>("Kredit figure tap", new Rect(kredit.x, kredit.center.y - touch / 2, kredit.width, touch), shell.Page);
                hit.color = Color.clear; Tap(hit, arcade.OpenKredits, ScreenKit.Role.Status);
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
            var parts = new List<Piece> { CardHeader(inside, "Boards", Words.ArenaBoardsToday, badge) };
            if (arcade.BoardsNotice != null)
            {
                parts.Add(CardLine("Boards notice", arcade.BoardsNotice, SkinTokens.TextMuted, inside));
                if (arcade.BoardsRetry != null) parts.Add(Buttons(inside, ScreenKit.Role.CardAction, (arcade.BoardsRetry, ScreenKit.Kind.Quiet, SkinSlots.IconRetry)));
            }
            else parts.Add(BoardColumns(inside, arcade.Boards, rows));
            return kit.Card(null, parts, "Boards card");
        }
        // A card's header with something at the line's end (the rewards badge).
        private Piece CardHeader(ScreenKit inside, string name, string text, ScreenKit.Side? end)
        {
            float height = Mathf.Max(inside.HeaderDp * ui.Scale * ui.Density * ScreenKit.DisplayNormal, end?.Height ?? 0);
            return new Piece(height, rect => {
                var head = inside.Text(name + " heading", text, rect, inside.HeaderDp, SkinTokens.TextMuted, SkinUi.Type.Display, ScreenKit.DisplayNormal,
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
                hit.color = Color.clear; Tap(hit, claims, ScreenKit.Role.Status);
            });
        }

        // A board row's height and the gap under it, in u.
        private const float BoardRowU = 24, BoardRowGapU = 2;
        // The boards as columns: each its pictogram and name with the way in and
        // its top rows, the reader's own lit in its gold rim. The reader's line
        // is pinned under the rows only when it is not among them
        // (BoardColumnView.Pinned); on a board without rows it is the one line.
        private Piece BoardColumns(ScreenKit inside, BoardColumnView[] boards, int rows)
        {
            float u = inside.U, gap = 8 * u, head = BoardRowU * u, step = (BoardRowU + BoardRowGapU) * u;
            // Before the read lands the card keeps two columns' places.
            int columns = boards == null ? 2 : Mathf.Max(1, boards.Length);
            // Boards with few rows take only their room, one line at least.
            if (boards != null) rows = Mathf.Clamp(boards.Max(board => board?.Rows.Length ?? 0), 1, rows);
            // The line under the rows is kept only where a column pins one (or while the read is out).
            bool under = boards == null || boards.Any(board => board != null && board.Rows.Length > 0 && board.Pinned(rows) != null);
            // A column is its board's way in: it keeps a touch's height however few lines it holds.
            float height = Mathf.Max(inside.Touch(48), head + rows * step + (under ? step + 3 * u : 0));
            return new Piece(height, rect => {
                float width = (rect.width - gap * (columns - 1)) / columns;
                for (int c = 0; c < columns; c++)
                {
                    var column = new Rect(rect.x + c * (width + gap), rect.y, width, rect.height);
                    var board = boards == null ? null : boards[c];
                    float y = column.yMax - head;
                    if (board != null) BoardHead(inside, board, new Rect(column.x, y, column.width, head));
                    string name = board == null ? "Board " + c : board.Name + " board";
                    var pinned = board?.Pinned(rows);
                    for (int i = 0; i < rows; i++)
                    {
                        y -= step;
                        var place = new Rect(column.x, y, column.width, BoardRowU * u);
                        if (board == null) ui.Pill(name + " place " + (i + 1), place, shell.Page, RowInk(false, true));
                        else if (i < board.Rows.Length) BoardRow(inside, name + " row " + (i + 1), board.Rows[i], place, shell.Page);
                        // A board without rows has one line: the reader's own, or why it is empty.
                        else if (i == 0 && board.Rows.Length == 0 && pinned != null) BoardRow(inside, name + " yours", pinned, place, shell.Page);
                        else if (i == 0 && board.Rows.Length == 0 && board.Empty != null)
                            inside.Text(name + " empty", board.Empty, place, inside.SmallDp, SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading,
                                TextAlignmentOptions.Left);
                    }
                    if (under)
                    {
                        y -= step + 3 * u;
                        var own = new Rect(column.x, y, column.width, BoardRowU * u);
                        if (board == null) ui.Pill(name + " place own", own, shell.Page, RowInk(false, true));
                        else if (board.Rows.Length > 0 && pinned != null) BoardRow(inside, name + " yours", pinned, own, shell.Page);
                    }
                    if (board?.Open == null) continue;
                    var hit = ui.Rect<Image>(name + " tap", column, shell.Page); hit.color = Color.clear; Tap(hit, board.Open, ScreenKit.Role.Choice);
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
            // A row without a result says so in its place, in words.
            if (row.Note != null)
            {
                float noteWidth = ui.TextWidth(row.Note, inside.SmallDp, SkinUi.Type.Caption) + 2 * u;
                ui.Label(name + " note", row.Note, new Rect(right - noteWidth, rect.y, noteWidth, rect.height), inside.SmallDp, SkinTokens.TextMuted, parent,
                    SkinUi.Type.Caption, TextAlignmentOptions.Right).textWrappingMode = TextWrappingModes.NoWrap;
                ui.Label(name + " player", row.Player ?? "", new Rect(x, rect.y, Mathf.Max(0, right - noteWidth - 4 * u - x), rect.height), inside.SmallDp,
                    row.Yours ? SkinTokens.Accent : ink, parent, SkinUi.Type.Caption, TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
                return;
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

        // A page's stepper, on the kit's one stepper piece: its state is a tag, a
        // live step's lit dot before it.
        private Piece StepperPiece(StepperView view, ScreenKit kit)
        {
            float dot = 12 * kit.U;
            ScreenKit.Side? state = view.State == null ? (ScreenKit.Side?)null : Tag(kit, view.State, view.StateToken, "Day state");
            ScreenKit.Side? mark = view.Mark == null || !state.HasValue ? (ScreenKit.Side?)null
                : new ScreenKit.Side(dot, dot, rect => ui.Piece("Day state mark", view.Mark, rect, shell.Page));
            return kit.Stepper("Day stepper", "Day", view.Label, state, mark, Arrow(view.Previous, "Previous day"), Arrow(view.Next, "Next day"));
        }

        // The Kredits page's hero: the coin beside the confirmed balance, the
        // page's biggest figure, then what it means as two small equations (the
        // entries it buys, the one unit price), or one line in their place.
        // Without a figure the loader stands for it. A balance that just grew
        // counts up from what it was, its gain beside it.
        private Rect kreditCoin;
        private string kreditGainShown;
        private Piece BalancePiece(PanelBlock block, ScreenKit kit)
        {
            var inside = kit.Inside(); float u = inside.U, coin = Step(68, 56) * u, figureDp = Step(52, 44) * inside.K, gap = 10 * u;
            float figureHeight = figureDp * ui.Scale * ui.Density * ScreenKit.DisplayNormal;
            var top = new Piece(Mathf.Max(coin, figureHeight), rect => {
                float gainedWidth = block.Badge == null ? 0 : ui.TextWidth(block.Badge, inside.CaptionDp, SkinUi.Type.Display) + 8 * u;
                float figureWidth = block.Value == null ? 34 * u : ui.TextWidth(System.Text.RegularExpressions.Regex.Replace(block.Value, "[0-9]", "8"), figureDp, SkinUi.Type.Display) + 2;
                float x = rect.center.x - (coin + gap + figureWidth + gainedWidth) / 2;
                kreditCoin = new Rect(x, rect.center.y - coin / 2, coin, coin);
                ui.Piece("Kredit coin", SkinSlots.CoinBalance, kreditCoin, shell.Page);
                if (block.Value == null)
                {
                    // The balance is on its way: the loader, as on every action's button.
                    var loader = ui.Piece("Balance loader", reducedMotion ? SkinSlots.IconHourglass : SkinSlots.IconRetry,
                        new Rect(x + coin + gap, rect.center.y - 17 * u, 34 * u, 34 * u), shell.Page);
                    if (!reducedMotion) loader.gameObject.AddComponent<Turn>();
                    return;
                }
                var figure = ui.Label(block.Name, block.Value, new Rect(x + coin + gap, rect.y, figureWidth, rect.height), figureDp, SkinTokens.Text, shell.Page,
                    SkinUi.Type.Display, TextAlignmentOptions.Left);
                figure.textWrappingMode = TextWrappingModes.NoWrap;
                if (block.Badge == null) { kreditGainShown = null; return; }
                ui.Label(block.Name + " gained", block.Badge, new Rect(x + coin + gap + figureWidth + 4 * u, rect.y, gainedWidth, rect.height), inside.CaptionDp,
                    SkinTokens.Accent, shell.Page, SkinUi.Type.Display, TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
                // The count-up plays once for a gain, whatever redraws the page while it shows.
                string key = block.Chip + ">" + block.Value;
                if (kreditGainShown == null || !kreditGainShown.StartsWith(key))
                {
                    kreditGainShown = key;
                    if (ulong.TryParse(block.Chip, out ulong was) && ulong.TryParse(block.Value, out ulong now)) figure.gameObject.AddComponent<CountUp>().Begin(figure, was, now);
                }
            });
            Piece under;
            if (block.Caption != null) under = CardLine("Balance line", block.Caption, SkinTokens.TextMuted, inside);
            else
            {
                var entries = inside.Chip("Entries", SkinSlots.IconKredit, 16, block.Value, "= " + block.Copy);
                var price = inside.Chip("Unit price", SkinSlots.IconKredit, 16, "1", "= " + block.Tag);
                under = new Piece(Mathf.Max(entries.Height, price.Height), rect => {
                    float total = entries.Width + 8 * u + price.Width, x = rect.center.x - total / 2;
                    entries.Draw(new Rect(x, rect.center.y - entries.Height / 2, entries.Width, entries.Height));
                    price.Draw(new Rect(x + entries.Width + 8 * u, rect.center.y - price.Height / 2, price.Width, price.Height));
                });
            }
            return kit.Card(null, new[] { top, under }, "Balance card");
        }

        // The Kredit packs in a row: one size, one style, none marked. Each card
        // is its picture, its count and its price on the card's button, and the
        // whole card is the tap. A purchase lives on the card that was tapped:
        // a gold rim and the loader with its step while it is in progress, an
        // ember rim and Try again when it did not go through, the others dimmed
        // meanwhile. One line under the cards gives the reason. When Kredits
        // arrive, coins fly from their card to the balance.
        public const float PackDim = .45f;
        public const int FlightCoins = 6;
        private Piece PacksPiece(PanelBlock block, ScreenKit kit)
        {
            float u = kit.U, gap = 8 * u, pad = 8 * u; int count = block.Packs.Length;
            float art = Step(60, 46) * u, countDp = Step(24, 20) * kit.K, countHeight = countDp * ui.Scale * ui.Density * ScreenKit.DisplayNormal;
            float button = kit.Touch(40), priceDp = Mathf.Max(13, 14 * kit.K);
            float card = pad + art + 4 * u + countHeight + 6 * u + button + pad;
            float reasonHeight = block.Caption == null ? 0 : kit.Block(block.Caption, kit.Safe.width - 32 * u, kit.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading) + 8 * u;
            return new Piece(card + reasonHeight, rect => {
                float width = (rect.width - gap * (count - 1)) / count;
                for (int i = 0; i < count; i++)
                {
                    var pack = block.Packs[i]; bool busy = pack.Buy?.Progress != null;
                    var at = new Rect(rect.x + i * (width + gap), rect.yMax - card, width, card);
                    if (busy || pack.Refused)
                        Tinted(pack.Name + " rim", SkinSlots.Card, new Rect(at.x - 2 * u, at.y - 2 * u, at.width + 4 * u, at.height + 4 * u), busy ? SkinTokens.Accent : SkinTokens.Negative, shell.Page);
                    var holder = ui.Rect<CanvasGroup>(pack.Name + " card", at, shell.Page); holder.alpha = pack.Dim ? PackDim : 1;
                    var parent = holder.transform;
                    ui.Piece(pack.Name, SkinSlots.Card, at, parent);
                    float y = at.yMax - pad - art;
                    ui.Piece(pack.Name + " art", pack.Art, new Rect(at.x + pad, y, at.width - 2 * pad, art), parent);
                    y -= 4 * u + countHeight;
                    float icon = 18 * u, words = ui.TextWidth(pack.Count, countDp, SkinUi.Type.Display) + 2, left = at.center.x - (icon + 4 * u + words) / 2;
                    ui.Piece(pack.Name + " coin", SkinSlots.IconKredit, new Rect(left, y + countHeight / 2 - icon / 2, icon, icon), parent);
                    ui.Label(pack.Name + " count", pack.Count, new Rect(left + icon + 4 * u, y, words, countHeight), countDp, SkinTokens.Text, parent, SkinUi.Type.Display,
                        TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
                    var price = new Rect(at.x + pad, at.y + pad, at.width - 2 * pad, button);
                    var pill = ui.Pill(pack.Name + " price", price, parent, busy || pack.Refused ? new Color(10 / 255f, 28 / 255f, 39 / 255f, 1) : new Color(23 / 255f, 86 / 255f, 106 / 255f, 1));
                    float mark = busy ? 16 * u : 0, lead = busy ? mark + 4 * u : 0, room = price.width - 12 * u - lead;
                    string label = pack.Price;
                    if (busy && pack.Buy.Short != null && ui.TextWidth(label, priceDp, SkinUi.Type.Caption) > room) label = pack.Buy.Short;
                    float labelWidth = Mathf.Min(room, ui.TextWidth(label, priceDp, SkinUi.Type.Caption) + 2), start = price.center.x - (labelWidth + lead) / 2;
                    if (busy)
                    {
                        var loader = ui.Piece("Action loader", reducedMotion ? SkinSlots.IconHourglass : SkinSlots.IconRetry, new Rect(start, price.center.y - mark / 2, mark, mark), parent);
                        if (!reducedMotion) loader.gameObject.AddComponent<Turn>();
                        start += lead;
                    }
                    var priceWords = ui.Label(pack.Name + " price words", label, new Rect(start, price.y, labelWidth, price.height), priceDp,
                        busy ? SkinTokens.Accent : pack.Refused ? SkinTokens.Negative : SkinTokens.Text, parent, SkinUi.Type.Caption);
                    priceWords.textWrappingMode = TextWrappingModes.NoWrap; priceWords.overflowMode = TextOverflowModes.Ellipsis;
                    if (pack.Buy == null) continue;
                    // The whole card is the tap; in progress its button is the action's own and takes none.
                    if (busy) { Tap(pill, pack.Buy, ScreenKit.Role.Choice); continue; }
                    var hit = ui.Rect<Image>(pack.Name + " tap", at, parent); hit.color = Color.clear; Tap(hit, pack.Buy, ScreenKit.Role.Choice);
                }
                if (block.Caption != null)
                    kit.Text(block.Dim ? "Action slow" : "Action refused", block.Caption, new Rect(rect.x, rect.y, rect.width, reasonHeight - 8 * u), kit.SmallDp, block.Dim ? SkinTokens.TextMuted : SkinTokens.Negative,
                        SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                // The Kredits that just arrived fly from their card to the balance; reduced motion keeps the count-up alone.
                if (block.Primary < 0 || block.Primary >= count || reducedMotion || kreditCoin.width <= 0) return;
                if (kreditGainShown == null || kreditGainShown.EndsWith(" flown")) return;
                kreditGainShown += " flown";
                var source = new Rect(rect.x + block.Primary * (width + gap), rect.yMax - card, width, card);
                for (int i = 0; i < FlightCoins; i++)
                {
                    float size = 22 * u; var start = new Vector2(source.center.x + (i % 3 - 1) * 10 * u, source.yMax - pad - art / 2 + (i / 3) * 8 * u);
                    var coin = ui.Piece("Kredit flight", SkinSlots.IconKredit, new Rect(start.x - size / 2, start.y - size / 2, size, size), shell.Page);
                    Vector2 from = ((RectTransform)coin.transform).anchoredPosition;
                    coin.gameObject.AddComponent<Flight>().Begin(from, from + (kreditCoin.center - start), .06f * i);
                }
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
                    // The tap takes the bar's whole height, 48 dp, round the segment's face.
                    face.raycastPadding = new Vector4(0, -inset, 0, -inset);
                    Tap(face, action, ScreenKit.Role.ViewSwitch);
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
                    Tap(face, block.Action, ScreenKit.Role.WayIn);
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
