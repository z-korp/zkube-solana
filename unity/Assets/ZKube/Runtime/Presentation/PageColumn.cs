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
        private readonly Action<Exception> report;
        public PageActions(Action<Exception> report) { this.report = report ?? throw new ArgumentNullException(nameof(report)); }
        public Action Click(PageAction action) => () => { if (action.Available) Run(action.Invoke); };
        public void Run(Action action) { try { action?.Invoke(); } catch (Exception error) { report(error); } }
        // Unavailable buttons dim unless their art already shows the state (map nodes, emblems).
        public Button Bind(Button button, PageAction action, bool fade = true)
        {
            if (fade) button.gameObject.AddComponent<CanvasGroup>();
            bound[button] = action; Apply(button, action); return button;
        }
        public Button Wire(Button button, PageAction action, bool fade = true)
        { var click = Click(action); button.onClick.AddListener(() => click()); return Bind(button, action, fade); }
        public void Refresh() { foreach (var pair in bound.ToArray()) if (pair.Key != null) Apply(pair.Key, pair.Value); }
        public void Clear() => bound.Clear();
        private static void Apply(Button button, PageAction action)
        {
            bool available = action.Available;
            button.interactable = available;
            var group = button.GetComponent<CanvasGroup>();
            if (group != null) group.alpha = available ? 1 : .5f;
            var label = button.GetComponentInChildren<TMP_Text>();
            if (label != null && action.Label != null && label.text != action.Label) label.text = action.Label;
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
        private readonly PageColumn outer;
        private readonly Image card;
        private readonly float padding;
        private float D => Ui.Density;

        public PageColumn(SkinUi ui, Transform parent, PageActions actions, float left, float width, float top)
        { Ui = ui; Parent = parent; Actions = actions; Left = left; Width = width; Top = top; }
        private PageColumn(PageColumn outer, Image card, float padding)
            : this(outer.Ui, outer.Parent, outer.Actions, outer.Left + padding, outer.Width - 2 * padding, outer.Top - padding * .9f)
        { this.outer = outer; this.card = card; this.padding = padding; }

        public Rect Take(float height, float gapDp = 10)
        { var rect = new Rect(Left, Top - height, Width, height); Top -= height + gapDp * D; return rect; }
        public void Gap(float dp) => Top -= dp * D;

        public TMP_Text Text(string name, string value, float sizeDp, string token, bool display = false, float gapDp = 6,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center)
        {
            float height = Ui.TextHeight(value, Width, sizeDp, display);
            return Ui.Label(name, value, Take(height, gapDp), sizeDp, token, Parent, display, alignment);
        }

        public Button Button(PageAction action, bool primary, float gapDp = 12, float sizeDp = 18)
        {
            if (action == null) return null;
            float height = Mathf.Max(ButtonDp * D, Ui.TextHeight(action.Label, Width - 20 * D, sizeDp, true) + 24 * D);
            var button = Ui.TextButton(action.Name ?? action.Label, Take(height, gapDp), action.Label, Actions.Click(action), primary, Parent, out var text);
            text.fontSize = sizeDp * D * Ui.Scale;
            return Actions.Bind(button, action);
        }

        // A read-only list row: a caption on the left and a value on the right.
        public Rect Row(string name, string caption, string value, string valueToken = SkinTokens.Accent, float gapDp = 10)
        {
            // The plate's leaf ends take about 30 dp on each side.
            float inner = Width - 64 * D, half = inner * .6f;
            float height = Mathf.Max(RowDp * D, Mathf.Max(Ui.TextHeight(caption, half, 16, false),
                Ui.TextHeight(value ?? "", inner - half, 18, true)) + 20 * D);
            var rect = Take(height, gapDp);
            Ui.Piece(name, SkinSlots.Plate, rect, Parent);
            var body = new Rect(rect.x + 32 * D, rect.y, inner, rect.height);
            Ui.Label(name + " caption", caption, new Rect(body.x, body.y, half, body.height), 16, SkinTokens.Text, Parent, false, TextAlignmentOptions.Left);
            if (value != null)
                Ui.Label(name + " value", value, new Rect(body.x + half, body.y, inner - half, body.height), 18, valueToken, Parent, true, TextAlignmentOptions.Right);
            return rect;
        }

        // A short message on a plate: identity notices, errors and store status.
        public Rect Note(string name, string text, float gapDp = 10)
        {
            float height = Mathf.Max(40 * D, Ui.TextHeight(text, Width - 64 * D, 14, false) + 16 * D);
            var rect = Take(height, gapDp);
            Ui.Piece(name, SkinSlots.Plate, rect, Parent);
            Ui.Label(name + " text", text, new Rect(rect.x + 32 * D, rect.y, rect.width - 64 * D, rect.height), 14, SkinTokens.Text, Parent);
            return rect;
        }

        public Rect Stars(string name, byte earned, float sizeDp, float gapDp = 8)
        {
            float size = sizeDp * D, gap = 4 * D, width = 3 * size + 2 * gap;
            var rect = Take(size, gapDp);
            for (int i = 0; i < 3; i++)
                Ui.Piece(name + " " + (i + 1), i < earned ? SkinSlots.StarOn : SkinSlots.StarOff,
                    new Rect(Left + (Width - width) / 2 + i * (size + gap), rect.y, size, size), Parent);
            return rect;
        }

        public Image Medallion(string name, Sprite portrait, float sizeDp, float gapDp = 8)
        {
            float size = sizeDp * D;
            var rect = Take(size, gapDp);
            return Ui.Medallion(name, new Rect(Left + (Width - size) / 2, rect.y, size, size), portrait, Parent);
        }

        // A card is the skin panel behind a padded inner column; End sizes the
        // panel to what was stacked inside it.
        public PageColumn Card(string name, float paddingDp = 24)
        {
            var panel = Ui.Piece(name, SkinSlots.Panel, new Rect(Left, Top - 1, Width, 1), Parent);
            return new PageColumn(this, panel, paddingDp * D);
        }
        public PageColumn End(float gapDp = 18)
        {
            if (outer == null) throw new InvalidOperationException("Only a card column can end");
            float bottom = Top - padding * .6f;
            SkinUi.Place(card.rectTransform, new Rect(outer.Left, bottom, outer.Width, outer.Top - bottom), Parent);
            outer.Top = bottom - gapDp * D;
            return outer;
        }
    }
}
