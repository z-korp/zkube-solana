using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using Piece = ZKube.Presentation.ScreenKit.Piece;

namespace ZKube.Presentation
{
    // The composed screens around the board, drawn with the screen kit.
    public sealed partial class PageViews
    {
        // The column and its pieces, on this page: a tab page's column ends above its tab bar.
        private ScreenKit Kit => new ScreenKit(ui, shell.Page, shell.ScreenArea,
            selectedTab >= 0 ? Rect.MinMaxRect(shell.SafeArea.xMin, tabBar.yMax, shell.SafeArea.xMax, shell.SafeArea.yMax) : shell.SafeArea);
        private float K => Kit.K;
        private float U => Kit.U;
        private float Step(float seeker, float compact) => Kit.Step(seeker, compact);
        private void Compose(params Piece[] pieces)
        {
            var used = Kit.Compose(pieces);
            column = new PageColumn(ui, shell.Page, actions, used.x, used.width, used.y);
        }
        private Piece Buttons(params (PageAction action, bool primary, string icon)[] items)
        {
            items = items.Where(item => item.action != null).ToArray();
            return Kit.Buttons(items.Select(item => (item.action.Name ?? item.action.Label, item.action.Label, actions.Click(item.action), item.primary, item.icon))
                .ToArray(), (i, button, text) => actions.Bind(button, items[i].action, relabel: value => text.text = value));
        }
        private static byte RealmBonus(byte realm) => (byte)Protocol.Realms.Single(value => value.MapId == realm).GuardianAndHeight[0];

