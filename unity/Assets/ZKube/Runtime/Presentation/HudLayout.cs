using System;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The Lumen board HUD, reproduced from the approved header geometry
    // (400 x 890 dp): a Fraunces title over a light stroke, four plates of one
    // size (score and moves on the left, the two goals on the right) and the
    // guardian centred between them, leaning on the board frame's top rim.
    // Under the board: the NEXT ROW label, the tray, and a footer with the
    // guardian's earning rule beside the power, reroll and pause tablets.
    // Offsets are glyph tops, as drawn; text grows its plate, never shrinks.
    public sealed class HudLayout
    {
        public BoardLayout Layout;
        public float Scale;
        public bool Campaign;
        public Rect Title, Ribbon, TitleShade, Guardian;
        public Rect ScorePlate, ScoreCaption, ScoreValue, ScoreTarget, MovesPlate, MovesCaption, MovesValue;
        public Rect PrimaryPlate, PrimaryCaption, PrimaryValue, SecondaryPlate, SecondaryCaption, SecondaryValue;
        public Rect NextLabel, RuleHeading, Rule, Status;
        // Type sizes in dp for this layout, before the player's text size.
        public float TitlePt, LabelPt, PrimaryCaptionPt, SecondaryCaptionPt, NumberPt, GoalPt, PointsPt, TargetPt, RuleHeadingPt, RulePt, StatusPt;
        // A caption line advances 13 dp at 12 dp, as drawn.
        public const float CaptionLeading = 13f / 12;
        // The Caption role's floor, below its 12 dp (11 dp compact) plate size.
        public const float CaptionMinimumPt = 10;
        // Space between a caption's ink and its value's digits.
        public const float ValueClearanceDp = 2;
        public const float StarDp = 20;
        public float Density => Layout.Density;

        // Each Campaign star shows on the plate of its source: score, the
        // cumulative goal and the one-move goal. The whole plate opens its detail.
        public Rect Star(int index) => StarOn(index, Plate(index));
        public Rect Plate(int index) => index switch
        {
            0 => ScorePlate, 1 => PrimaryPlate, 2 => SecondaryPlate, _ => throw new ArgumentOutOfRangeException(nameof(index)),
        };
        private Rect StarOn(int index, Rect plate)
        {
            var value = index == 0 ? ScoreValue : index == 1 ? PrimaryValue : SecondaryValue;
            float size = StarDp * Density, glyph = ValueCentre(value, index == 0 ? NumberPt : GoalPt);
            return new Rect(plate.x + 8 * Density, glyph - size / 2, size, size);
        }
        // The vertical centre of a value's digits inside its text rect.
        private float ValueCentre(Rect value, float sizeDp) => value.yMax - (DigitTop + .4f) * sizeDp * Scale * Density;
        // Digit tops sit this far (in em) below the font's ascender, where a
        // top-aligned TMP line starts.
        public static float DigitTop = .31f;

        public static string TitleText(BoardArt art, BoardSession session) => art.Title(session);
        // Campaign levels are numbered across realms.
        public static string LevelNumber(byte realm, byte level) =>
            ((realm - 1) * Protocol.CampaignTargets.Length + level).ToString(System.Globalization.CultureInfo.InvariantCulture);
        public static string CampaignTitle(byte realm, byte level) =>
            PageCatalog.Load().Realm(realm).realmName + " · Level " + LevelNumber(realm, level);
        public static string ScoreText(RunSummary state, BoardSession session) =>
            (session.Daily ? state.DailyScore : state.Score).ToString();
        public static string ScoreTargetText(BoardSession session) => session.Daily ? "" : "/ " + session.Rules.PointsRequired;
        public static string MovesText(RunSummary state, BoardSession session) => Math.Max(0, session.Rules.MaxMoves - state.Moves).ToString();
        public static bool MovesLow(RunSummary state, BoardSession session) => session.Rules.MaxMoves - state.Moves <= 5;
        // Daily pressure, as what it does for the player: the points multiplier.
        public static string PressureValue(RunSummary state) =>
            "×" + (Protocol.PressureMultiplierPercent(state.CurrentTier) / 100f).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        public static string PrimaryCaptionText(BoardSession session) => session.Daily
            ? BoardView.ObjectiveName(session.Rules.ObjectiveKind, session.Rules.ObjectiveValue)
            : BoardView.ObjectiveName(session.Rules.PrimaryKind, session.Rules.PrimaryValue, session.Rules.PrimaryCount);
        public static string PrimaryText(RunSummary state, BoardSession session) => session.Daily
            ? state.ObjectiveTotal.ToString() : state.PrimaryProgress + " / " + session.Rules.PrimaryCount;
        public static string SecondaryCaptionText(BoardSession session) => session.Daily ? "POINTS" :
            BoardView.ObjectiveName(session.Rules.SecondaryKind, session.Rules.SecondaryValue, session.Rules.SecondaryCount);
        public static string SecondaryText(RunSummary state, BoardSession session) => session.Daily
            ? PressureValue(state) : ((state.LatchedStarSources & 4) != 0 ? 1 : 0) + " / 1";
        public static string PowerName(byte bonus) => bonus == 1 ? "HAMMER" : bonus == 3 ? "WAVE" : "TOTEM";
        public static string GuardianCaption(byte bonus) => "EARN " + PowerName(bonus);

        // The header is drawn from the screen's top, as the approved geometry is.
        // Only the title may sit inside the top safe inset, clear of any camera
        // cutout; the plates, guardian and board stay inside the safe area.
        public static HudLayout Build(SkinUi ui, RunSummary state, BoardSession session, Rect safe, float density,
            Rect? screen = null, Rect[] cutouts = null)
        {
            var art = ui.Art;
            var result = new HudLayout { Scale = ui.Scale, Campaign = session == null || !session.Daily };
            var first = new BoardLayout(safe, density);
            bool compact = first.Compact;
            var drawing = screen ?? safe;
            float d = first.Density, s = ui.Scale, inset = Mathf.Max(0, drawing.yMax - safe.yMax) / d;
            // The drawing moves down only as far as the inset would cover the plates.
            float shift = Mathf.Max(0, inset + 2 - (compact ? 22 : 60)), top = drawing.yMax - shift * d;
            float H(string value, float width, float size, SkinUi.Type type) => ui.TextHeight(value, width, size, type);
            result.TitlePt = compact ? 14 : 16; result.LabelPt = compact ? 11 : 12; float captionPt = compact ? 11 : 12;
            result.NumberPt = compact ? 24 : 28; result.GoalPt = compact ? 18 : 20; result.PointsPt = compact ? 21 : 24;
            result.TargetPt = compact ? 12 : 14; result.RuleHeadingPt = 11; result.RulePt = 12; result.StatusPt = 12;
            // A type size as drawn, in dp, at the player's text size.
            float S(float sizeDp) => sizeDp * s;
            // Converts a glyph top, dp below the safe top, to the top of its text rect.
            float Glyph(float dpFromTop, float sizeDp) => top - dpFromTop * d + DigitTop * S(sizeDp) * d;

            // The title and its light stroke.
            string title = session == null ? "Guardian · Daily" : TitleText(art, session);
            float titleTop = compact ? 4 : 25, titleWidth = Mathf.Min(safe.width - 32 * d, ui.TextWidth(title, result.TitlePt, SkinUi.Type.Title) + 8 * d);
            float titleHeight = H(title, titleWidth, result.TitlePt, SkinUi.Type.Title);
            result.Title = new Rect(safe.center.x - titleWidth / 2, Glyph(titleTop, result.TitlePt) - titleHeight, titleWidth, titleHeight);
            foreach (var cutout in cutouts ?? Array.Empty<Rect>())
                if (cutout.xMax > result.Title.xMin && cutout.xMin < result.Title.xMax && cutout.yMin < result.Title.yMax)
                    titleTop = Mathf.Max(titleTop, (top - cutout.yMin) / d + 2 + DigitTop * S(result.TitlePt));
            result.Title = new Rect(result.Title.x, Glyph(titleTop, result.TitlePt) - titleHeight, titleWidth, titleHeight);
            float ribbonTop = titleTop + S(result.TitlePt) + 4;
            result.Ribbon = new Rect(safe.center.x - 75 * d, top - (ribbonTop + 8) * d, 150 * d, 8 * d);
            result.TitleShade = new Rect(safe.center.x - 150 * d, top - (titleTop + S(result.TitlePt) + 22) * d, 300 * d, (S(result.TitlePt) + 40) * d);

            // Four plates of one size around the guardian, which overlaps each by 12 dp.
            float guardianWidth = (compact ? 96 : 168) * d, rimWidth = first.Rim.width;
            float plateWidth = Mathf.Min(120 * d, (rimWidth - guardianWidth) / 2 + 12 * d);
            float left = first.Rim.x, right = first.Rim.xMax - plateWidth, inner = plateWidth - 16 * d;
            // The plates start under the title's box, never above the drawn row.
            float titleBottom = (top - result.Title.y) / d;
            float rowTop = Mathf.Max(compact ? 22 : 60, titleBottom + 2), gap = compact ? 4 : 6;
            string scoreLabel = "SCORE", movesLabel = "MOVES";
            string primaryCaption = session == null ? "Clear lines" : PrimaryCaptionText(session);
            string secondaryCaption = session == null ? "Moves clearing 2+ lines" : SecondaryCaptionText(session);
            // A plate's content: caption lines from 6 dp at the drawn 13 dp leading,
            // then its value; offsets are glyph tops, as drawn.
            float CaptionBlock(string value, SkinUi.Type type, float size) =>
                ui.Lines(value, inner, size, type) * S(size) * CaptionLeading;
            float labelBlock = CaptionBlock(scoreLabel, SkinUi.Type.Label, result.LabelPt);
            // Each goal caption keeps its role size on one line; a longer one
            // shrinks toward the role's floor before it wraps. The values then sit
            // on one line across both plates, clear of either caption.
            float Fit(string value)
            {
                float size = captionPt;
                while (size > CaptionMinimumPt && ui.Lines(value, inner, size, SkinUi.Type.Caption) > 1) size -= .5f;
                return size;
            }
            result.PrimaryCaptionPt = Fit(primaryCaption); result.SecondaryCaptionPt = Fit(secondaryCaption);
            // A caption's ink ends at its last line's descent, measured as it is
            // drawn: from its rect's top, lines 13/12 apart.
            float CaptionBottom(string value, float size) => 6 - DigitTop * S(size) +
                (ui.TextHeight(value, inner, size, SkinUi.Type.Caption, CaptionLeading) - 2 * d) / d;
            float captionBottom = Mathf.Max(CaptionBottom(primaryCaption, result.PrimaryCaptionPt),
                CaptionBottom(secondaryCaption, result.SecondaryCaptionPt));
            float numberTop = 6 + Mathf.Max(compact ? 17 : 21, labelBlock);
            float goalTop = Mathf.Max(6 + (compact ? 19 : 24), captionBottom + ValueClearanceDp);
            float Height(float valueTop, float valueSize) => valueTop + S(valueSize) * .74f + 4;
            float plate = Mathf.Max(compact ? MinimumPlateDp(true) : 52,
                Mathf.Max(Height(numberTop, result.NumberPt), Height(goalTop, Mathf.Max(result.GoalPt, result.PointsPt))));
            float row1 = rowTop, row2 = rowTop + plate + gap;
            Rect PlateAt(float x, float fromTop) => new Rect(x, top - (fromTop + plate) * d, plateWidth, plate * d);
            result.ScorePlate = PlateAt(left, row1); result.MovesPlate = PlateAt(left, row2);
            result.PrimaryPlate = PlateAt(right, row1); result.SecondaryPlate = PlateAt(right, row2);
            Rect Text(Rect owner, float x, float fromPlateTop, float width, float size, string value, SkinUi.Type type)
            {
                float height = H(value, width, size, type) + 2 * d;
                float rectTop = owner.yMax - fromPlateTop * d + DigitTop * S(size) * d;
                return new Rect(owner.x + x * d, rectTop - height, width, height);
            }
            float star = result.Campaign ? 34 : 8, valueWidth = plateWidth - (star + 8) * d;
            result.ScoreCaption = Text(result.ScorePlate, 8, 6, inner, result.LabelPt, scoreLabel, SkinUi.Type.Label);
            result.ScoreValue = Text(result.ScorePlate, star, numberTop, valueWidth, result.NumberPt, "0", SkinUi.Type.Number);
            result.ScoreTarget = Text(result.ScorePlate, star, numberTop + 8 * s * (compact ? .85f : 1), valueWidth, result.TargetPt, "/ 0",
                SkinUi.Type.Caption);
            result.MovesCaption = Text(result.MovesPlate, 8, 6, inner, result.LabelPt, movesLabel, SkinUi.Type.Label);
            result.MovesValue = Text(result.MovesPlate, 8, numberTop, inner, result.NumberPt, "0", SkinUi.Type.Number);
            result.PrimaryCaption = Text(result.PrimaryPlate, 8, 6, inner, result.PrimaryCaptionPt, primaryCaption, SkinUi.Type.Caption);
            result.PrimaryValue = Text(result.PrimaryPlate, star, goalTop, valueWidth, result.GoalPt, "0 / 0", SkinUi.Type.Number);
            result.SecondaryCaption = Text(result.SecondaryPlate, 8, 6, inner, result.SecondaryCaptionPt, secondaryCaption,
                SkinUi.Type.Caption);
            result.SecondaryValue = result.Campaign
                ? Text(result.SecondaryPlate, star, goalTop, valueWidth, result.GoalPt, "0 / 1", SkinUi.Type.Number)
                : Text(result.SecondaryPlate, 8, goalTop - 2, inner, result.PointsPt, "×1", SkinUi.Type.Number);
            // The header's height below the safe top, where the board begins.
            float header = row2 + plate + 4 + shift - inset;

            // The footer: the earning rule beside the tablets, starting at their top.
            var provisional = new BoardLayout(safe, density, header * d);
            var rule = state == null || session == null ? null : art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            float column = Mathf.Max(1, provisional.GuardianButton.x - provisional.FooterColumn.x - 16 * d);
            string heading = GuardianCaption(state == null ? (byte)2 : state.BonusType);
            float headingHeight = H(heading, column, result.RuleHeadingPt, SkinUi.Type.Label);
            float ruleHeight = H(rule?.description ?? "", column, result.RulePt, SkinUi.Type.Caption);
            // Glyph tops 4 and 22 dp under the tablets' top, as drawn.
            float headingTop = compact ? 2 : 4, ruleTop = headingTop + 18 * s;
            float footer = Mathf.Max(BoardLayout.DefaultFooterDp(compact) * d,
                ruleTop * d + ruleHeight + (compact ? 8 : 16) * d);
            result.Layout = new BoardLayout(safe, density, header * d, footer);
            var layout = result.Layout;
            float tabletTop = layout.GuardianButton.yMax;
            float GlyphBelow(float dp, float size) => tabletTop - dp * d + DigitTop * S(size) * d;
            result.RuleHeading = new Rect(layout.FooterColumn.x + 8 * d, GlyphBelow(headingTop, result.RuleHeadingPt) - headingHeight, column, headingHeight);
            result.Rule = new Rect(result.RuleHeading.x, GlyphBelow(ruleTop, result.RulePt) - ruleHeight, column, ruleHeight);

            // The guardian leans on the frame's top rim: its rail line sits 1 dp below the rim's top.
            float railY = art.GuardianRailY, rail = layout.Rim.yMax - 1 * d;
            result.Guardian = new Rect(safe.center.x - guardianWidth / 2, rail - (1 - railY) * guardianWidth, guardianWidth, guardianWidth);

            float labelHeight = H("NEXT ROW", layout.Rim.width, result.LabelPt * 11 / 12, SkinUi.Type.Label);
            float labelTop = layout.Rim.y - (compact ? 10 : 32) * d + DigitTop * S(result.LabelPt * 11 / 12) * d;
            result.NextLabel = new Rect(layout.Rim.x, labelTop - labelHeight, layout.Rim.width, labelHeight);

            // Notices float as a toast on the board's top edge instead of taking a row.
            var board = layout.Board;
            float statusHeight = 0;
            foreach (string notice in BoardNotices.All())
                statusHeight = Mathf.Max(statusHeight, H(notice, board.width - 24 * d, result.StatusPt, SkinUi.Type.Body));
            result.Status = new Rect(board.x + 12 * d, board.yMax - statusHeight - 14 * d, board.width - 24 * d, statusHeight + 10 * d);
            return result;
        }
        // Compact plates keep the 48 dp touch height of the stars they open.
        public static float MinimumPlateDp(bool compact) => compact ? BoardLayout.MinimumTouchDp : 52;
    }
}
