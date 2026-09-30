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