        // A level's preview over its map: the title and realm, the empty crown,
        // the guardian speaking its line over the card of goals (each with its
        // caption and target), the moves and the guardian's rule, and Play.
        private void LevelScreen(LevelPageView value, string[] notices)
        {
            float d = ui.Density, u = U, k = K;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Map), .45f);
            byte bonus = RealmBonus(value.Realm);
            var goals = ScreenKit.Goals(catalog, value.Goals, bonus);
            var rule = catalog.Rule(value.Realm);
            float iconU = Step(40, 34), inner = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * d) - 24 * u;
            string Target(ScreenKit.GoalLine goal) => goal.Counter == "ring" ? null : goal.Target.ToString("N0", CultureInfo.InvariantCulture);
            float RightWidth(ScreenKit.GoalLine goal) => Target(goal) == null ? 26 * u : Kit.NumeralWidth(Target(goal));
            var rowHeights = goals.Select(goal => Kit.RowHeight(goal.Caption, null, inner, iconU, RightWidth(goal))).ToArray();
            // The moves and the rule share the last row: the moves chip, then the
            // trigger pictogram, an arrow, the bonus icon and the rule's words.
            string moves = value.Moves.ToString(CultureInfo.InvariantCulture), earns = "Earns a " + HudLayout.BonusName(bonus);
            float chipWidth = 22 * u + ui.TextWidth(moves, 16 * k, SkinUi.Type.Display) + ui.TextWidth(" moves", Mathf.Max(12, 13 * k), SkinUi.Type.Caption) + 22 * u;
            float ruleLead = chipWidth + 12 * u + 30 * u + 20 * u + 30 * u + 10 * u;
            float ruleHeight = Mathf.Max(50 * u, ui.TextHeight(rule.description, inner - ruleLead, Mathf.Max(13, 15 * k), SkinUi.Type.Caption)
                + ui.TextHeight(earns, inner - ruleLead, 12, SkinUi.Type.Caption) + 8 * u);
            float cardHeight = rowHeights.Sum() + ruleHeight + 20 * u;
            var sockets = new Image[3];
            var line = LevelLine(realm.guardianLines, value.Level).Line;
            var pieces = new List<Piece> { Piece.Grow, Kit.TitlePlate("Level " + Number(value.Realm, value.Level), realm.realmName + " · " + realm.guardianName),
                Kit.Crown(new bool[3], Step(38, 30), sockets),
                Kit.GuardianCard("talk-open", line, Step(170, 118), cardHeight, card => {
                    float y = card.yMax - 10 * u, x = card.x + 12 * u, width = card.width - 24 * u;
                    for (int i = 0; i < goals.Length; i++)
                    {
                        var goal = goals[i]; var row = new Rect(x, y - rowHeights[i], width, rowHeights[i]);
                        Kit.Row(goal.Name, row, goal.Pictogram, iconU, goal.Caption, null, RightWidth(goal), i > 0);
                        if (Target(goal) != null) Kit.Numeral(goal.Name, Target(goal), new Rect(row.xMax - RightWidth(goal), row.y, RightWidth(goal), row.height));
                        else ui.Piece(goal.Name + " ring", SkinSlots.CounterRing, new Rect(row.xMax - 26 * u, row.center.y - 13 * u, 26 * u, 26 * u), shell.Page);
                        y -= rowHeights[i];
                    }
                    var last = new Rect(x, y - ruleHeight, width, ruleHeight);
                    Kit.Rule("Level rule rule", last);
                    var chip = new Rect(last.x, last.center.y - 16 * u, chipWidth, 32 * u);
                    ui.Pill("Level moves chip", chip, shell.Page, new Color(11 / 255f, 20 / 255f, 28 / 255f, 1));
                    ui.Piece("Level moves icon", SkinSlots.IconHourglass, new Rect(chip.x + 6 * u, chip.center.y - 10 * u, 20 * u, 20 * u), shell.Page);
                    var count = ui.Label("Level moves", moves + "<size=" + Mathf.RoundToInt(100 * Mathf.Max(12, 13 * k) / (16 * k)) + "%> moves</size>",
                        new Rect(chip.x + 28 * u, chip.y, chip.width - 32 * u, chip.height), 16 * k, SkinTokens.Text, shell.Page, SkinUi.Type.Display,
                        TextAlignmentOptions.Left);
                    count.richText = true; count.textWrappingMode = TextWrappingModes.NoWrap;
                    float rx = chip.xMax + 12 * u;
                    if (rule.pictogram != null) ui.Piece("Level rule trigger", rule.pictogram, new Rect(rx, last.center.y - 15 * u, 30 * u, 30 * u), shell.Page);
                    ui.Label("Level rule arrow", "→", new Rect(rx + 30 * u, last.center.y - 15 * u, 20 * u, 30 * u), 16 * k, SkinTokens.TextMuted,
                        shell.Page, SkinUi.Type.Display);
                    ui.Piece("Level rule bonus", HudLayout.BonusIcon(bonus, true), new Rect(rx + 50 * u, last.center.y - 15 * u, 30 * u, 30 * u), shell.Page);
                    var words = new Rect(rx + 90 * u, last.y, last.xMax - rx - 90 * u, last.height);
                    Kit.Row("Level rule", words, null, 0, rule.description, earns, 0, false);
                }) };
            foreach (var notice in notices.Concat(string.IsNullOrEmpty(value.Notice) ? Array.Empty<string>() : new[] { value.Notice }))
                pieces.Add(Kit.Note(notice));
            pieces.Add(Piece.Grow);
            pieces.Add(Buttons((value.Play, true, SkinSlots.IconPlay)));
            Compose(pieces.ToArray());
            if (value.Back != null)
            {
                float size = IconDp * d;
                HeaderButton(value.Back, new Rect(shell.SafeArea.xMax - 12 * u - size, shell.SafeArea.yMax - 4 * d - size, size, size), SkinSlots.IconClose, false);
            }
        }

        // What a Campaign result says, from how the run ended and the stars it
        // kept: the title and its icon, and whether the line under it is good
        // news or a warning.
        public static (string Title, string Subtitle, string Icon, bool Good) ResultWords(ResultPageView value)
        {
            int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
            bool last = value.Realm == Protocol.Realms.Length && value.Level == Protocol.CampaignTargets.Length;
            string next = last ? null : "Level " + HudLayout.LevelNumber(value.Realm, (byte)(value.Level + 1));
            string kept = stars == 0 ? "No stars kept" : stars + (stars == 1 ? " star" : " stars") + " kept";
            string opened = next == null ? null : stars > 0 ? next + " is open" : value.NextOpen == false ? "earn one to open " + next : null;
            string Kept() => opened == null ? kept : kept + " · " + opened;
            if (value.EndReason == 1) return ("Level cleared!", next == null ? "Every level is cleared" : next + " is open", null, true);
            if (value.EndReason == 3) return ("Run ended", "An ended run keeps no stars.", SkinSlots.IconFlag, false);
            return value.MovesLeft == 0 ? ("Out of moves", Kept(), SkinSlots.IconHourglassEmpty, stars > 0)
                : ("Board full", Kept(), SkinSlots.IconBoardFull, stars > 0);
        }

        // A Campaign result: the title from the end reason, the crown with the
        // kept stars (each rising from its goal's row), the guardian's line, the
        // goal rows with their final counts and ticks, "New best!" and the
        // actions by outcome. There is no Share on Campaign.
        private void CampaignScreen(ResultPageView value)
        {
            float d = ui.Density, u = U;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .55f);
            int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
            var (title, subtitle, icon, good) = ResultWords(value);
            bool cleared = value.EndReason == 1;
            // Kept stars speak their star line (the guardian falls on its own level);
            // an ended or starless run hears that the tide returns.
            var talk = TalkPage.For(realm.guardianLines, value.EndReason == 3 || stars == 0 ? TalkMoment.Ended
                : cleared && value.Level == Protocol.CampaignTargets.Length ? TalkMoment.GuardianDefeated : TalkMoment.Win, stars);
            string frame = stars == 3 ? "celebrate" : stars == 0 ? "defeated" : "satisfied";
            var lit = new[] { (value.StarSources & 1) != 0, (value.StarSources & 2) != 0, (value.StarSources & 4) != 0 };
            var goals = value.Goals == null ? Array.Empty<ScreenKit.GoalLine>() : ScreenKit.Goals(catalog, value.Goals, RealmBonus(value.Realm));
            if (goals.Length == 3)
            {
                goals[0].Progress = (uint)Math.Min(value.Score, uint.MaxValue);
                goals[1].Progress = value.PrimaryProgress;
            }
            // As on the HUD, a met goal reads at least its target.
            for (int i = 0; i < goals.Length; i++) { goals[i].Met = lit[i]; if (lit[i]) goals[i].Progress = Math.Max(goals[i].Progress, goals[i].Target); }
            float iconU = Step(38, 32), inner = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * d) - 24 * u, tick = 24 * u;
            float RightWidth(ScreenKit.GoalLine goal) => goal.Counter == "fill" ? Kit.CountWidth(goal) + 6 * u + tick : 28 * u;
            var rowHeights = goals.Select(goal => Kit.RowHeight(goal.Caption, null, inner, iconU, RightWidth(goal))).ToArray();
            float bestHeight = value.NewBest ? 26 * u + 4 * u : 0, cardHeight = rowHeights.Sum() + bestHeight + 20 * u;
            var sockets = new Image[3]; var rowIcons = new Image[3];
            var first = stars > 0 ? value.Done : value.Retry; var second = stars == 3 ? null : stars > 0 ? value.Retry : value.Done;
            RectTransform finish = null;
            Compose(Piece.Grow, Kit.TitlePlate(title, subtitle, good ? SkinTokens.Positive : SkinTokens.Negative, icon),
                Kit.Crown(lit, Step(54, 40), sockets),
                Kit.GuardianCard(frame, talk.Line, Step(156, 112), cardHeight, card => {
                    float y = card.yMax - 10 * u, x = card.x + 12 * u, width = card.width - 24 * u;
                    for (int i = 0; i < goals.Length; i++)
                    {
                        var goal = goals[i]; var row = new Rect(x, y - rowHeights[i], width, rowHeights[i]);
                        rowIcons[i] = Kit.Row(goal.Name, row, goal.Pictogram, iconU, goal.Caption, null, RightWidth(goal), i > 0);
                        if (goal.Counter == "fill")
                        {
                            Kit.Numeral(goal.Name, Kit.Count(goal), new Rect(row.xMax - RightWidth(goal), row.y, RightWidth(goal) - tick - 6 * u, row.height),
                                goal.Met ? SkinTokens.Accent : SkinTokens.Score);
                            if (goal.Met) ui.Piece(goal.Name + " tick", SkinSlots.Tick, new Rect(row.xMax - tick, row.center.y - tick / 2, tick, tick), shell.Page);
                        }
                        else ui.Piece(goal.Name + (goal.Met ? " tick" : " ring"), goal.Met ? SkinSlots.Tick : SkinSlots.CounterRing,
                            new Rect(row.xMax - 26 * u, row.center.y - 13 * u, 26 * u, 26 * u), shell.Page);
                        y -= rowHeights[i];
                    }
                    if (value.NewBest)
                    {
                        float width2 = ui.TextWidth("New best!", 13, SkinUi.Type.Display) + 24 * u;
                        var tag = new Rect(card.center.x - width2 / 2, y - 4 * u - 26 * u, width2, 26 * u);
                        ui.Pill("New best", tag, shell.Page, new Color(1, 233 / 255f, 168 / 255f, 1));
                        ui.Label("New best label", "New best!", tag, 13, SkinTokens.TextOnPrimary, shell.Page, SkinUi.Type.Display);
                    }
                }),
                Piece.Grow,
                new Piece(62 * u, rect => finish = Group("Result actions", shell.Page, () =>
                    Buttons((first, true, stars > 0 ? SkinSlots.IconPlay : SkinSlots.IconRetry),
                        (second, false, second == value.Retry ? SkinSlots.IconRetry : SkinSlots.IconMap)).Draw(rect))));
            if (!string.IsNullOrEmpty(value.Notice))
            {
                var note = Kit.Note(value.Notice);
                note.Draw(new Rect(column.Left, SkinUi.ScreenRect(finish.GetComponentsInChildren<RectTransform>().Skip(1).First()).yMax + 8 * d, column.Width, note.Height));
            }
            if (!reducedMotion) Rise(lit, sockets, rowIcons, finish, stars == 3);
        }

        // The result's entrance: each kept star rises from its goal row to its
        // socket and ignites there, 450 ms apart (faster when the level was not
        // cleared); the actions arrive last. A tap anywhere jumps to the end.
        private void Rise(bool[] lit, Image[] sockets, Image[] rowIcons, RectTransform finish, bool cleared)
        {
            float pace = cleared ? 1 : .6f, flight = .45f * pace, apart = .45f * pace, start = .3f * pace;
            var sequence = finish.parent.gameObject.AddComponent<PageSequence>();
            int order = 0;
            for (int i = 0; i < 3; i++)
            {
                if (!lit[i] || rowIcons[i] == null) continue;
                var socket = sockets[i]; var to = SkinUi.ScreenRect(socket.rectTransform); var from = SkinUi.ScreenRect(rowIcons[i].rectTransform).center;
                var star = ui.Piece("Result star flight", SkinSlots.StarLit, to, shell.Page);
                var at = star.rectTransform.anchoredPosition; var socketAt = socket.rectTransform.anchoredPosition;
                float begin = start + order++ * apart;
                sequence.Add(begin, flight, t => {
                    float e = PageSequence.EaseOut(t);
                    var center = Vector2.Lerp(from, to.center, e) + Vector2.up * Mathf.Sin(Mathf.PI * t) * 30 * U;
                    star.rectTransform.anchoredPosition = at + (center - to.center);
                    star.enabled = t < 1; socket.sprite = ui.Art.SkinUi(t < 1 ? SkinSlots.StarSocket : SkinSlots.StarLit);
                });
                sequence.Add(begin + flight, .4f, t => PageSequence.ScaleAbout(socket.rectTransform, socketAt, to.center, t == 0 ? 1 : PageSequence.Ignite(t)));
            }
            var group = finish.GetComponent<CanvasGroup>();
            sequence.Add(start + order * apart + .2f, .2f, t => { group.alpha = t; group.interactable = group.blocksRaycasts = t >= 1; });
            var skip = ui.Rect<Image>("Skip", shell.ScreenArea, shell.Overlay); skip.color = Color.clear; skip.raycastTarget = true;
            skip.gameObject.AddComponent<Button>().onClick.AddListener(sequence.Finish);
            sequence.Finished += () => { if (skip != null) { skip.gameObject.SetActive(false); Destroy(skip.gameObject); } };
        }
        // The Daily's result, as the v3 composites draw it: the day's title,
        // the score on its plate (with "New best!"), the guardian's line over the
        // card of the run's rows, and Continue with Share. Realms lists the
        // multiplier reached, the objective count and the streak, then when the
        // next Daily opens; the Arcade names the two boards the run counts on.
        private TMP_Text nextDailyResult;
        private void DailyResultScreen(ResultPageView value)
        {
            float d = ui.Density, u = U, k = K;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .55f);
            var line = TalkPage.For(realm.guardianLines, value.Speaks ?? TalkMoment.Daily, value.SpeaksStars);
            string objective = value.ObjectiveKind == 0 ? null : catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            string picture = value.ObjectiveKind == 0 ? null : catalog.Goal(value.ObjectiveKind, value.ObjectiveValue).Pictogram(RealmBonus(value.Realm));
            string N(ulong number) => number.ToString("N0", CultureInfo.InvariantCulture);
            // Each row: its icon (and the icon's width in u), caption, detail and value.
            var rows = new List<(string name, string icon, float iconU, float iconTallU, string caption, string detail, string number, string token)>();
            if (value.Arcade)
            {
                rows.Add(("Score board", SkinSlots.GoalScore, 34, 34, "Score board", "Your best run counts", N(value.Score), SkinTokens.Score));
                if (objective != null) rows.Add(("Objective board", picture, 34, 34, "Objective board", objective, N(value.ObjectiveTotal), SkinTokens.Score));
            }
            else
            {
                if (value.Tier.HasValue)
                    rows.Add(("Multiplier", SkinSlots.MultiplierRing, 40, 16, "Multiplier reached", null,
                        HudLayout.PressureValue(new RunSummary { CurrentTier = value.Tier.Value }), SkinTokens.Accent));
                if (objective != null) rows.Add(("Objective", picture, 36, 36, objective, null, N(value.ObjectiveTotal), SkinTokens.Score));
                if (value.Streak.HasValue) rows.Add(("Streak", SkinSlots.IconCrown, 32, 32, "Daily streak", null, Days(value.Streak.Value), SkinTokens.Score));
            }
            float inner = Mathf.Min(shell.SafeArea.width - 24 * u, ColumnDp * d) - 24 * u;
            var heights = rows.Select(row => Kit.RowHeight(row.caption, row.detail, inner, row.iconU, Kit.NumeralWidth(row.number))).ToArray();
            string boards = value.Arcade ? "Places are final when each board is sealed after the day closes at 00:00 UTC." : null;
            float boardsHeight = boards == null ? 0 : ui.TextHeight(boards, inner, 12, SkinUi.Type.Caption) + 6 * u;
            float cardHeight = heights.Sum() + boardsHeight + 20 * u;
            // The score's plate: the spark, the score and "New best!".
            string score = N(value.Score);
            float spark = Step(40, 32) * u, scoreDp = 44 * k, tag = value.NewBest ? ui.TextWidth("New best!", 13, SkinUi.Type.Display) + 24 * u : 0;
            float scoreWidth = ui.TextWidth(score, scoreDp, SkinUi.Type.Display), scoreHeight = ui.TextHeight(score, scoreWidth * 2, scoreDp, SkinUi.Type.Display);
            var pieces = new List<Piece> { Piece.Grow,
                Kit.TitlePlate(value.Arcade ? "Daily run complete" : "Daily complete", DayLabel(value.Day) + " · " + realm.realmName + " · " + realm.guardianName),
                new Piece(Mathf.Max(spark, scoreHeight) + 12 * u, rect => {
                    float width = spark + 8 * u + scoreWidth + (tag > 0 ? 8 * u + tag : 0) + 32 * u;
                    var plate = new Rect(rect.center.x - width / 2, rect.y, width, rect.height);
                    ui.Piece("Score plate", SkinSlots.Card, plate, shell.Page);
                    float x = plate.x + 16 * u;
                    ui.Piece("Score icon", SkinSlots.GoalScore, new Rect(x, plate.center.y - spark / 2, spark, spark), shell.Page);
                    var total = ui.Label("Score", score, new Rect(x + spark + 8 * u, plate.y, scoreWidth + 2 * d, plate.height), scoreDp, SkinTokens.Score,
                        shell.Page, SkinUi.Type.Display, TextAlignmentOptions.Left);
                    total.textWrappingMode = TextWrappingModes.NoWrap;
                    if (tag > 0)
                    {
                        var chip = new Rect(x + spark + 16 * u + scoreWidth, plate.center.y - 13 * u, tag, 26 * u);
                        ui.Pill("New best", chip, shell.Page, new Color(1, 233 / 255f, 168 / 255f, 1));
                        ui.Label("New best label", "New best!", chip, 13, SkinTokens.TextOnPrimary, shell.Page, SkinUi.Type.Display);
                    }
                }),
                Kit.GuardianCard(line.Mood == "surprised" || line.Mood == "celebrate" ? "satisfied" : line.Mood, line.Line, Step(156, 112), cardHeight, card => {
                    float y = card.yMax - 10 * u, x = card.x + 12 * u, width = card.width - 24 * u;
                    for (int i = 0; i < rows.Count; i++)
                    {
                        var row = rows[i]; var rect = new Rect(x, y - heights[i], width, heights[i]);
                        var icon = Kit.Row(row.name, rect, row.icon, row.iconU, row.caption, row.detail, Kit.NumeralWidth(row.number), i > 0);
                        if (icon != null && row.iconTallU != row.iconU)
                            SkinUi.Place(icon.rectTransform, new Rect(rect.x, rect.center.y - row.iconTallU * u / 2, row.iconU * u, row.iconTallU * u), shell.Page);
                        Kit.Numeral(row.name + " value", row.number, new Rect(rect.xMax - Kit.NumeralWidth(row.number), rect.y, Kit.NumeralWidth(row.number), rect.height), row.token);
                        y -= heights[i];
                    }
                    if (boards != null)
                        ui.Label("Boards note", boards, new Rect(x, y - boardsHeight, width, boardsHeight), 12, SkinTokens.TextMuted, shell.Page,
                            SkinUi.Type.Caption, TextAlignmentOptions.Left);
                }) };
            if (!string.IsNullOrEmpty(value.Notice)) pieces.Add(Kit.Note(value.Notice));
            if (value.NextOpensAt > 0 && value.Now != null)
            {
                var next = Kit.Note(UsedLine(value.NextOpensAt - value.Now()));
                pieces.Add(new Piece(next.Height, rect => {
                    next.Draw(rect);
                    nextDailyResult = shell.Page.GetComponentsInChildren<TMP_Text>().Last(text => text.name == "Screen note");
                    countdownView = new DailyPageView { NextOpensAt = value.NextOpensAt, Now = value.Now }; countdownSecond = value.Now();
                }));
            }
            pieces.Add(Piece.Grow);
            PageAction share = null;
            if (value.Share != null)
                share = ShareAction(value, ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName, realm.realmName,
                    objective ?? "Score only", value.ObjectiveTotal, value.Score, value.Streak), "Share");
            pieces.Add(Buttons((value.Done, true, SkinSlots.IconPlay), (share, false, SkinSlots.IconShare)));
            Compose(pieces.ToArray());
        }
        private static string UsedLine(long seconds) => "Today’s attempt is used. Next Daily in " + DayClock(seconds) + ".";
    }
}
