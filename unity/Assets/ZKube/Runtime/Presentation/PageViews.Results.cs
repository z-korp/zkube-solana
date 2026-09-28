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
            // The core keeps no stars from a run the player ends.
            string summary = value.EndReason == 3 ? "An ended run keeps no stars · try again" : stars == 3 ? "All three goals complete" :
                stars == 0 ? "No stars yet · try again" : stars + (stars == 1 ? " star" : " stars") + " kept · try again";
            var realm = catalog.Realm(value.Realm);
            PageAction share = null;
            if (value.Share != null)
                share = ShareAction(value, ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName,
                    realm.realmName, "Level " + Number(value.Realm, value.Level) + " stars", (ulong)stars, value.Score, null),
                    value.NativeSharing ? "Share" : "Copy");
            float d = ui.Density;
            // The dialog sits over the dimmed painting.
            shell.Backdrop(ui.Art.SkinRealm(SkinSlots.Background), .45f);
            Image[] lit = null; TMP_Text scoreText = null; RectTransform chip = null, stroke = null, finish = null;
            var sequence = Dialog("Result", null, (card, rail) => {
                var talk = Talk(card.Parent, new Rect(card.Left - 24 * d, 0, card.Width + 48 * d, 0), rail, cleared ? "boss__celebrate" : "boss__defeated",
                    realm.guardianName, summary, null);
                card.Top = talk.y - 43 * d;
                Title(card, title, 30);
                stroke = (RectTransform)card.Parent.GetChild(card.Parent.childCount - 1);
                card.Gap(13);
                lit = BigStars(card, stars);
                card.Typed("Score caption", "SCORE", SkinUi.Type.Label, 12, SkinTokens.TextMuted, -8);
                scoreText = card.Typed("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), SkinUi.Type.Number, 56, SkinTokens.Score, 3);
                if (value.NewBest) chip = Group("New best chip", card.Parent, () => NewBest(card));
                if (!string.IsNullOrEmpty(value.Notice)) card.Typed("Result notice", value.Notice, SkinUi.Type.Body, 15, SkinTokens.Text, 0);
                card.Gap(21);
                finish = Group("Result actions", card.Parent, () => {
                    Pill(card, cleared ? value.Done : value.Retry, true, null, 16);
                    PillPair(card, cleared ? value.Retry : value.Done, share);
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
            string final = total.ToString("N0", CultureInfo.InvariantCulture);
            sequence.Add(counted, .6f * pace, t => score.text = t >= 1 ? final :
                ((ulong)Mathf.Round(total * PageSequence.EaseOut(t))).ToString("N0", CultureInfo.InvariantCulture));
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
        // Three big stars on one row; lit ones first, the middle one larger.
        // Returns the lit ones.
        private Image[] BigStars(PageColumn card, int earned)
        {
            float d = ui.Density, side = 58 * d, middle = 72 * d;
            var row = card.Take(middle, 30);
            var lit = new Image[earned];
            for (int i = 0; i < 3; i++)
            {
                float size = i == 1 ? middle : side, x = row.center.x + (i - 1) * 86 * d;
                var star = ui.Star("Result star " + (i + 1), new Rect(x - size / 2, row.center.y - size / 2, size, size), i < earned, card.Parent);
                if (i < earned) lit[i] = star;
            }
            return lit;
        }
        // The "New best!" chip: a glass plate with the trophy and the words in
        // warm light.
        private void NewBest(PageColumn card)
        {
            float d = ui.Density, text = ui.TextWidth("New best!", 13, SkinUi.Type.Label), width = text + 58 * d;
            var rect = card.Take(30 * d, 0);
            var chip = new Rect(rect.center.x - width / 2, rect.y, width, rect.height);
            ui.Piece("New best", SkinSlots.Plate, chip, card.Parent, .5f);
            Tinted("New best icon", SkinSlots.IconTrophy, new Rect(chip.x + 14 * d, chip.center.y - 9 * d, 18 * d, 18 * d), SkinTokens.Accent, card.Parent);
            ui.Label("New best label", "New best!", new Rect(chip.x + 38 * d, chip.y, text + 8 * d, chip.height), 13, SkinTokens.Accent,
                card.Parent, SkinUi.Type.Label, TextAlignmentOptions.Left);
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
            var talk = Talk(shell.Page, new Rect(column.Left, 0, column.Width, 0), column.Top, "boss__satisfied", realm.guardianName, realm.guardianGreeting, null);
            column.Top = talk.y - 19 * d;
            var card = column.Card("Result card", null, 24, 20, 20);
            card.Typed("Score caption", "SCORE", SkinUi.Type.Label, 12, SkinTokens.TextMuted, -2);
            card.Typed("Score", value.Score.ToString("N0", CultureInfo.InvariantCulture), SkinUi.Type.Number, 56, SkinTokens.Score, 14);
            string objective = value.ObjectiveKind == 0 ? null : catalog.ObjectiveName(value.ObjectiveKind, value.ObjectiveValue);
            var rows = new PageColumn(ui, card.Parent, actions, card.Left - 8 * d, card.Width + 16 * d, card.Top);
            if (objective != null) ResultRow(rows, "Objective", objective, value.ObjectiveTotal, SkinTokens.Objective, 12);
            card.Top = rows.Top;
            if (value.Streak.HasValue)
            {
                string days = Days(value.Streak.Value);
                float width = ui.TextWidth(days, 20, SkinUi.Type.Number);
                var rect = card.Take(ui.TextHeight(days, width, 20, SkinUi.Type.Number), 0);
                ui.Label("Streak label", "DAILY STREAK", new Rect(rect.x, rect.y, rect.width - width, rect.height), 12, SkinTokens.TextMuted,
                    card.Parent, SkinUi.Type.Label, TextAlignmentOptions.Left);
                ui.Label("Streak", days, new Rect(rect.xMax - 17 * d - width, rect.y, width, rect.height), 20, SkinTokens.Score,
                    card.Parent, SkinUi.Type.Number, TextAlignmentOptions.Right);
            }
            if (!string.IsNullOrEmpty(value.Notice)) card.Typed("Result notice", value.Notice, SkinUi.Type.Body, 15, SkinTokens.Text, 0);
            column = card.End(30);
            if (value.Share != null)
            {
                string text = ResultShareText.Build(value.ProductName, value.Mode, value.PlayerName, realm.guardianName, realm.realmName,
                    objective ?? "Score only", value.ObjectiveTotal, value.Score, value.Streak);
                var buttons = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top);
                Pill(buttons, ShareAction(value, text, value.NativeSharing ? "Share result" : "Copy result"), true, null, 0);
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
            var talk = Talk(shell.Page, new Rect(column.Left, 0, column.Width, 0), column.Top, "boss__idle", realm.guardianName,
                "Play today’s Daily to see your score and the day’s objective count here.", null);
            column.Top = talk.y - 30 * d;
            column.Typed("No result", "No result yet", SkinUi.Type.Title, 27, SkinTokens.Text, 50);
            var buttons = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top);
            Pill(buttons, value.Done, true, null, 0);
            column = new PageColumn(ui, shell.Page, actions, column.Left, column.Width, buttons.Top);
        }
    }
}
