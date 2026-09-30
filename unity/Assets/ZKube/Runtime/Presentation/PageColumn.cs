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
        public Action Click(PageAction action) => () => { if (action.Available) Run(action.Invoke); };
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
            bool available = action.Available;
            button.interactable = available;
            var group = button.GetComponent<CanvasGroup>();
            if (group != null) group.alpha = available ? 1 : .5f;
            if (action.Label == null) return;
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

    // Stacks page pieces top-down in screen pixels. Every height is measured with
    // the shipped fonts at the requested text size, so larger text grows a card
    // instead of clipping it.
    public sealed class PageColumn
    {
        public const float ButtonDp = 56, RowDp = 52;
        public readonly SkinUi Ui;
        public readonly Transform Parent;
        public readonly PageActions Actions;
        public readonly float Left, Width;
        public float Top;
        private PageColumn outer;
        private string name, heading;
        private int sibling;
        private float bottomInset;
        private float D => Ui.Density;

        public PageColumn(SkinUi ui, Transform parent, PageActions actions, float left, float width, float top)
        { Ui = ui; Parent = parent; Actions = actions; Left = left; Width = width; Top = top; }

        public Rect Take(float height, float gapDp = 10)
        { var rect = new Rect(Left, Top - height, Width, height); Top -= height + gapDp * D; return rect; }
        public void Gap(float dp) => Top -= dp * D;

        public TMP_Text Text(string name, string value, float sizeDp, string token, bool display = false, float gapDp = 6,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center) =>
            Typed(name, value, display ? SkinUi.Type.Title : SkinUi.Type.Body, sizeDp, token, gapDp, alignment);
        public TMP_Text Typed(string name, string value, SkinUi.Type role, float sizeDp, string token, float gapDp = 6,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center)
        {
            // A number stays on one line, fitted to the column.
            if (role == SkinUi.Type.Number)
            {
                var (shown, size) = NumberFit.Fit(Ui, value, Width, sizeDp);
                var text = Ui.Label(name, shown, Take(Ui.TextHeight(shown, float.PositiveInfinity, size, role), gapDp), size, token, Parent, role, alignment);
                text.textWrappingMode = TextWrappingModes.NoWrap;
                return text;
            }
            float height = Ui.TextHeight(value, Width, sizeDp, role);
            return Ui.Label(name, value, Take(height, gapDp), sizeDp, token, Parent, role, alignment);
        }

        // A kit pill with its label on one line; icon leads the label.
        public Button Button(PageAction action, bool primary, float gapDp = 12, string icon = null)
        {
            if (action == null) return null;
            float lead = icon == null ? 0 : 24 * D, room = Width - 20 * D - lead;
            var (label, size) = PillLabel(Ui, action.Label, action.Short, room);
            float height = Mathf.Max(ButtonDp * D, Ui.TextHeight(label, float.PositiveInfinity, size, SkinUi.Type.Display) + 24 * D);
            var button = Ui.TextButton(action.Name ?? action.Label, Take(height, gapDp), label, Actions.Click(action), primary, Parent, out var text, icon,
                SkinUi.Type.Display);
            Style(Ui, text, size);
            return Actions.Bind(button, action, relabel: value => {
                var (shown, fitted) = PillLabel(Ui, value, action.Short, room);
                text.text = shown; Style(Ui, text, fitted);
            });
        }

        // A pill label stays on one line: it shrinks toward the button floor (the
        // badge size in the type table, as drawn, so larger text may come back
        // down to it), and when even that is too wide the action's shorter words
        // are used.
        public const float ButtonMinimumDp = 14;
        public static (string Label, float Size) PillLabel(SkinUi ui, string label, string shorter, float room)
        {
            float width = ui.TextWidth(label, SkinUi.ButtonDp, SkinUi.Type.Display), floor = ButtonMinimumDp / ui.Scale;
            if (width <= room) return (label, SkinUi.ButtonDp);
            float size = Mathf.Floor(SkinUi.ButtonDp * room / width * 10) / 10;
            if (size >= floor) return (label, size);
            return shorter != null && shorter != label ? PillLabel(ui, shorter, null, room) : (label, floor);
        }
        public static void Style(SkinUi ui, TMP_Text text, float sizeDp)
        {
            text.fontSize = sizeDp * ui.Density * ui.Scale;
            text.textWrappingMode = TextWrappingModes.NoWrap; text.overflowMode = TextOverflowModes.Overflow;
        }

        // A kit list row, grown to fit its label: an optional icon, the label and
        // an optional value on the right.
        public Image Row(string name, string label, string value = null, string icon = null, float gapDp = 10)
        {
            float inner = Width - 32 * D - (icon == null ? 0 : 42 * D);
            if (value != null) inner -= Mathf.Min(Ui.TextWidth(value, 15, true), inner / 2) + 8 * D;
            float height = Mathf.Max(RowDp * D, Ui.TextHeight(label, inner, 14, false) + 16 * D);
            return Ui.ListRow(name, Take(height, gapDp), icon, label, value, null, Parent, out _, out _);
        }
        // A short message in a row: identity notices, errors and store status.
        public Image Note(string name, string text, float gapDp = 10) => Row(name, text, gapDp: gapDp);

        public Rect Stars(string name, byte earned, float sizeDp, float gapDp = 8)
        {
            float size = sizeDp * D, gap = 4 * D, width = 3 * size + 2 * gap;
            var rect = Take(size, gapDp);
            for (int i = 0; i < 3; i++)
                Ui.Star(name + " " + (i + 1), new Rect(Left + (Width - width) / 2 + i * (size + gap), rect.y, size, size), i < earned, Parent);
            return rect;
        }

        public Image Medallion(string name, Sprite portrait, float sizeDp, float gapDp = 8)
        {
            float size = sizeDp * D;
            var rect = Take(size, gapDp);
            return Ui.Medallion(name, new Rect(Left + (Width - size) / 2, rect.y, size, size), portrait, Parent);
        }

        // A kit card around a padded inner column. End draws the card behind what
        // was stacked inside it, sized to fit, with its optional heading. The
        // insets default to the kit's; a page can set its own sides, top and bottom.
        public PageColumn Card(string name, string heading = null, float? sideDp = null, float? topDp = null, float? bottomDp = null)
        {
            float side = sideDp.HasValue ? sideDp.Value * D : Ui.CardInset, top = topDp.HasValue ? topDp.Value * D : Ui.CardInset;
            float headingHeight = heading == null ? 0 : Ui.TextHeight(heading, Width - 2 * side, 17, true) + 8 * D;
            var inner = new PageColumn(Ui, Parent, Actions, Left + side, Width - 2 * side, Top - top - headingHeight)
            { outer = this, name = name, heading = heading, sibling = Parent.childCount,
              bottomInset = bottomDp.HasValue ? bottomDp.Value * D : Ui.CardInset * .6f };
            return inner;
        }
        public PageColumn End(float gapDp = 18)
        {
            if (outer == null) throw new InvalidOperationException("Only a card column can end");
            float bottom = Top - bottomInset;
            var card = Ui.Card(name, new Rect(outer.Left, bottom, outer.Width, outer.Top - bottom), heading, Parent, out _);
            card.transform.SetSiblingIndex(sibling);
            outer.Top = bottom - gapDp * D;
            return outer;
        }
    }
}
