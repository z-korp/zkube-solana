using System;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The board HUD, in two rows under a title ribbon. Row one: the score plate
    // (with a Campaign progress bar), the guardian medallion and the moves pill
    // (plus the pressure pill in Daily). Row two: the goals in plain words, as
    // two side-by-side Campaign constraint cards or one Daily objective card.
    // Every height is measured with the shipped fonts at the requested text
    // size; text grows its piece, never shrinks.
    public sealed class HudLayout
    {
        public BoardLayout Layout;
        public float Scale;
        public bool Campaign, RuleAbove;
        public Rect Title, Medallion, ScorePlate, ScoreCaption, ScoreValue, Progress, Moves, Pressure;
        public Rect PrimaryPlate, PrimaryCaption, PrimaryValue, SecondaryPlate, SecondaryCaption;
        public Rect Status, RuleHeading, Rule;
        public float StarSize;
        // The star glyph is drawn this fraction inside its touch square.
        public const float StarGlyphInset = .12f;
        // HUD plates draw their leaf ends at one size, whatever the plate's height,
        // so text insets clear them on every piece.
        public const float PlateBorderScale = .6f;
        // Each Campaign star sits on the piece of its source: score, the
        // cumulative constraint and the one-move constraint.
        public Rect Star(int index)
        {
            if (index < 0 || index > 2) throw new ArgumentOutOfRangeException(nameof(index));
            var plate = index == 0 ? ScorePlate : index == 1 ? PrimaryPlate : SecondaryPlate;
            return new Rect(plate.xMax - StarSize - 2 * Layout.Density, plate.center.y - StarSize / 2, StarSize, StarSize);
        }

        private const float TitleSize = 17, CaptionSize = 11, ValueSize = 26, CardValueSize = 18, PillSize = 12, RuleHeadingSize = 11,
            RuleSize = 12, StatusSize = 12;
        // Type sizes in dp for this layout; compact screens use a tighter HUD.
        public float TitlePt, CaptionPt, ValuePt, CardValuePt, PillPt, RuleHeadingPt, RulePt, StatusPt;

        public static string TitleText(BoardArt art, BoardSession session) => art.Title(session).ToUpperInvariant();
        public static string ScoreCaptionText(BoardSession session) => session.Daily ? "SCORE" : "SCORE / " + session.Rules.PointsRequired;
        public static string ScoreText(RunSummary state, BoardSession session) =>
            (session.Daily ? state.DailyScore : state.Score).ToString();
        public static float ScoreProgress(RunSummary state, BoardSession session) =>
            session.Daily || session.Rules.PointsRequired == 0 ? 0 : Mathf.Clamp01((float)state.Score / session.Rules.PointsRequired);
        public static string MovesText(RunSummary state, BoardSession session) => Math.Max(0, session.Rules.MaxMoves - state.Moves) + " MOVES";
        // Daily pressure, as what it does for the player: the points multiplier.
        public static string PressureText(RunSummary state) =>
            "POINTS ×" + (Protocol.PressureMultiplierPercent(state.CurrentTier) / 100f).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        public static string PrimaryCaptionText(BoardSession session) => session.Daily
            ? BoardView.ObjectiveName(session.Rules.ObjectiveKind, session.Rules.ObjectiveValue)
            : BoardView.ObjectiveName(session.Rules.PrimaryKind, session.Rules.PrimaryValue);
        public static string PrimaryText(RunSummary state, BoardSession session) => session.Daily
            ? state.ObjectiveTotal.ToString() : state.PrimaryProgress + " / " + session.Rules.PrimaryCount;
        public static string SecondaryCaptionText(BoardSession session) =>
            BoardView.ObjectiveName(session.Rules.SecondaryKind, session.Rules.SecondaryValue);
        public static string GuardianCaption(byte bonus) => "EARN " + (bonus == 1 ? "HAMMER" : bonus == 3 ? "WAVE" : "TOTEM");

        public static HudLayout Build(SkinUi ui, RunSummary state, BoardSession session, Rect safe, float density)
        {
            var art = ui.Art;
            var result = new HudLayout { Scale = ui.Scale, Campaign = session == null || !session.Daily };
            var normal = new BoardLayout(safe, density);
            float d = normal.Density, x = normal.Frame.x, w = normal.Frame.width, top = normal.Frame.yMax, gap = 6 * d;
            float H(string value, float width, float size, bool display) => ui.TextHeight(value, width, size, display);
            result.StarSize = 48 * d;
            float k = normal.Compact ? .9f : 1;
            result.TitlePt = TitleSize * k; result.CaptionPt = CaptionSize * k; result.ValuePt = ValueSize * k; result.CardValuePt = CardValueSize * k;
            result.PillPt = PillSize * k; result.RuleHeadingPt = RuleHeadingSize * k; result.RulePt = RuleSize * k; result.StatusPt = StatusSize * k;

            string title = session == null ? "GUARDIAN · DAILY" : TitleText(art, session);
            float titleWidth = Mathf.Min(w * .8f, ui.TextWidth(title, result.TitlePt, true) + 72 * d);
            float titleHeight = H(title, titleWidth - 48 * d, result.TitlePt, true) + 10 * d;
            result.Title = new Rect(normal.Frame.center.x - titleWidth / 2, top - titleHeight, titleWidth, titleHeight);
            float rowTop = result.Title.yMin - 3 * d;

            // Row one. The columns leave room for the full medallion; compact
            // screens then draw it no taller than the plates beside it, so the
            // guardian never adds height the grid could use.
            float medallion = Mathf.Clamp(w * .28f, 72 * d, 112 * d) * (normal.Compact ? .78f : 1);
            float column = (w - medallion - 4 * gap) / 2;
            float left = x + gap, right = x + w - gap - column;
            // Campaign text stops 4 dp before the drawn star; Daily keeps a 12 dp margin like the left.
            float reserve = result.Campaign ? 2 * d + result.StarSize * (1 - StarGlyphInset) + 4 * d : 12 * d, inner = column - 12 * d - reserve;
            string score = session == null ? "0" : ScoreText(state, session);
            string scoreCaption = session == null ? "SCORE" : ScoreCaptionText(session);
            float captionHeight = H(scoreCaption, inner, result.CaptionPt, false), valueHeight = H(score, inner, result.ValuePt, true);
            float bar = result.Campaign ? 9 * d : 0;
            // The Campaign progress bar carries its own margin, so it takes the plate's bottom padding.
            float plate = Mathf.Max(result.Campaign ? result.StarSize : 0, 6 * d + captionHeight + valueHeight + bar + (result.Campaign ? 3 : 6) * d);
            result.ScorePlate = new Rect(left, rowTop - plate, column, plate);
            result.ScoreCaption = new Rect(left + 12 * d, rowTop - 6 * d - captionHeight, inner, captionHeight);
            result.ScoreValue = new Rect(left + 12 * d, result.ScoreCaption.y - valueHeight, inner, valueHeight);
            result.Progress = new Rect(left + 12 * d, result.ScoreValue.y - bar + 2 * d, column - 12 * d - reserve, Mathf.Max(0, bar - 4 * d));
            string moves = session == null ? "100 MOVES" : MovesText(state, session);
            float pill = H(moves, column - 20 * d, result.PillPt, true) + 10 * d;
            result.Moves = new Rect(right, rowTop - pill, column, pill);
            result.Pressure = result.Campaign ? new Rect(right, result.Moves.y, column, 0)
                : new Rect(right, result.Moves.y - gap - pill, column, pill);
            float plates = rowTop - Mathf.Min(result.ScorePlate.y, result.Pressure.height > 0 ? result.Pressure.y : result.Moves.y);
            if (normal.Compact) medallion = Mathf.Min(medallion, plates);
            result.Medallion = new Rect(normal.Frame.center.x - medallion / 2, rowTop - medallion, medallion, medallion);
            float rowBottom = rowTop - Mathf.Max(plates, medallion);

            // Row two: the goals, in plain words. A count sits to the right of its
            // goal; a one-move goal has no count, its star says whether it is done.
            // Text keeps clear of the plate's leaf ends; Campaign cards keep their right end for the star.
            float cardTop = rowBottom - gap, cardMinimum = result.Campaign ? result.StarSize : 0, ends = 14 * d;
            float rightEnd = result.Campaign ? reserve : ends;
            (float h, float captionWidth, float valueWidth, float c, float v) Measure(string caption, string value, float cardWidth)
            {
                float valueWidth = value == null ? 0 : ui.TextWidth(value, result.CardValuePt, true) + 4 * d;
                float captionWidth = Mathf.Max(24 * d, cardWidth - ends - rightEnd - (value == null ? 0 : valueWidth + 6 * d));
                float c = H(caption, captionWidth, result.CaptionPt, false), v = value == null ? 0 : H(value, valueWidth, result.CardValuePt, true);
                return (Mathf.Max(cardMinimum, 8 * d + Mathf.Max(c, v)), captionWidth, valueWidth, c, v);
            }
            void Place((float h, float captionWidth, float valueWidth, float c, float v) m, float cardX, float cardWidth, float h,
                out Rect plateRect, out Rect captionRect, out Rect valueRect)
            {
                plateRect = new Rect(cardX, cardTop - h, cardWidth, h);
                captionRect = new Rect(cardX + ends, cardTop - h / 2 - m.c / 2, m.captionWidth, m.c);
                valueRect = new Rect(captionRect.xMax + 6 * d, cardTop - h / 2 - m.v / 2, m.valueWidth, m.v);
            }
            string primaryCaption = session == null ? "CLEAR LINES" : PrimaryCaptionText(session);
            string primary = session == null ? "0 / 0" : PrimaryText(state, session);
            float cards;
            if (result.Campaign)
            {
                float half = (w - 3 * gap) / 2;
                var first = Measure(primaryCaption, primary, half);
                var second = Measure(session == null ? "CLEAR 3 LINES AT ONCE" : SecondaryCaptionText(session), null, half);
                // Both cards share the taller height so they line up.
                cards = Mathf.Max(first.h, second.h);
                Place(first, x + gap, half, cards, out result.PrimaryPlate, out result.PrimaryCaption, out result.PrimaryValue);
                Place(second, x + 2 * gap + half, half, cards, out result.SecondaryPlate, out result.SecondaryCaption, out _);
            }
            else
            {
                var only = Measure(primaryCaption, primary, w - 2 * gap);
                cards = only.h;
                Place(only, x + gap, w - 2 * gap, cards, out result.PrimaryPlate, out result.PrimaryCaption, out result.PrimaryValue);
                result.SecondaryPlate = result.SecondaryCaption = new Rect(x + gap, cardTop - cards, 0, 0);
            }
            float header = top - (cardTop - cards) + 3 * d;

            // Footer: the guardian's earning rule to the left of the buttons, centred
            // on them and using the footer's height, or above them when it does not
            // fit that column at this text size.
            float footer = normal.Footer;
            var rule = state == null || session == null ? null : art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            float leftWidth = Mathf.Max(1, normal.GuardianButton.x - x - 16 * d);
            string ruleCaption = GuardianCaption(state == null ? (byte)2 : state.BonusType);
            float headingHeight = H(ruleCaption, leftWidth, result.RuleHeadingPt, true);
            float ruleHeight = H(rule?.description ?? "", leftWidth, result.RulePt, false);
            result.RuleAbove = rule != null && headingHeight + ruleHeight > normal.Footer - 8 * d;
            if (result.RuleAbove)
            {
                headingHeight = H(ruleCaption, w - 16 * d, result.RuleHeadingPt, true);
                ruleHeight = H(rule.description, w - 16 * d, result.RulePt, false);
                footer = Mathf.Max(footer, normal.GuardianButton.height + 14 * d + headingHeight + ruleHeight);
            }
            result.Layout = new BoardLayout(safe, density, header, footer, result.RuleAbove);
            var key = result.Layout.GuardianButton;
            if (result.RuleAbove)
            {
                result.Rule = new Rect(x + 8 * d, key.yMax + 4 * d, w - 16 * d, ruleHeight);
                result.RuleHeading = new Rect(result.Rule.x, result.Rule.yMax, result.Rule.width, headingHeight);
            }
            else
            {
                float blockTop = key.center.y + (headingHeight + ruleHeight) / 2;
                result.RuleHeading = new Rect(x + 8 * d, blockTop - headingHeight, leftWidth, headingHeight);
                result.Rule = new Rect(x + 8 * d, result.RuleHeading.y - ruleHeight, leftWidth, ruleHeight);
            }

            // Notices float as a toast on the board's top edge instead of taking a row.
            var board = result.Layout.Board;
            float statusHeight = 0;
            foreach (string notice in BoardNotices.All()) statusHeight = Mathf.Max(statusHeight, H(notice, board.width - 24 * d, result.StatusPt, false));
            result.Status = new Rect(board.x + 12 * d, board.yMax - statusHeight - 14 * d, board.width - 24 * d, statusHeight + 10 * d);
            return result;
        }
    }
}
