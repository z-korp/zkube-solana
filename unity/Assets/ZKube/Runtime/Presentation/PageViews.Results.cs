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
    }
}
