using System;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The result pages: a Campaign run's result, the Daily result and the Daily
    // page before there is one.
    public sealed partial class PageViews
    {
        // A Campaign result: the guardian on the dialog's rail says how the run
        // went, then the headline, the stars the run keeps (the middle one
        // larger), the score and "New best!" when the level's best rose, and what
        // to do next. A cleared level continues; any other run retries.
        private void CampaignResult(ResultPageView value)
        {
            int stars = (value.StarSources & 1) + (value.StarSources >> 1 & 1) + (value.StarSources >> 2 & 1);
            bool cleared = value.EndReason == 1;
            string title = cleared ? "Level cleared!" : value.EndReason == 3 ? "Run ended" : value.MovesLeft == 0 ? "Out of moves" : "Board full";
            // What the core keeps by end reason: a run the player ends keeps no
            // stars; a run out of moves or on a full board keeps those it latched.
            // The guardian's line already says to try again.
            string summary = value.EndReason == 3 ? "An ended run keeps no stars." : cleared ? "All three goals complete" :
                stars == 0 ? "No stars kept" : stars + (stars == 1 ? " star" : " stars") + " kept";
            var realm = catalog.Realm(value.Realm);
            PageAction share = null;
            if (value.Share != null)
                share = ShareAction(value, ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName,
                    realm.realmName, "Level " + Number(value.Realm, value.Level) + " stars", (ulong)stars, value.Score, null),
                    "Share");
            float d = ui.Density; bool compact = Compact, tight = Tight;
            // The dialog sits over the dimmed painting.
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .45f);
            Image[] lit = null; TMP_Text scoreText = null; RectTransform chip = null, stroke = null, finish = null;
            var sequence = Dialog("Result", null, (card, rail) => {
                // A win says the stars kept, or the guardian's defeat on its own
                // level; any other end, that the run is not over for good.
                var lines = realm.guardianLines;
                var page = TalkPage.For(lines, !cleared ? TalkMoment.Ended : value.Level == Protocol.CampaignTargets.Length ? TalkMoment.GuardianDefeated
                    : TalkMoment.Win, stars);
                var talk = Speak("Result talk", card.Parent, card.Left - 24 * d, rail, card.Width + 48 * d, realm, new[] { page }, null, false);
                card.Top = talk.y - (compact ? 6 : 43) * d;
                Title(card, title, tight ? 24 : compact ? 26 : 30);
                stroke = (RectTransform)card.Parent.GetChild(card.Parent.childCount - 1);
                card.Gap(4.5f);
                lit = BigStars(card, stars, tight ? .5f : compact ? .6f : 1);
                card.Typed("Score caption", "SCORE", SkinUi.Type.Label, 12, SkinTokens.TextMuted, -8);
                scoreText = card.Typed("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), SkinUi.Type.Number, tight ? 34 : compact ? 40 : 56, SkinTokens.Score, 3);
                if (value.NewBest) chip = Group("New best chip", card.Parent, () => NewBest(card, compact));
                card.Gap(value.NewBest ? compact ? 6 : 24 : compact ? 2 : 12);
                card.Typed("Result summary", summary, SkinUi.Type.Caption, 15, SkinTokens.TextMuted, 0);
                if (!string.IsNullOrEmpty(value.Notice)) card.Typed("Result notice", value.Notice, SkinUi.Type.Body, 15, SkinTokens.Text, 0);
                card.Gap(compact ? 8 : 21);
                finish = Group("Result actions", card.Parent, () => {
                    var first = cleared ? value.Done : value.Retry; var second = cleared ? value.Retry : value.Done;
                    // The tightest phone puts the three actions in one row, the primary first.
                    if (tight && share != null) Row3(card, first, second, share);
                    else
                    {
                        Pill(card, first, true, null, compact ? 8 : 16);
                        PillPair(card, second, share);
                    }
                });
            });
            if (sequence != null) Celebrate(sequence, cleared, lit, stroke, scoreText, value.Score, chip, finish);
        }
        // The result's entrance after the dialog opens: the title stroke draws
        // itself, the kept stars ignite one by one (300 ms apart on a win), the
        // score counts up, "New best!" stamps in and the actions arrive last. A
        // tap anywhere jumps to the end. A loss plays the same beats, faster and
        // without the celebration.
        private void Celebrate(PageSequence sequence, bool cleared, Image[] lit, RectTransform stroke, TMP_Text score, ulong total,
            RectTransform chip, RectTransform finish)
        {
            float pace = cleared ? 1 : .6f, starts = .45f * pace, apart = .3f * pace;
            var strokeWidth = stroke.sizeDelta.x; var strokeAt = stroke.anchoredPosition;
            sequence.Add(.3f * pace, .3f, t => {
                float width = strokeWidth * PageSequence.EaseOut(t);
                stroke.sizeDelta = new Vector2(width, stroke.sizeDelta.y); stroke.anchoredPosition = strokeAt + new Vector2((strokeWidth - width) / 2, 0);
            });
            for (int i = 0; i < lit.Length; i++)
            {
                var star = lit[i]; var rect = star.rectTransform; var at = rect.anchoredPosition; var center = SkinUi.ScreenRect(rect).center;
                sequence.Add(starts + i * apart, .4f, t => {
                    PageSequence.ScaleAbout(rect, at, center, t == 0 ? .6f : PageSequence.Ignite(t));
                    star.color = SkinUi.WithAlpha(star.color, Mathf.Clamp01(t * 5));
                });
            }
            float counted = starts + Mathf.Max(0, lit.Length - 1) * apart + .2f;
            // The count keeps the fitted score's size, abbreviating as the fitted score does.
            string final = score.text; float width = score.rectTransform.rect.width, size = score.fontSize / (ui.Density * ui.Scale);
            sequence.Add(counted, .6f * pace, t => score.text = t >= 1 ? final : NumberFit.Within(ui,
                ((ulong)Mathf.Round(total * PageSequence.EaseOut(t))).ToString("N0", CultureInfo.InvariantCulture), width, size));
            float stamp = counted + .6f * pace;
            if (chip != null)
            {
                var group = chip.GetComponent<CanvasGroup>(); var at = chip.anchoredPosition; var center = SkinUi.ScreenRect(chip).center;
                var bounds = chip.GetComponentsInChildren<RectTransform>().Skip(1).Select(SkinUi.ScreenRect).Aggregate(Union);
                sequence.Add(stamp, .12f, t => { PageSequence.ScaleAbout(chip, at, bounds.center, Mathf.Lerp(1.3f, 1, t)); group.alpha = t; });
            }
            var actionsGroup = finish.GetComponent<CanvasGroup>();
            sequence.Add(stamp + .1f, .2f, t => { actionsGroup.alpha = t; actionsGroup.interactable = actionsGroup.blocksRaycasts = t >= 1; });
            var skip = ui.Rect<Image>("Skip", shell.ScreenArea, shell.Overlay); skip.color = Color.clear; skip.raycastTarget = true;
            skip.gameObject.AddComponent<Button>().onClick.AddListener(sequence.Finish);
            sequence.Finished += () => { if (skip != null) { skip.gameObject.SetActive(false); Destroy(skip.gameObject); } };
        }
        // Draws build's pieces into a group of their own (for one fade or stamp).
        private RectTransform Group(string name, Transform parent, Action build)
        {
            int from = parent.childCount;
            build();
            var group = Holder(name, shell.ScreenArea, parent);
            group.gameObject.AddComponent<CanvasGroup>();
            var pieces = new System.Collections.Generic.List<Transform>();
            for (int i = from; i < parent.childCount; i++) if (parent.GetChild(i) != group) pieces.Add(parent.GetChild(i));
            foreach (var piece in pieces) piece.SetParent(group, true);
            return group;
        }
        // Three big stars on one row, lit ones first: the middle one larger and
        // raised, as drawn (its light 74 dp across, the others' 58, 86 dp apart).
        // The star art keeps a margin round its light, so its rect is larger.
        // Returns the lit ones.
        // A short phone draws them smaller, by scale.
        private Image[] BigStars(PageColumn card, int earned, float scale = 1)
        {
            float d = ui.Density, side = 74 * d * scale, middle = 95 * d * scale, pitch = 86 * d * scale;
            var row = card.Take(middle, scale < 1 ? 8 : 16);
            var lit = new Image[earned];
            for (int i = 0; i < 3; i++)
            {
                float size = i == 1 ? middle : side, x = row.center.x + (i - 1) * pitch, y = row.center.y + (i == 1 ? 4.4f : -4.4f) * d * scale;
                var star = ui.Star("Result star " + (i + 1), new Rect(x - size / 2, y - size / 2, size, size), i < earned, card.Parent);
                if (i < earned) lit[i] = star;
            }
            return lit;
        }
        // The "New best!" chip: a 36 dp glass plate with the trophy and the words
        // in warm light, as drawn.
        private void NewBest(PageColumn card, bool compact)
        {
            float d = ui.Density, text = ui.TextWidth("New best!", 16, SkinUi.Type.Number), width = Mathf.Max(165 * d, text + 70 * d);
            // A short phone draws the plate 30 dp tall.
            var rect = card.Take((compact ? 30 : 36) * d, 0);
            var chip = new Rect(rect.center.x - width / 2, rect.y, width, rect.height);
            ui.Piece("New best", SkinSlots.Plate, chip, card.Parent, .6f);
            float start = chip.center.x - (text + 30 * d) / 2;
            Tinted("New best icon", SkinSlots.IconTrophy, new Rect(start, chip.center.y - 11 * d, 22 * d, 22 * d), SkinTokens.Accent, card.Parent);
            ui.Label("New best label", "New best!", new Rect(start + 30 * d, chip.y, text + 4 * d, chip.height), 16, SkinTokens.Accent,
                card.Parent, SkinUi.Type.Number, TextAlignmentOptions.Left);
        }
        // Three pills in one row, the primary first; the share pill says its word only.
        private void Row3(PageColumn card, PageAction primary, PageAction second, PageAction share)
        {
            float d = ui.Density, gap = 8 * d, third = (card.Width + 16 * d - 2 * gap) / 3, left = card.Left - 8 * d;
            var columns = Enumerable.Range(0, 3).Select(i => new PageColumn(ui, card.Parent, actions, left + i * (third + gap), third, card.Top)).ToArray();
            Pill(columns[0], primary, true, null, 0);
            Pill(columns[1], second, false, null, 0);
            Pill(columns[2], share, false, null, 0);
            card.Top = columns.Min(column => column.Top);
        }
        // Two secondary pills side by side; the share pill leads with its icon.
        private void PillPair(PageColumn card, PageAction left, PageAction right)
        {
            if (left == null || right == null) { Pill(card, left ?? right, false, right == null ? null : SkinSlots.IconShare, 0); return; }
            float d = ui.Density, gap = 30 * d, half = (card.Width - gap) / 2;
            var halves = new[] { new PageColumn(ui, card.Parent, actions, card.Left, half, card.Top),
                new PageColumn(ui, card.Parent, actions, card.Left + half + gap, half, card.Top) };
            Pill(halves[0], left, false, left.Name == "Share" ? SkinSlots.IconShare : null, 0);
            Pill(halves[1], right, false, right.Name == "Share" ? SkinSlots.IconShare : null, 0);
            card.Top = Mathf.Min(halves[0].Top, halves[1].Top);
        }

        // The Daily result: the guardian's line under the page header, then the
        // score, the day's objective count (none on a Classic day) and the streak,
        // with sharing. The tab bar leads back to the Daily.
        private void Result(ResultPageView value)
        {
            float d = ui.Density;
            var realm = catalog.Realm(value.Realm);
            column.Gap(177 - 4);
            var line = TalkPage.For(realm.guardianLines, value.Speaks ?? TalkMoment.Daily, value.SpeaksStars);
            var talk = Speak("Result talk", shell.Page, column.Left, column.Top, column.Width, realm, new[] { line }, null, false);
            column.Top = talk.y - 19 * d;
            var card = column.Card("Result card", null, 24, 20, 20);
            card.Typed("Score caption", "SCORE", SkinUi.Type.Label, 12, SkinTokens.TextMuted, -2);
            card.Typed("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), SkinUi.Type.Number, 56, SkinTokens.Score, 14);
            string objective = value.ObjectiveKind == 0 ? null : catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            var rows = new PageColumn(ui, card.Parent, actions, card.Left - 8 * d, card.Width + 16 * d, card.Top);
            if (objective != null) ResultRow(rows, "Objective", objective, value.ObjectiveTotal.ToString("N0", CultureInfo.InvariantCulture), SkinTokens.Objective, 12);
            card.Top = rows.Top;
            if (value.Streak.HasValue)
            {
                string days = Days(value.Streak.Value);
                float width = NumberSlot(days, 20, card.Width / 2);
                var rect = card.Take(ui.TextHeight("0", width, 20, SkinUi.Type.Number), 0);
                ui.Label("Streak label", "DAILY STREAK", new Rect(rect.x, rect.y, rect.width - width, rect.height), 12, SkinTokens.TextMuted,
                    card.Parent, SkinUi.Type.Label, TextAlignmentOptions.Left);
                FittedNumber("Streak", days, new Rect(rect.xMax - 17 * d - width, rect.y, width, rect.height), 20, SkinTokens.Score, card.Parent,
                    TextAlignmentOptions.Right);
            }
            if (!string.IsNullOrEmpty(value.Notice)) card.Typed("Result notice", value.Notice, SkinUi.Type.Body, 15, SkinTokens.Text, 0);
            column = card.End(30);
            if (value.Share != null)
            {
                string text = ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName, realm.realmName,
                    objective ?? "Score only", value.ObjectiveTotal, value.Score, value.Streak);
                var buttons = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top);
                Pill(buttons, ShareAction(value, text, "Share result"), true, null, 0);
                column = new PageColumn(ui, shell.Page, actions, column.Left, column.Width, buttons.Top);
            }
        }

        // The Daily page before today's run: the guardian says where the result
        // will be, and the primary returns to the Daily.
        private void NoResult(ResultPageView value)
        {
            float d = ui.Density;
            var realm = catalog.Realm(value.Realm);
            column.Gap(213 - 4);
            var talk = Speak("Result talk", shell.Page, column.Left, column.Top, column.Width, realm,
                new[] { new TalkPage("Play today’s Daily to see your score and the day’s objective count here.", "idle") }, null, false);
            column.Top = talk.y - 30 * d;
            column.Typed("No result", "No result yet", SkinUi.Type.Title, 27, SkinTokens.Text, 50);
            var buttons = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top);
            Pill(buttons, value.Done, true, null, 0);
            column = new PageColumn(ui, shell.Page, actions, column.Left, column.Width, buttons.Top);
        }
    }
}
