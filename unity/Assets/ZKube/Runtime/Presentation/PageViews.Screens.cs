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
        // The column and its pieces, on this page: a tab page's column ends 10u above its tab bar.
        private ScreenKit Kit
        {
            get
            {
                var kit = new ScreenKit(ui, shell.Page, shell.ScreenArea, shell.SafeArea);
                return selectedTab >= 0 ? new ScreenKit(ui, shell.Page, shell.ScreenArea, shell.SafeArea, tabBar.yMax + 10 * kit.U) : kit;
            }
        }
        private float K => Kit.K;
        private float U => Kit.U;
        private float Step(float seeker, float compact) => Kit.Step(seeker, compact);
        private void Compose(params Piece[] pieces)
        {
            if (pageNotices.Length != 0)
            {
                var list = pieces.ToList();
                list.Insert(list.FindLastIndex(piece => piece.Height < 0) + 1, Notices(Kit));
                pieces = list.ToArray(); pageNotices = Array.Empty<string>();
            }
            var used = Kit.Compose(pieces);
            column = new PageColumn(ui, shell.Page, actions, used.x, used.width, used.y);
        }
        private Piece Buttons(params (PageAction action, ScreenKit.Kind kind, string icon)[] items) => Buttons(Kit, items);
        // The buttons across kit's column: the screen's, or a card's inside.
        private Piece Buttons(ScreenKit kit, params (PageAction action, ScreenKit.Kind kind, string icon)[] items)
        {
            items = items.Where(item => item.action != null).ToArray();
            return kit.Buttons(items.Select(item => (item.action.Name ?? item.action.Label, item.action.Label, actions.Click(item.action), item.kind, item.icon))
                .ToArray(), (i, button, text) => actions.Bind(button, items[i].action, relabel: value => text.text = value), shorter: items.Select(item => item.action.Short).ToArray());
        }
        // The owner (2026-10-03): on a level's preview and every result the
        // guardian is the hero, growing into the screen's free room up to this.
        private const float HeroGuardianU = 260;
        // Its title plate stays narrower than the guardian as it will draw:
        // the screen is measured with the plain title, then titled within 90%
        // of the guardian's width. A compact phone keeps the column.
        private Piece[] HeroTitled(List<Piece> pieces, Func<float?, Piece> title, float guardianU)
        {
            int at = pieces.FindIndex(piece => piece.Height >= 0), hero = pieces.FindIndex(piece => piece.Stretch > 0);
            pieces[at] = title(null);
            if (hero >= 0 && Kit.Step(1, 0) != 0)
                pieces[at] = title(.9f * Kit.HeroWidth(guardianU, pieces[hero], Kit.Spare(pieces.ToArray())));
            return pieces.ToArray();
        }
        private static byte RealmBonus(byte realm) => (byte)Protocol.Realms.Single(value => value.MapId == realm).GuardianAndHeight[0];
        // A tag (.tag): its words in the caption face at 11u on a pill of its
        // token's light, padded 2u by 8u. "New best!" is the gold one.
        private ScreenKit.Side NewBest(ScreenKit kit) => Tag(kit, "New best!", new Color(1, 233 / 255f, 168 / 255f, 1), "New best");
        private ScreenKit.Side Tag(ScreenKit kit, string text, string token, string name = null) => Tag(kit, text, ui.Art.Token(token), name ?? text);
        private ScreenKit.Side Tag(ScreenKit kit, string text, Color fill, string name)
        {
            float u = kit.U, size = Mathf.Max(11, 11 * kit.K);
            float w = ui.TextWidth(text, size, SkinUi.Type.Caption) + 16 * u, h = ui.TextHeight(text, w, size, SkinUi.Type.Caption) + 2 * u;
            return new ScreenKit.Side(w, h, rect => {
                ui.Pill(name + " tag", rect, shell.Page, fill);
                ui.Label(name, text, rect, size, SkinTokens.TextOnPrimary, shell.Page, SkinUi.Type.Caption).textWrappingMode = TextWrappingModes.NoWrap;
            });
        }

        // A level's preview over its map, as the wireframe draws it: the title
        // and realm, the empty crown, the guardian speaking its line over the
        // card of goals (each with its caption and target) and the row of the
        // moves and the guardian's rule, then Play, and the close in the corner.
        private void LevelScreen(LevelPageView value)
        {
            var kit = Kit; float d = ui.Density, u = kit.U, k = kit.K;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Map), scrim: true);
            byte bonus = RealmBonus(value.Realm);
            var goals = ScreenKit.Goals(catalog, value.Goals, bonus);
            var rule = catalog.Rule(value.Realm);
            var inside = kit.Inside();
            // The moves chip, then the trigger pictogram, an arrow, the bonus icon and the rule's words.
            var lead = new List<ScreenKit.Side> { inside.Chip("Level moves", SkinSlots.IconHourglass, 22, value.Moves.ToString(CultureInfo.InvariantCulture), "moves") };
            if (rule.pictogram != null) lead.Add(inside.Pictogram("Level rule trigger", rule.pictogram, rule.chip, 30));
            lead.Add(inside.Word("Level rule arrow", "→", 16 * k, SkinTokens.TextMuted));
            lead.Add(inside.Icon("Level rule bonus", HudLayout.BonusIcon(bonus, true), 30));
            var rows = inside.GoalRows(goals, ScreenKit.GoalMode.Target, Step(40, 34)).Append(inside.Row("Level rule", inside.Beside(10, lead.ToArray()),
                rule.description, "Earns a " + HudLayout.BonusName(bonus), null, true));
            var sockets = new Image[3];
            var line = LevelLine(realm.guardianLines, value.Level).Line;
            var pieces = new List<Piece> { Piece.Grow, default,
                kit.Crown(new bool[3], Step(38, 30), sockets), kit.GuardianCard("talk-open", line, Step(170, 118), kit.Card(null, rows), HeroGuardianU) };
            pieces.Add(Piece.Grow);
            pieces.Add(Buttons(kit, (value.Play, ScreenKit.Kind.Primary, SkinSlots.IconPlay)));
            Compose(HeroTitled(pieces, room => kit.Title("Level " + Number(value.Realm, value.Level), realm.realmName + " · " + realm.guardianName, room: room, sizeDp: kit.HeroTitleDp),
                Step(170, 118)));
            // The close (.x3): 40u (48 dp at least), 12u in from the right, hanging from the page's edge.
            if (value.Back != null)
            {
                float size = kit.Touch(40);
                HeaderButton(value.Back, new Rect(shell.SafeArea.xMax - 12 * u - size, kit.Edge - size, size, size), SkinSlots.IconClose, false);
            }
        }

        // What a Campaign result says, from how the run ended and the stars it
        // kept: the title and its icon, and whether the line under it is good
        // news or a warning.
        public static (string Title, string Subtitle, string Icon, bool Good) ResultWords(ResultPageView value)
        {
            int stars = HudLayout.StarCount(value.StarSources);
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
        // kept stars (filling in place, left to right), the guardian's line, the
        // goal rows with their final counts and ticks, "New best!" and the
        // actions by outcome. There is no Share on Campaign.
        private void CampaignScreen(ResultPageView value)
        {
            var kit = Kit; float d = ui.Density, u = kit.U;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), scrim: true);
            int stars = HudLayout.StarCount(value.StarSources);
            var (title, subtitle, icon, good) = ResultWords(value);
            bool cleared = value.EndReason == 1;
            // Kept stars speak their star line (the guardian falls on its own level);
            // an ended or starless run hears that the tide returns.
            var talk = TalkPage.For(realm.guardianLines, value.EndReason == 3 || stars == 0 ? TalkMoment.Ended
                : cleared && value.Level == Protocol.CampaignTargets.Length ? TalkMoment.GuardianDefeated : TalkMoment.Win, stars);
            string frame = stars == 3 ? "celebrate" : stars == 0 ? "defeated" : "satisfied";
            // Each goal row ticks for its own goal; the crown fills left to right.
            var met = new[] { (value.StarSources & 1) != 0, (value.StarSources & 2) != 0, (value.StarSources & 4) != 0 };
            var lit = new[] { stars > 0, stars > 1, stars > 2 };
            var goals = value.Goals == null ? Array.Empty<ScreenKit.GoalLine>() : ScreenKit.Goals(catalog, value.Goals, RealmBonus(value.Realm));
            if (goals.Length == 3)
            {
                goals[0].Progress = (uint)Math.Min(value.Score, uint.MaxValue);
                goals[1].Progress = value.PrimaryProgress;
            }
            // As on the HUD, a met goal reads at least its target.
            for (int i = 0; i < goals.Length; i++) { goals[i].Met = met[i]; if (met[i]) goals[i].Progress = Math.Max(goals[i].Progress, goals[i].Target); }
            var sockets = new Image[3];
            var inside = kit.Inside();
            var rows = inside.GoalRows(goals, ScreenKit.GoalMode.Result, Step(38, 32)).ToList();
            if (value.NewBest)
            {
                // The tag's line is 26u, 2u under the rows.
                var best = NewBest(inside);
                rows.Add(new Piece(26 * u, rect => best.Draw(new Rect(rect.center.x - best.Width / 2, rect.y + (24 * u - best.Height) / 2, best.Width, best.Height))));
            }
            var first = stars > 0 ? value.Done : value.Retry; var second = stars == 3 ? null : stars > 0 ? value.Retry : value.Done;
            var buttons = Buttons(kit, (first, ScreenKit.Kind.Primary, stars > 0 ? SkinSlots.IconPlay : SkinSlots.IconRetry),
                (second, ScreenKit.Kind.Secondary, second == value.Retry ? SkinSlots.IconRetry : SkinSlots.IconMap));
            RectTransform finish = null;
            Compose(HeroTitled(new List<Piece> { Piece.Grow, default,
                kit.Crown(lit, Step(54, 40), sockets),
                kit.GuardianCard(frame, talk.Line, Step(156, 112), kit.Card(null, rows), HeroGuardianU),
                Piece.Grow,
                new Piece(buttons.Height, rect => finish = Group("Result actions", shell.Page, () => buttons.Draw(rect))) },
                room => kit.Title(title, subtitle, good ? SkinTokens.Positive : SkinTokens.Negative, icon, room, kit.HeroTitleDp), Step(156, 112)));
            if (!reducedMotion) Fill(stars, sockets, finish);
        }

        // The result's entrance: the kept stars fill in place in their sockets,
        // left to right, each with a pop, 450 ms apart (faster when the level was
        // not cleared); the actions arrive last. A tap anywhere jumps to the end.
        // Reduced motion shows them filled at once.
        private void Fill(int stars, Image[] sockets, RectTransform finish)
        {
            float pace = stars == 3 ? 1 : .6f, apart = .45f * pace, start = .3f * pace;
            var sequence = finish.parent.gameObject.AddComponent<PageSequence>();
            for (int i = 0; i < stars; i++)
            {
                var socket = sockets[i]; float begin = start + i * apart; var at = socket.rectTransform.anchoredPosition; var center = SkinUi.ScreenRect(socket.rectTransform).center;
                socket.sprite = ui.Art.SkinUi(SkinSlots.StarSocket);
                sequence.Add(begin, .4f, t => {
                    socket.sprite = ui.Art.SkinUi(t > 0 ? SkinSlots.StarLit : SkinSlots.StarSocket);
                    PageSequence.ScaleAbout(socket.rectTransform, at, center, t == 0 ? 1 : PageSequence.Ignite(t));
                });
            }
            var group = finish.GetComponent<CanvasGroup>();
            sequence.Add(start + stars * apart + .2f, .2f, t => { group.alpha = t; group.interactable = group.blocksRaycasts = t >= 1; });
            var skip = ui.Rect<Image>("Skip", shell.ScreenArea, shell.Overlay); skip.color = Color.clear; skip.raycastTarget = true;
            skip.gameObject.AddComponent<Button>().onClick.AddListener(sequence.Finish);
            sequence.Finished += () => { if (skip != null) { skip.gameObject.SetActive(false); Destroy(skip.gameObject); } };
        }

        // The Daily's result, as the wireframe draws it: the day's title, the
        // score on its plate (with "New best!"), the guardian's line over the
        // card of the run's rows, and Continue with Share. Realms lists the
        // multiplier reached, the objective count and the streak, then when the
        // next Daily opens; the Arcade names the two boards the run counts on.
        private TMP_Text nextDailyResult;
        private void DailyResultScreen(ResultPageView value)
        {
            var kit = Kit; float u = kit.U, k = kit.K;
            var realm = catalog.Realm(value.Realm);
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), scrim: true);
            var line = TalkPage.For(realm.guardianLines, value.Speaks ?? TalkMoment.Daily, value.SpeaksStars);
            string objective = value.ObjectiveKind == 0 ? null : catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            var goal = value.ObjectiveKind == 0 ? null : catalog.Goal(value.ObjectiveKind, value.ObjectiveValue);
            string picture = goal?.Pictogram(RealmBonus(value.Realm));
            string N(ulong number) => number.ToString("N0", CultureInfo.InvariantCulture);
            var inside = kit.Inside();
            var rows = new List<Piece>();
            if (value.Arcade)
            {
                rows.Add(inside.Row("Score board", inside.Pictogram("Score board", SkinSlots.GoalScore, null, 34), "Score board", "Your best run counts",
                    inside.Value("Score board value", N(value.Score)), false));
                if (objective != null)
                    rows.Add(inside.Row("Objective board", inside.Pictogram("Objective board", picture, goal.chip, 34), "Objective board", objective,
                        inside.Value("Objective board value", N(value.ObjectiveTotal)), true));
                const string boards = "Places are final when each board is sealed after the day closes at 07:00 UTC.";
                float size = inside.SmallDp, height = inside.Block(boards, inside.Width, size, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
                rows.Add(new Piece(height, rect => inside.Text("Boards note", boards, rect, size, SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading,
                    TextAlignmentOptions.Left)));
            }
            else
            {
                // The rows share one 36u icon column.
                if (value.Tier.HasValue)
                    rows.Add(inside.Row("Multiplier", inside.Multiplier("Multiplier", 36),
                        "Multiplier reached", null, inside.Value("Multiplier value", HudLayout.PressureValue(new RunSummary { CurrentTier = value.Tier.Value }), SkinTokens.Accent),
                        rows.Count > 0));
                if (objective != null)
                    rows.Add(inside.Row("Objective", inside.Pictogram("Objective", picture, goal.chip, 36), objective, null, inside.Value("Objective value", N(value.ObjectiveTotal)),
                        rows.Count > 0));
                if (value.Streak.HasValue)
                    rows.Add(inside.Row("Streak", inside.Column(inside.Icon("Streak icon", SkinSlots.IconCrown, 32), 36), "Daily streak", null, inside.Value("Streak value", Days(value.Streak.Value)),
                        rows.Count > 0));
            }
            // The score's plate (.card3 in a row): padded 6u by 16u, the spark, the 44u score and "New best!", 8u apart.
            string score = N(value.Score);
            float spark = Step(40, 32) * u, scoreDp = 44 * k, scoreWidth = ui.TextWidth(score, scoreDp, SkinUi.Type.Display);
            ScreenKit.Side? best = value.NewBest ? NewBest(kit) : (ScreenKit.Side?)null;
            float plateWidth = 32 * u + spark + 8 * u + scoreWidth + (best.HasValue ? 8 * u + best.Value.Width : 0);
            float plateHeight = 12 * u + Mathf.Max(spark, scoreDp * ui.Scale * ui.Density);
            var pieces = new List<Piece> { Piece.Grow,
                default,
                new Piece(plateHeight, rect => {
                    var plate = new Rect(rect.center.x - plateWidth / 2, rect.y, plateWidth, rect.height);
                    ui.Piece("Score plate", SkinSlots.Card, plate, shell.Page);
                    float x = plate.x + 16 * u;
                    ui.Pictogram("Score", SkinSlots.GoalScore, null, new Rect(x, plate.center.y - spark / 2, spark, spark), shell.Page);
                    x += spark + 8 * u;
                    var total = kit.Text("Score", score, new Rect(x, plate.y + 6 * u, scoreWidth + 2 * ui.Density, plate.height - 12 * u), scoreDp, SkinTokens.Score,
                        SkinUi.Type.Display, 1, TextAlignmentOptions.Left);
                    total.textWrappingMode = TextWrappingModes.NoWrap;
                    if (best.HasValue) best.Value.Draw(new Rect(x + scoreWidth + 8 * u, plate.center.y - best.Value.Height / 2, best.Value.Width, best.Value.Height));
                }),
                kit.GuardianCard(line.Mood == "surprised" || line.Mood == "celebrate" ? "satisfied" : line.Mood, line.Line, Step(156, 112), kit.Card(null, rows), HeroGuardianU) };
            if (!string.IsNullOrEmpty(value.Notice)) pieces.Add(kit.Note(value.Notice));
            if (value.NextOpensAt > 0 && value.Now != null)
            {
                var next = kit.Note(UsedLine(value.NextOpensAt - value.Now()));
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
            pieces.Add(Buttons(kit, (value.Done, ScreenKit.Kind.Primary, SkinSlots.IconPlay), (share, ScreenKit.Kind.Secondary, SkinSlots.IconShare),
                (value.Leaderboard, ScreenKit.Kind.Quiet, SkinSlots.IconTrophy)));
            Compose(HeroTitled(pieces, room => kit.Title(value.Arcade ? "Daily run complete" : "Daily complete", DayLabel(value.Day) + " · " + realm.realmName + " · " + realm.guardianName,
                room: room, sizeDp: kit.HeroTitleDp), Step(156, 112)));
        }
        private static string UsedLine(long seconds) => "Today’s attempt is used. Next Daily in " + DayClock(seconds) + ".";
    }
}
