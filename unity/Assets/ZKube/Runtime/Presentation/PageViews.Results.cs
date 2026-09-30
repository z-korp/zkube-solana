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
