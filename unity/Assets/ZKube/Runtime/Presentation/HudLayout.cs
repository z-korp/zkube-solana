using System;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The board HUD: a title ribbon, the guardian medallion with the Campaign
    // stars on its rim, a score plate with the moves pill on the left, and two
    // stacked plates on the right (Campaign: both constraints; Daily: the
    // objective and the pressure). Every height is measured with the shipped
    // fonts at the requested text size; text grows its plate, never shrinks.
    public sealed class HudLayout
    {
        public BoardLayout Layout;
        public float Scale;
        public bool Campaign, RuleAbove, ShortSecondary;
        public Rect Title, Medallion, ScorePlate, ScoreCaption, ScoreValue, Progress, Moves;
        public Rect PrimaryPlate, PrimaryCaption, PrimaryValue, SecondaryPlate, SecondaryCaption, SecondaryValue;
        public Rect Status, RuleHeading, Rule;
        public float StarSize;
        // Each Campaign star sits at the right end of the plate for its source:
        // score, the cumulative Shape constraint and the moment Blow constraint.
        public Rect Star(int index)
        {
            if (index < 0 || index > 2) throw new ArgumentOutOfRangeException(nameof(index));
            var plate = index == 0 ? ScorePlate : index == 1 ? PrimaryPlate : SecondaryPlate;
            return new Rect(plate.xMax - StarSize - 2 * Layout.Density, plate.center.y - StarSize / 2, StarSize, StarSize);
        }

        public const float TitleSize = 17, CaptionSize = 9, ValueSize = 24, MinorValueSize = 16, MovesSize = 11, RuleHeadingSize = 10,
            RuleSize = 12, StatusSize = 11;

        public static string TitleText(BoardArt art, BoardSession session) => art.Title(session).ToUpperInvariant();
        public static string ScoreCaptionText(BoardSession session) => session.Daily ? "SCORE" : "SCORE / " + session.Rules.PointsRequired;
        public static string ScoreText(RunSummary state, BoardSession session) =>
            (session.Daily ? state.DailyScore : state.Score).ToString();
        public static float ScoreProgress(RunSummary state, BoardSession session) =>
            session.Daily || session.Rules.PointsRequired == 0 ? 0 : Mathf.Clamp01((float)state.Score / session.Rules.PointsRequired);
        public static string MovesText(RunSummary state, BoardSession session) => Math.Max(0, session.Rules.MaxMoves - state.Moves) + " MOVES";
        public static string PrimaryCaptionText(BoardSession session) => session.Daily
            ? BoardView.ObjectiveName(session.Rules.ObjectiveKind, session.Rules.ObjectiveValue) : "SHAPE";
        public static string PrimaryText(RunSummary state, BoardSession session) => session.Daily
            ? state.ObjectiveTotal.ToString() : state.PrimaryProgress + " / " + session.Rules.PrimaryCount;
        public static string SecondaryCaptionText(BoardSession session) => session.Daily
            ? "PRESSURE" : BoardView.ObjectiveName(session.Rules.SecondaryKind, session.Rules.SecondaryValue);
        public static string SecondaryText(RunSummary state, BoardSession session) => session.Daily
            ? state.CurrentTier.ToString() : (state.LatchedStarSources & 4) != 0 ? "DONE" : "TO DO";
        public static string GuardianCaption(byte bonus) => "EARN " + (bonus == 1 ? "HAMMER" : bonus == 3 ? "WAVE" : "TOTEM");

        public static HudLayout Build(SkinUi ui, RunSummary state, BoardSession session, Rect safe, float density)
        {
            var art = ui.Art;
            var result = new HudLayout { Scale = ui.Scale, Campaign = session == null || !session.Daily };
            var normal = new BoardLayout(safe, density);
            float d = normal.Density, x = normal.Frame.x, w = normal.Frame.width, top = normal.Frame.yMax, gap = 6 * d;
            float H(string value, float width, float size, bool display) => ui.TextHeight(value, width, size, display);

            string title = session == null ? "GUARDIAN · DAILY" : TitleText(art, session);
            float titleWidth = Mathf.Min(w * .8f, ui.TextWidth(title, TitleSize, true) + 72 * d);
            float titleHeight = H(title, titleWidth - 48 * d, TitleSize, true) + 10 * d;
            result.Title = new Rect(normal.Frame.center.x - titleWidth / 2, top - titleHeight, titleWidth, titleHeight);

            float medallion = Mathf.Clamp(w * .3f, 76 * d, 116 * d) * (normal.Compact ? .85f : 1);
            float rowTop = result.Title.yMin - 3 * d;
            result.Medallion = new Rect(normal.Frame.center.x - medallion / 2, rowTop - medallion, medallion, medallion);
            result.StarSize = 48 * d;

            float column = (w - medallion - 4 * gap) / 2;
            // Campaign plates reserve their right end for the source's star.
            float reserve = result.Campaign ? result.StarSize * .6f : 0, inner = column - 16 * d - reserve;
            float minimum = result.Campaign ? result.StarSize : 0;
            float left = x + gap, right = x + w - gap - column;

            // Left column: score plate (with a Campaign progress bar), then moves.
            string score = session == null ? "0" : ScoreText(state, session);
            string scoreCaption = session == null ? "SCORE" : ScoreCaptionText(session);
            float captionHeight = H(scoreCaption, inner, CaptionSize, false), valueHeight = H(score, inner, ValueSize, true);
            float bar = result.Campaign ? 9 * d : 0;
            float plate = Mathf.Max(minimum, 7 * d + captionHeight + valueHeight + bar + 6 * d);
            result.ScorePlate = new Rect(left, rowTop - plate, column, plate);
            result.ScoreCaption = new Rect(left + 8 * d, rowTop - 7 * d - captionHeight, inner, captionHeight);
            result.ScoreValue = new Rect(left + 8 * d, result.ScoreCaption.y - valueHeight, inner, valueHeight);
            result.Progress = new Rect(left + 12 * d, result.ScoreValue.y - bar + 2 * d, column - 24 * d - reserve, Mathf.Max(0, bar - 4 * d));
            string moves = session == null ? "100 MOVES" : MovesText(state, session);
            float movesHeight = H(moves, column * .8f - 12 * d, MovesSize, true) + 6 * d;
            result.Moves = new Rect(left + column * .1f, result.ScorePlate.y - gap - movesHeight, column * .8f, movesHeight);

            // Right column: two stacked plates.
            float Stack(string caption, string value, float plateTop, float valueSize, out Rect plateRect, out Rect captionRect, out Rect valueRect)
            {
                float c = H(caption, inner, CaptionSize, false), v = H(value, inner, valueSize, true);
                float h = Mathf.Max(minimum, 6 * d + c + v + 6 * d);
                plateRect = new Rect(right, plateTop - h, column, h);
                captionRect = new Rect(right + 8 * d, plateTop - (h - c - v) / 2 - c, inner, c);
                valueRect = new Rect(right + 8 * d, captionRect.y - v, inner, v);
                return plateRect.y;
            }
            string primaryCaption = session == null ? "SHAPE" : PrimaryCaptionText(session);
            string primary = session == null ? "0 / 0" : PrimaryText(state, session);
            string secondaryCaption = session == null ? "PRESSURE" : SecondaryCaptionText(session);
            // A Campaign constraint name longer than one line gets its short source name; the
            // full description stays one tap away on the plate's star.
            result.ShortSecondary = result.Campaign && H(secondaryCaption, inner, CaptionSize, false) > H("Ag", inner, CaptionSize, false);
            if (result.ShortSecondary) secondaryCaption = "BLOW";
            string secondary = session == null ? "0" : SecondaryText(state, session);
            float next = Stack(primaryCaption, primary, rowTop, MinorValueSize, out result.PrimaryPlate, out result.PrimaryCaption, out result.PrimaryValue);
            float bottom = Stack(secondaryCaption, secondary, next - gap, MinorValueSize, out result.SecondaryPlate, out result.SecondaryCaption, out result.SecondaryValue);

            float headerBottom = Mathf.Min(Mathf.Min(result.Moves.y, bottom), result.Medallion.y);
            float header = top - headerBottom + 3 * d;

            // Footer: the guardian's earning rule to the left of the buttons, or
            // above them when it does not fit that column at this text size.
            float footer = normal.Footer;
            var rule = state == null || session == null ? null : art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            float leftWidth = Mathf.Max(1, normal.GuardianButton.x - x - 16 * d);
            string ruleCaption = GuardianCaption(state == null ? (byte)2 : state.BonusType);
            float headingHeight = H(ruleCaption, leftWidth, RuleHeadingSize, true);
            float ruleHeight = H(rule?.description ?? "", leftWidth, RuleSize, false);
            result.RuleAbove = rule != null && headingHeight + ruleHeight > normal.GuardianButton.height;
            if (result.RuleAbove)
            {
                headingHeight = H(ruleCaption, w - 16 * d, RuleHeadingSize, true);
                ruleHeight = H(rule.description, w - 16 * d, RuleSize, false);
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
                result.RuleHeading = new Rect(x + 8 * d, key.yMax - headingHeight, leftWidth, headingHeight);
                result.Rule = new Rect(x + 8 * d, key.y, leftWidth, Mathf.Max(ruleHeight, key.height - headingHeight));
            }

            // Notices float as a toast on the board's top edge instead of taking a row.
            float statusHeight = 0;
            foreach (string notice in BoardNotices.All()) statusHeight = Mathf.Max(statusHeight, H(notice, w - 48 * d, StatusSize, false));
            var board = result.Layout.Board;
            result.Status = new Rect(board.x + 12 * d, board.yMax - statusHeight - 14 * d, board.width - 24 * d, statusHeight + 10 * d);
            return result;
        }
    }
}
