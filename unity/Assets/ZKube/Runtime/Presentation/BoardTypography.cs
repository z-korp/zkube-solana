using System;
using TMPro;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Measure with the shipped TMP fonts at the requested size. Growing text
    // reserves space; it never silently asks TMP to shrink the font back down.
    public sealed class BoardTypography
    {
        private const float StarSize = 48, StarOffset = -2, PortraitGap = 3;
        public BoardLayout Layout;
        public float Scale;
        public bool Expanded, RuleAbove;
        public Rect Title, Moves, Status;
        public float StarsY;
        public Rect Star(int index)
        {
            if (index < 0 || index > 2) throw new ArgumentOutOfRangeException(nameof(index));
            float size = StarSize * Layout.Density;
            return new Rect(Layout.Frame.center.x + (index - 1.5f) * size, StarsY, size, size);
        }
        public Rect ScorePlate, ThemePlate, ScoreLabel, ScoreValue, ThemeLabel, ThemeValue, Guardian, RuleHeading, Rule;
        public static string ScoreText(RunSummary state, BoardSession session) => (session.Daily ? state.DailyScore : state.Score).ToString();
        public static string ThemeText(RunSummary state, BoardSession session) => session.Daily ? state.ObjectiveTotal.ToString() : state.PrimaryProgress + "/" + session.Rules.PrimaryCount;
        public static string ScoreCaption(BoardSession session) => session.Daily ? "SCORE" : "SCORE / " + session.Rules.PointsRequired;
        public static string ThemeCaption(BoardSession session) => session.Daily ? BoardView.ObjectiveName(session.Rules.ObjectiveKind, session.Rules.ObjectiveValue) : "SHAPE";
        public static string GuardianCaption(byte bonus) => "EARN " + (bonus == 1 ? "HAMMER" : bonus == 3 ? "WAVE" : "TOTEM");

        public static BoardTypography Build(BoardArt art, RunSummary state, BoardSession session, Rect safe, float density, float scale)
        {
            var result = new BoardTypography { Scale = scale };
            var normal = new BoardLayout(safe, density);
            float d = normal.Density, x = normal.Frame.x, w = normal.Frame.width, top = normal.Frame.yMax;
            float cardY = top - (normal.Compact ? 77 : 109) * d;
            float cardH = (normal.Compact ? 48 : 64) * d, cardW = w * .285f;
            result.ScorePlate = new Rect(x + 8 * d, cardY, cardW, cardH);
            result.ThemePlate = new Rect(x + w - cardW - 8 * d, cardY, cardW, cardH);
            result.ScoreLabel = new Rect(result.ScorePlate.x, cardY + cardH * .65f, cardW, cardH * .27f);
            result.ThemeLabel = new Rect(result.ThemePlate.x, result.ScoreLabel.y, cardW, result.ScoreLabel.height);
            result.ScoreValue = new Rect(result.ScorePlate.x, cardY + 3 * d, cardW, cardH * .65f);
            result.ThemeValue = new Rect(result.ThemePlate.x, result.ScoreValue.y, cardW, result.ScoreValue.height);
            result.Guardian = new Rect(x + w * .32f, top - (normal.Compact ? 86 : 130) * d, w * .36f, (normal.Compact ? 76 : 112) * d);
            float numberSize = 32 * d * (normal.Compact ? .72f : 1) * scale;
            var probe = new GameObject("Temporary TMP layout measurement", typeof(RectTransform), typeof(TextMeshProUGUI));
            probe.hideFlags = HideFlags.HideAndDontSave;
            var text = probe.GetComponent<TextMeshProUGUI>(); text.enableAutoSizing = false; text.enableWordWrapping = true;
            try
            {
                string score = state == null || session == null ? "0" : ScoreText(state, session);
                string theme = state == null || session == null ? "0" : ThemeText(state, session);
                string scoreLabel = session == null ? "SCORE" : ScoreCaption(session);
                string themeLabel = session == null ? "THEME" : ThemeCaption(session);
                float Height(string value, float width, float size, bool display)
                {
                    text.font = display ? art.Display : art.Body; text.fontSize = size;
                    return Mathf.Ceil(text.GetPreferredValues(value, width, float.PositiveInfinity).y) + 2 * d;
                }
                float Width(string value, float size, bool display)
                {
                    text.font = display ? art.Display : art.Body; text.fontSize = size;
                    return Mathf.Ceil(text.GetPreferredValues(value, float.PositiveInfinity, float.PositiveInfinity).x) + 2 * d;
                }
                float titleHeight = Mathf.Max(20 * d, Height(art.Title(session).ToUpperInvariant(), w, 12 * d * scale, false));
                float titleExtra = titleHeight - 20 * d;
                result.Title = new Rect(x, top - titleHeight - 3 * d, w, titleHeight);
                result.ScorePlate.y -= titleExtra; result.ThemePlate.y -= titleExtra;
                result.ScoreLabel.y -= titleExtra; result.ThemeLabel.y -= titleExtra;
                result.ScoreValue.y -= titleExtra; result.ThemeValue.y -= titleExtra; result.Guardian.y -= titleExtra;
                float scoreCaptionHeight = Height(scoreLabel, cardW, 10 * d * scale, false);
                float themeCaptionHeight = Height(themeLabel, cardW, 10 * d * scale, false);
                float scoreNumberHeight = Height(score, cardW, numberSize, true);
                float themeNumberHeight = Height(theme, cardW, numberSize, true);
                float twoCaptionLines = Height("Ag\nAg", cardW, 10 * d * scale, false);
                // A larger requested font or a caption that exceeds its old
                // percentage slot is not a reason to stack the entire HUD.
                // Keep normal values on the sides and grow their shared card
                // downward only as much as the real glyphs require.
                result.Expanded = Width(score, numberSize, true) > cardW || Width(theme, numberSize, true) > cardW ||
                    scoreCaptionHeight > twoCaptionLines || themeCaptionHeight > twoCaptionLines;
                float header = normal.Header + titleExtra;
                if (!result.Expanded)
                {
                    float measuredCardHeight = Mathf.Max(cardH, Mathf.Max(scoreCaptionHeight + scoreNumberHeight,
                        themeCaptionHeight + themeNumberHeight) + 4 * d);
                    float cardTop = result.ScorePlate.yMax;
                    result.ScorePlate = new Rect(result.ScorePlate.x, cardTop - measuredCardHeight, cardW, measuredCardHeight);
                    result.ThemePlate = new Rect(result.ThemePlate.x, cardTop - measuredCardHeight, cardW, measuredCardHeight);
                    result.ScoreLabel = new Rect(result.ScorePlate.x, cardTop - scoreCaptionHeight, cardW, scoreCaptionHeight);
                    result.ThemeLabel = new Rect(result.ThemePlate.x, cardTop - themeCaptionHeight, cardW, themeCaptionHeight);
                    result.ScoreValue = new Rect(result.ScorePlate.x, result.ScorePlate.y + 2 * d, cardW, scoreNumberHeight);
                    result.ThemeValue = new Rect(result.ThemePlate.x, result.ThemePlate.y + 2 * d, cardW, themeNumberHeight);
                    header += measuredCardHeight - cardH;
                    // The portrait has its own vertical slot between the
                    // measured title and the full Campaign socket hit row.
                    // Fit within the existing header first; grow only when a
                    // 48dp calm portrait cannot fit. Side-card text is intact.
                    float portraitTop = result.Title.yMin - PortraitGap * d;
                    float socketTop = top - header + (StarSize + StarOffset) * d;
                    bool campaign = session == null || !session.Daily;
                    float portraitHeight = campaign
                        ? Mathf.Clamp(portraitTop - socketTop - PortraitGap * d, 48 * d, result.Guardian.height)
                        : result.Guardian.height;
                    result.Guardian = new Rect(normal.Frame.center.x - portraitHeight / 2,
                        portraitTop - portraitHeight, portraitHeight, portraitHeight);
                    header = Mathf.Max(header, top - result.Guardian.yMin +
                        (campaign ? StarSize + StarOffset + PortraitGap : PortraitGap) * d);
                }
                if (result.Expanded)
                {
                    float guardianHeight = (normal.Compact ? 64 : 96) * d;
                    result.Guardian = new Rect(normal.Frame.center.x - guardianHeight / 2, result.Title.y - 4 * d - guardianHeight, guardianHeight, guardianHeight);
                    float cursor = result.Guardian.y - 4 * d, width = w - 16 * d;
                    Rect Metric(string label, string value, out Rect caption, out Rect number)
                    {
                        float labelHeight = Height(label, width, 10 * d * scale, false);
                        float numberHeight = Height(value, width, numberSize, true);
                        var plate = new Rect(x + 8 * d, cursor - labelHeight - numberHeight - 4 * d, width, labelHeight + numberHeight + 4 * d);
                        caption = new Rect(plate.x, plate.yMax - labelHeight, width, labelHeight);
                        number = new Rect(plate.x, plate.y + 2 * d, width, numberHeight);
                        cursor = plate.y - 4 * d; return plate;
                    }
                    result.ScorePlate = Metric(scoreLabel, score, out result.ScoreLabel, out result.ScoreValue);
                    result.ThemePlate = Metric(themeLabel, theme, out result.ThemeLabel, out result.ThemeValue);
                    header = top - cursor + 48 * d;
                }
                // Keep the existing side slot whenever every actual notice
                // fits. Otherwise reserve its full-width row before gameplay,
                // including messages that will arrive while Busy blocks reflow.
                bool fullStatus = false;
                foreach (string notice in BoardNotices.All())
                    if (Height(notice, w * .25f, 9 * d * scale, false) > 24 * d) fullStatus = true;
                float statusRow = 0;
                if (fullStatus)
                {
                    foreach (string notice in BoardNotices.All()) statusRow = Mathf.Max(statusRow, Height(notice, w - 16 * d, 9 * d * scale, false));
                    header += statusRow;
                }
                string moveText = state == null || session == null ? "100 MOVES" : Math.Max(0, session.Rules.MaxMoves - state.Moves) + " MOVES";
                float moveHeight = Mathf.Max(22 * d, Height(moveText, w * .27f, 11 * d * scale, false));
                result.Moves = new Rect(x + 8 * d, top - header + statusRow, w * .27f, moveHeight);
                result.Status = fullStatus ? new Rect(x + 8 * d, top - header, w - 16 * d, statusRow)
                    : new Rect(x + w * .73f, top - header, w * .25f, 24 * d);
                result.StarsY = top - header + statusRow + StarOffset * d;
                float footer = normal.Footer;
                var rule = state == null || session == null ? null : art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
                float leftWidth = Mathf.Max(1, normal.GuardianButton.x - x - 16 * d);
                string guardianCaption = GuardianCaption(state == null ? (byte)2 : state.BonusType);
                float headingHeight = Height(guardianCaption, leftWidth, 10 * d * scale, false);
                float ruleHeight = Height(rule?.description ?? "", leftWidth, 12 * d * scale, false);
                result.RuleAbove = rule != null && headingHeight + ruleHeight > normal.GuardianButton.height;
                if (result.RuleAbove)
                {
                    headingHeight = Height(guardianCaption, w - 16 * d, 10 * d * scale, false);
                    ruleHeight = Height(rule.description, w - 16 * d, 12 * d * scale, false);
                    footer = Mathf.Max(footer, normal.GuardianButton.height + 24 * d + headingHeight + ruleHeight);
                }
                result.Layout = new BoardLayout(safe, density, header, footer, result.RuleAbove);
                var key = result.Layout.GuardianButton;
                if (result.RuleAbove)
                {
                    result.Rule = new Rect(x + 8 * d, key.yMax + 6 * d, w - 16 * d, ruleHeight);
                    result.RuleHeading = new Rect(result.Rule.x, result.Rule.yMax, result.Rule.width, headingHeight);
                }
                else
                {
                    result.RuleHeading = new Rect(x + 8 * d, key.yMax - headingHeight, leftWidth, headingHeight);
                    result.Rule = new Rect(x + 8 * d, key.y, leftWidth, key.height - headingHeight);
                }
                return result;
            }
            finally { UnityEngine.Object.Destroy(probe); }
        }
    }
}
