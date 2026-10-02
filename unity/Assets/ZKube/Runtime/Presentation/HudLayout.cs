using System;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The Lumen board HUD, from the approved v2 wireframes with the board first
    // (DECISIONS 2026-10-02): the board takes the width and the header the
    // height its cells leave. The guardian leans on the board frame's own edge;
    // above its head the three star sockets sit on a dark pill (the Daily puts
    // its score there). The goal plates stack on the right and end at the
    // frame's top; the moves tablet sits on the left. Nothing enters the top
    // inset. Under the board: the NEXT ROW label, the tray, and the thumb row
    // that BoardLayout places.
    // One layout for every HUD plate (the number is the hero; content sized to
    // the plate). A row plate: the pictogram square sits the same distance from
    // the plate's left, top and bottom edges; GapDp separates it from the value
    // area, which runs to the same distance from the right edge; the value is
    // centred in that area, over a counter bar along its foot when it has one.
    // A plate without a pictogram centres its value between equal insets. A
    // column tablet centres its pictogram under the top inset and its value in
    // the rest.
    public readonly struct PlateLayout
    {
        public const float GapDp = 6, IconDp = 32, BarGapDp = 2;
        // Icon is empty for a value-only plate; Bar is empty without a counter bar.
        public readonly Rect Plate, Icon, Value, Number, Bar;
        public readonly float Inset;
        private PlateLayout(Rect plate, Rect icon, Rect value, Rect number, Rect bar, float inset)
        { Plate = plate; Icon = icon; Value = value; Number = number; Bar = bar; Inset = inset; }
        // unit is pixels per plate dp (the plates' scale times the density).
        public static PlateLayout Row(Rect plate, float unit, float iconDp = IconDp, float barPixels = 0)
        {
            float icon = Mathf.Min(iconDp * unit, plate.height - 4 * unit), inset = (plate.height - icon) / 2;
            var picture = new Rect(plate.x + inset, plate.y + inset, icon, icon);
            var value = Rect.MinMaxRect(picture.xMax + GapDp * unit, plate.y + Mathf.Min(inset, 5 * unit), plate.xMax - inset, plate.yMax - Mathf.Min(inset, 5 * unit));
            return Split(plate, picture, value, unit, barPixels, inset);
        }
        public static PlateLayout ValueOnly(Rect plate, float unit, float insetDp, float barPixels = 0)
        {
            float inset = insetDp * unit;
            return Split(plate, Rect.zero, Rect.MinMaxRect(plate.x + inset, plate.y + inset, plate.xMax - inset, plate.yMax - inset), unit, barPixels, inset);
        }
        public static PlateLayout Column(Rect plate, float unit, float iconDp, float insetDp)
        {
            float icon = iconDp * unit, inset = insetDp * unit;
            var picture = new Rect(plate.center.x - icon / 2, plate.yMax - inset - icon, icon, icon);
            var value = Rect.MinMaxRect(plate.x, plate.y, plate.xMax, picture.y);
            return new PlateLayout(plate, picture, value, value, Rect.zero, inset);
        }
        private static PlateLayout Split(Rect plate, Rect picture, Rect value, float unit, float barPixels, float inset)
        {
            if (barPixels <= 0) return new PlateLayout(plate, picture, value, value, Rect.zero, inset);
            var bar = new Rect(value.x, value.y, value.width, barPixels);
            return new PlateLayout(plate, picture, value, Rect.MinMaxRect(value.x, bar.yMax + BarGapDp * unit, value.xMax, value.yMax), bar, inset);
        }
    }

    public sealed class HudLayout
    {
        public BoardLayout Layout;
        public float Scale;
        public bool Campaign;
        // The plates' scale: 1, or 0.8 on a compact screen.
        public float K;
        // The whole screen the board draws on; Layout.Frame is its safe area.
        public Rect Screen;
        // Crown is the dark pill behind the sockets, or the Daily score plate.
        // Best is the Daily's best-score badge over the score plate's top right.
        public Rect Guardian, Crown, Medal, Best, Moves, NextLabel, Status;
        // The Daily score plate's pictogram.
        public const float ScoreIconDp = 40;
        // The Daily's badge rises BestAboveDp over its score plate.
        public const float BestAboveDp = 10, BestDp = 20;
        public readonly Rect[] Sockets = new Rect[3], Plates = new Rect[3];
        // Type sizes in dp for this layout, at the player's text size.
        public float CountPt, MovesPt, LevelPt, ScorePt, ChipPt, EarnPt, LabelPt, StatusPt, BubblePt, BubbleCountPt;
        // A fill bar's height: 6 dp, 4 on a compact screen.
        public float BarDp;
        public float Density => Layout.Density;

        // The plates shrink to this share of their drawn size before the board's
        // cells give way; the guardian is drawn at most this wide.
        public const float HeaderFloorK = .75f, CompactFloorK = .6f, GuardianFullDp = 170, GuardianMaxDp = 220;
        // A star socket's size at the plates' drawn scale.
        public const float StarDp = 38;
        // The guardian's painted figure inside its canvas: clear margins of about
        // 7% at each side (its top margin is what the crown overlaps).
        public const float GuardianSideMargin = .07f;
        // A compact screen gives the board priority: its cells are at least this.
        public const float MinCompactCellDp = 34;
        // The armed power's prompt, in the Earn panel: the smallest size the HUD's words take.
        public const float PromptPt = 12;
        // The Earn caption's size, the Caption role's 11 dp, 10 on a compact screen.
        private static float EarnCaptionPt(bool compact) => compact ? 10 : 11;
        // The crown overlaps the top eighth of the guardian's canvas, clear above its head.
        private const float CrownOverGuardian = .124f;
        // Digit tops sit this far (in em) below the font's ascender, where a
        // top-aligned TMP line starts.
        public static float DigitTop = .31f;

        // A rect inside owner, in the wireframe's dp from its top left at scale k.
        public Rect In(Rect owner, float x, float y, float width, float height) =>
            new Rect(owner.x + x * K * Density, owner.yMax - (y + height) * K * Density, width * K * Density, height * K * Density);

        // Stars fill left to right whatever order the goals complete in
        // (DECISIONS 2026-10-02): the lit sockets are the count of met goals.
        public static int StarCount(byte sources) => (sources & 1) + (sources >> 1 & 1) + (sources >> 2 & 1);
        // Each goal newly met between two states, with the socket its star fills.
        public static System.Collections.Generic.IEnumerable<(int goal, int socket)> NewStars(byte previous, byte now)
        {
            int socket = StarCount(previous);
            for (int goal = 0; goal < 3; goal++)
                if ((now & 1 << goal) != 0 && (previous & 1 << goal) == 0) yield return (goal, socket++);
        }
        // Campaign levels are numbered across realms.
        public static string LevelNumber(byte realm, byte level) =>
            ((realm - 1) * Protocol.CampaignTargets.Length + level).ToString(System.Globalization.CultureInfo.InvariantCulture);
        public static uint MovesLeft(RunSummary state, BoardSession session) => (uint)Math.Max(0, session.Rules.MaxMoves - state.Moves);
        // The tablet warms at five moves left and turns ember at three.
        public static string MovesSlot(uint left) => left <= 3 ? SkinSlots.MovesEmber : left <= 5 ? SkinSlots.MovesWarm : SkinSlots.MovesCalm;
        // Daily pressure, as what it does for the player: the points multiplier.
        public static string PressureValue(RunSummary state) =>
            "×" + (Protocol.PressureMultiplierPercent(state.CurrentTier) / 100f).ToString("0.##", System.Globalization.CultureInfo.InvariantCulture);
        // How far the pressure score has run toward the next multiplier.
        // A countdown to 00:00 UTC, in seconds: never below zero and at most a
        // second under a day, so no day clock reads 24 hours.
        public static long DayCountdown(long seconds) => Math.Min(Math.Max(0, seconds), 24 * 3600 - 1);
        public static float PressureProgress(RunSummary state) => state.PressureScore % Protocol.PressureStep / (float)Protocol.PressureStep;
        // Time left as hours and minutes, h:mm; the last minute reads 0:00.
        public static string TimeLeft(long seconds)
        {
            long minutes = DayCountdown(seconds) / 60;
            return (minutes / 60).ToString(System.Globalization.CultureInfo.InvariantCulture) + ":" + (minutes % 60).ToString("00", System.Globalization.CultureInfo.InvariantCulture);
        }
        // The bonus a realm's guardian grants, as a word.
        public static string BonusName(byte bonus) => bonus == 1 ? "Hammer" : bonus == 3 ? "Wave" : "Totem";
        public static string BonusIcon(byte bonus, bool charged) => bonus == 1
            ? charged ? SkinSlots.IconHammer : SkinSlots.IconHammerEmpty
            : bonus == 3 ? charged ? SkinSlots.IconWave : SkinSlots.IconWaveEmpty
            : charged ? SkinSlots.IconTotem : SkinSlots.IconTotemEmpty;

        // A caption line advances 13 dp at 12 dp, as drawn; a bubble's 1.25 em.
        public const float CaptionLeading = 13f / 12;
        // The moves tablet's hourglass takes its top 36 dp; the numeral centres under it.
        public const float MovesIconDp = 36;
        public const float BubbleLeading = 1.25f;
        // A Campaign level, from its points target: the core's ladder rises with
        // the level, so the target names it. Zero for a Daily.
        public static byte CampaignLevel(BoardSession session) =>
            session == null || session.Daily ? (byte)0 : (byte)(Array.IndexOf(Protocol.CampaignTargets, (ushort)session.Rules.PointsRequired) + 1);

        // The guardian's level, the last of its realm: a boss level.
        public static bool BossLevel(BoardSession session) => CampaignLevel(session) == Protocol.CampaignTargets.Length;

        public static HudLayout Build(SkinUi ui, RunSummary state, BoardSession session, Rect safe, float density, Rect? screen = null)
        {
            var result = new HudLayout { Scale = ui.Scale, Campaign = session == null || !session.Daily };
            var plain = new BoardLayout(safe, density);
            bool compact = plain.Compact;
            float d = plain.Density, s = ui.Scale;
            var drawing = screen ?? safe;
            result.Screen = drawing;
            float inset = Mathf.Max(0, drawing.yMax - safe.yMax) / d;
            float H(string value, float width, float size, SkinUi.Type type) => ui.TextHeight(value, width, size, type) / d;
            float W(string value, float size, SkinUi.Type type) => ui.TextWidth(value, size, type) / d;

            // The earning caption decides the Earn panel's height; the row scales with the width alone.
            var rule = state == null || session == null ? null : ui.Art.Guardian(state.BonusType, session.Rules.Trigger, session.Rules.TriggerThreshold);
            float row = plain.RowScale, captionWidth = 76 * row;
            float earn = Mathf.Max(50 * row, 12 * row + H(rule?.description ?? "", captionWidth * d, EarnCaptionPt(compact), SkinUi.Type.Caption));
            // NEXT ROW sits in the gap between the frame and the tray, which grows with larger text.
            float labelPt = compact ? 10 : 11, label = H("NEXT ROW", plain.Frame.width, labelPt, SkinUi.Type.Label);

            // The board comes first: its cells take the width, and the header gets
            // the height they leave. The plates scale between HeaderFloorK of their
            // drawn size and 1, the guardian from 72 dp up to GuardianMaxDp; any
            // height past that opens above the header, over the painting. A
            // compact screen lets its plates shrink to CompactFloorK, which keeps
            // a 360 x 640 phone's cells at MinCompactCellDp.
            float gap = compact ? 4 : 6, rail = ui.Art.GuardianRailY - CrownOverGuardian;
            float below = new BoardLayout(safe, density, 1, earn * d, label * d).BelowHeader / d;
            float Leaves(float cell) => safe.height / d - below - 11 * cell - 2;
            float Stack(float scale) => 3 * 46 * scale + 2 * gap + 2;
            float CrownDp(float scale) => result.Campaign ? 1.34f * StarDp * scale : (58 + BestAboveDp) * scale;
            float widestCell = BoardLayout.WidestCellDp(safe.width / d);
            float floorK = compact ? CompactFloorK : HeaderFloorK;
            float header = Mathf.Max(Leaves(widestCell), Stack(floorK));
            // The guardian comes before the plates: they take their drawn size only
            // where the guardian still stands GuardianFullDp wide beside them, and
            // otherwise their floor (HeaderFloorK wherever the header holds that
            // stack). The guardian then takes what the header leaves under the
            // crown, as wide as the space between the tablet and the plates allows.
            float plateFloor = Mathf.Clamp((header - 2 - 2 * gap) / (3 * 46), floorK, HeaderFloorK);
            float k = (header - 2 - CrownDp(1)) / rail >= GuardianFullDp && header >= Stack(1) ? 1 : plateFloor;
            float guardianDp = Mathf.Clamp((header - 2 - CrownDp(k)) / rail, 72, GuardianMaxDp);
            result.K = k;

            result.CountPt = Mathf.Max(18 * k, 14); result.MovesPt = 52 * k; result.LevelPt = 19; result.ScorePt = 38 * k;
            result.ChipPt = Mathf.Max(11 * k, 9); result.EarnPt = EarnCaptionPt(compact); result.LabelPt = labelPt; result.StatusPt = 12;
            result.BubblePt = 13; result.BubbleCountPt = 16;

            // Plates: one width for the three, wide enough for the widest count.
            // Counts stop at their targets, so the widest is the larger target over itself.
            // A Daily plate holds a running count or the time left, never a target.
            uint target = session == null ? 99 : Math.Max(session.Daily ? 0 : session.Rules.PointsRequired, session.Rules.PrimaryCount);
            float countWidth = W(result.Campaign ? target + "/" + target : "88:88", result.CountPt, SkinUi.Type.Display) + 2;
            float plateWidth = Mathf.Max(104 * k, 7 * k + PlateLayout.IconDp * k + PlateLayout.GapDp * k + countWidth + 7 * k);
            float countHeight = H("0/0", plateWidth * d, result.CountPt, SkinUi.Type.Display);
            result.BarDp = compact ? 4 : 6;
            float plate = Mathf.Max(46 * k, 6 * k + countHeight + 2 * k + result.BarDp + 4 * k);
            float stack = 3 * plate + 2 * gap;
            // The numeral steps down only where the run's whole move budget would
            // not fit the drawn tablet (a Daily's 100 at larger text).
            string budget = session == null ? "88" : session.Rules.MaxMoves.ToString(System.Globalization.CultureInfo.InvariantCulture);
            float movesWidth = 104 * k;
            result.MovesPt *= Mathf.Min(1, (movesWidth - 12 * k) / W(budget, result.MovesPt, SkinUi.Type.Display));
            float moves = Mathf.Max(112 * k, MovesIconDp * k + H(budget, movesWidth * d, result.MovesPt, SkinUi.Type.Display) + 2 * k);
            float movesBelow = compact ? 28 * k : 18;

            // Everything above the board stands on the frame: the plates and the
            // tablet end at it, the guardian leans on it and the crown sits over
            // the guardian's head. The frame lowers only when a measured column
            // (larger text) needs more than the header, or when wide plates
            // would reach under the crown.
            float star = StarDp * k;
            float score = Mathf.Max(58 * k, 8 * k + H("0", 126 * k * d, result.ScorePt, SkinUi.Type.Display));
            float crownHeight = result.Campaign ? 1.34f * star : BestAboveDp * k + score;
            // The Daily's score plate is sized to its content: the pictogram, the
            // gap and the widest score (the best, or a score one digit past it).
            ulong bestScore = session?.DailyFacts?.Best ?? 0;
            string widestScore = Math.Max(bestScore * 10 + 9, 9999).ToString("N0", System.Globalization.CultureInfo.InvariantCulture);
            float scoreInset = (score - ScoreIconDp * k) / 2;
            float scoreWidth = Mathf.Max(188 * k, 2 * scoreInset + ScoreIconDp * k + PlateLayout.GapDp * k + W(widestScore, result.ScorePt, SkinUi.Type.Display) + 2);
            float crownHalf = result.Campaign ? 1.5f * star + .28f * star + .18f * star : scoreWidth / 2;
            float plateRight = safe.xMax - 8 * d;
            // Its figure stays between the tablet and the plates.
            float between = Mathf.Min(safe.center.x - (safe.x + 8 * d + movesWidth * d), plateRight - plateWidth * d - safe.center.x) / d - 2;
            guardianDp = Mathf.Max(72, Mathf.Min(guardianDp, 2 * between / (1 - 2 * GuardianSideMargin)));
            bool underCrown = plateRight - plateWidth * d < safe.center.x + crownHalf * d;
            float column = Mathf.Max(crownHeight + rail * guardianDp, underCrown ? crownHeight + gap + stack : 0);
            float room = inset + 2;
            float rim = Mathf.Max(inset + header, room + Mathf.Max(column, Mathf.Max(stack, moves + movesBelow)));
            float crownTop = rim - column;
            // The level medal stands over the moves tablet where the header leaves it room.
            float medalTop = rim - movesBelow - moves - gap - 46;
            bool medal = !compact && result.Campaign && medalTop >= room;
            float top = drawing.yMax;
            float Y(float dpFromTop) => top - dpFromTop * d;

            result.Layout = new BoardLayout(safe, density, (rim - inset) * d, earn * d, label * d);
            var layout = result.Layout;
            float cx = layout.Rim.center.x;

            // The guardian leans on the frame's edge: its rail line 1 dp below the top.
            float guardian = guardianDp * d;
            result.Guardian = new Rect(cx - guardian / 2, layout.Rim.yMax - 1 * d - (1 - ui.Art.GuardianRailY) * guardian, guardian, guardian);

            float starTop = crownTop + .1f * star;
            if (result.Campaign)
            {
                // Three sockets, the side ones 14% lower, on a pill 34% taller than a socket.
                float gapStar = star * .28f;
                result.Crown = new Rect(cx - crownHalf * d, Y(crownTop + crownHeight), 2 * crownHalf * d, crownHeight * d);
                for (int i = 0; i < 3; i++)
                {
                    float x = cx + ((i - 1) * (star + gapStar) - star / 2) * d, y = starTop + (i == 1 ? 0 : .14f * star);
                    result.Sockets[i] = new Rect(x, Y(y + star), star * d, star * d);
                }
                if (medal) result.Medal = new Rect(safe.x + 16 * d, Y(medalTop + 46), 46 * d, 46 * d);
            }
            else
            {
                // The score plate, with the best badge over its number: centred on
                // the value and straddling the plate's top edge.
                result.Crown = new Rect(cx - crownHalf * d, Y(crownTop + crownHeight), 2 * crownHalf * d, score * d);
                string widest = (bestScore * 10 + 9).ToString("N0", System.Globalization.CultureInfo.InvariantCulture);
                float badge = Mathf.Max(BestDp * k, H("0", 100 * d, result.ChipPt + 2, SkinUi.Type.Display));
                float width = badge - 4 + W(widest, result.ChipPt + 2, SkinUi.Type.Display) + 12;
                var value = PlateLayout.Row(result.Crown, k * d, ScoreIconDp).Value;
                result.Best = new Rect(Mathf.Min(value.center.x - width * d / 2, result.Crown.xMax - width * d), Y(crownTop + badge), width * d, badge * d);
            }
            for (int i = 0; i < 3; i++)
                result.Plates[i] = new Rect(plateRight - plateWidth * d, Y(rim - stack + i * (plate + gap) + plate), plateWidth * d, plate * d);
            result.Moves = new Rect(safe.x + 8 * d, Y(rim - movesBelow), movesWidth * d, moves * d);

            // NEXT ROW, centred in the gap between the frame and the tray.
            float labelHeight = label * d, gapBelow = layout.Rim.y - layout.Tray.yMax;
            result.NextLabel = new Rect(layout.Rim.x, layout.Tray.yMax + (gapBelow - labelHeight) / 2, layout.Rim.width, labelHeight);

            // Notices float as a toast on the board's top edge instead of taking a row.
            var board = layout.Board;
            float statusHeight = 0;
            foreach (string notice in BoardNotices.All())
                statusHeight = Mathf.Max(statusHeight, H(notice, board.width - 24 * d, result.StatusPt, SkinUi.Type.Body) * d);
            result.Status = new Rect(board.x + 12 * d, board.yMax - statusHeight - 14 * d, board.width - 24 * d, statusHeight + 10 * d);
            return result;
        }
    }
}
