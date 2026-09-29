using System;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The pause dialog over the dimmed board: the guardian's medallion breaking
    // its top edge, "Paused" over the run's title, Resume, the Sound, Reduced
    // motion and Haptics switches, the text size and End run. Each row is one
    // button named for its state ("Dialog Sound: on"), with the kit switch as
    // its picture; a tap anywhere on the row flips it.
    public sealed class PauseDialog : MonoBehaviour
    {
        public sealed class Row
        {
            public string Name, Label, Value;
            public bool? On;
            public Action Invoke;
        }

        private SkinUi ui;

        // Opens inside the board's persistent modal shield, as the board's own
        // dialogs do: the shield takes every tap from the first frame (new
        // graphics only take taps once drawn), the board's resume closes it, and
        // any dialog the board opens later draws above this one.
        public static PauseDialog Open(BoardView view, BoardArt art, string title, Action resume, Row[] rows, Action end)
        {
            var shield = view.GetComponentsInChildren<Image>(true).Single(image => image.name == "Modal input shield");
            shield.color = art.Token(SkinTokens.Scrim); shield.raycastTarget = true;
            var root = new GameObject("Pause dialog", typeof(RectTransform)).GetComponent<RectTransform>();
            root.SetParent(shield.transform, false);
            SkinUi.Place(root, new Rect(0, 0, Screen.width, Screen.height), shield.transform);
            var dialog = root.gameObject.AddComponent<PauseDialog>();
            dialog.ui = new SkinUi(art, view.Layout.Density, view.TextScale);
            dialog.Draw(root, view.Layout, title, resume, rows, end);
            return dialog;
        }

        private void Draw(RectTransform root, BoardLayout layout, string title, Action resume, Row[] rows, Action end)
        {
            float d = ui.Density;
            float width = Mathf.Min(356 * d, layout.Frame.width - 44 * d), inner = width - 52 * d, rowWidth = width - 40 * d;
            float titleHeight = ui.TextHeight("Paused", inner, 30, SkinUi.Type.Title), subtitleHeight = ui.TextHeight(title, inner, 12, SkinUi.Type.Caption);
            // The spacing is drawn for a tall phone; on a short one it closes up
            // (never the 48 dp rows or the buttons) so End run stays on screen.
            float rowHeight = 48 * d, fixedHeight = titleHeight + subtitleHeight + 2 * 56 * d + rows.Length * rowHeight;
            float spacing = (38 + 5 + 16 + 27 + 37 + 20) * d + (rows.Length - 1) * 12 * d;
            float k = Mathf.Clamp((Screen.height - 60 * d - fixedHeight) / spacing, .3f, 1);
            float height = fixedHeight + spacing * k;
            // Centred on the screen, clear of the medallion above it.
            float top = Mathf.Min(Screen.height / 2f + height / 2, Screen.height - 50 * d), left = Screen.width / 2f - width / 2;
            var frame = new Rect(left, top - height, width, height);
            var panel = ui.Piece("Pause panel", SkinSlots.Dialog, frame, root); panel.raycastTarget = true;
            ui.Medallion("Pause guardian", new Rect(frame.center.x - 40 * d, top + 11 * d - 40 * d, 80 * d, 80 * d), ui.Art.Sprite("boss__portrait"), root);
            float y = top - 38 * d * k;
            ui.Label("Dialog title", "Paused", new Rect(left + 26 * d, y - titleHeight, inner, titleHeight), 30, SkinTokens.Text, root, SkinUi.Type.Title);
            y -= titleHeight + 5 * d * k;
            ui.Label("Dialog details", title, new Rect(left + 26 * d, y - subtitleHeight, inner, subtitleHeight), 12, SkinTokens.TextMuted, root,
                SkinUi.Type.Caption);
            y -= subtitleHeight + 16 * d * k;
            var resumeRect = new Rect(left + 26 * d, y - 56 * d, inner, 56 * d);
            ui.Glow("Dialog Resume halo", new Rect(resumeRect.center.x - resumeRect.width * .65f, resumeRect.center.y - resumeRect.height * .65f,
                resumeRect.width * 1.3f, resumeRect.height * 1.3f), SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .4f), root, PageViews.HaloSeconds);
            ui.TextButton("Dialog Resume", resumeRect, "Resume", resume, true, root, out var resumeLabel);
            PageColumn.Style(ui, resumeLabel, PageColumn.PillLabel(ui, "Resume", null, inner - 20 * d).Size);
            y -= 56 * d + 27 * d * k;
            foreach (var row in rows)
            {
                var rect = new Rect(left + 20 * d, y - rowHeight, rowWidth, rowHeight);
                var face = ui.Piece("Dialog " + row.Name, SkinSlots.ListRow, rect, root); face.raycastTarget = true;
                var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = face;
                button.onClick.AddListener(() => row.Invoke());
                face.gameObject.AddComponent<PressSquash>();
                ui.Label("Dialog " + row.Name + " title", row.Label, new Rect(rect.x + 16 * d, rect.y, rect.width * .6f, rect.height), 16, SkinTokens.Text,
                    face.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
                if (row.On.HasValue)
                    ui.Toggle("Dialog " + row.Name + " switch", new Rect(rect.xMax - 76 * d, rect.y, 68 * d, rect.height), row.On.Value, _ => row.Invoke(),
                        face.transform);
                else
                    ui.Label("Dialog " + row.Name + " label", row.Value + " ›", new Rect(rect.center.x, rect.y, rect.width / 2 - 16 * d, rect.height), 15,
                        SkinTokens.TextMuted, face.transform, SkinUi.Type.Caption, TextAlignmentOptions.Right);
                y -= rowHeight + 12 * d * k;
            }
            y -= (37 - 12) * d * k;
            // End run is the kit's secondary pill in the negative ink, set apart from the rows.
            ui.TextButton("Dialog " + BoardController.EndRun, new Rect(left + 26 * d, y - 56 * d, inner, 56 * d), BoardController.EndRun, end, false, root,
                out var endLabel, SkinSlots.IconClose);
            endLabel.color = ui.Art.Token(SkinTokens.Negative);
            PageColumn.Style(ui, endLabel, PageColumn.PillLabel(ui, BoardController.EndRun, null, inner - 44 * d).Size);
        }

        public void Close()
        {
            if (this == null) return;
            gameObject.SetActive(false); ui?.Dispose(); Destroy(gameObject);
        }
    }
}
