using System;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Page actions bound to kit buttons. Availability and labels are observed
    // every frame, so an operation that finishes later re-enables its button.
    public sealed class PageActions
    {
        private readonly Dictionary<Button, PageAction> bound = new Dictionary<Button, PageAction>();
        // A label that is fitted to its pill is fitted again when its words change.
        private readonly Dictionary<Button, (string shown, Action<string> relabel)> labels = new Dictionary<Button, (string, Action<string>)>();
        private readonly Action<Exception> report;
        public PageActions(Action<Exception> report) { this.report = report ?? throw new ArgumentNullException(nameof(report)); }
        public Action Click(PageAction action) => () => { if (action.Available && action.Progress == null) Run(action.Invoke); };
        public void Run(Action action) { try { action?.Invoke(); } catch (Exception error) { report(error); } }
        // Unavailable buttons dim unless their art already shows the state (map nodes, emblems).
        public Button Bind(Button button, PageAction action, bool fade = true, Action<string> relabel = null)
        {
            if (fade) button.gameObject.AddComponent<CanvasGroup>();
            bound[button] = action;
            if (relabel != null) labels[button] = (action.Label, relabel);
            Apply(button, action); return button;
        }
        public Button Wire(Button button, PageAction action, bool fade = true)
        { var click = Click(action); button.onClick.AddListener(() => click()); return Bind(button, action, fade); }
        public void Refresh() { foreach (var pair in bound.ToArray()) if (pair.Key != null) Apply(pair.Key, pair.Value); }
        public void Clear() { bound.Clear(); labels.Clear(); }
        private void Apply(Button button, PageAction action)
        {
            // An action in progress is drawn at full strength and takes no tap.
            bool available = action.Available, busy = action.Progress != null;
            button.interactable = available && !busy;
            var group = button.GetComponent<CanvasGroup>();
            if (group != null) group.alpha = available || busy ? 1 : .5f;
            if (action.Label == null || busy) return;
            if (labels.TryGetValue(button, out var fitted))
            {
                if (fitted.shown == action.Label) return;
                labels[button] = (action.Label, fitted.relabel); fitted.relabel(action.Label);
                return;
            }
            var label = button.GetComponentInChildren<TMP_Text>();
            if (label != null && label.text != action.Label) label.text = action.Label;
        }
    }
}
