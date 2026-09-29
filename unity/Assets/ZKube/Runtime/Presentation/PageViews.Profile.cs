using System;
using System.Collections.Generic;
using System.Globalization;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The Profile and Settings pages.
    public sealed partial class PageViews
    {
        public const int NameLimit = 24;
        private bool editingName;

        // The profile: the worn emblem's medallion, the name (edited in place
        // where the identity allows it), what is worn, the stat rows and the
        // emblem grid, locked emblems dimmed.
        private void Profile(ProfilePageView value)
        {
            float d = ui.Density;
            column.Gap(-1);
            var medallion = column.Take(114 * d, 11);
            ui.Medallion("Worn emblem", new Rect(medallion.center.x - 57 * d, medallion.y, 114 * d, 114 * d),
                value.Emblem > Protocol.Realms.Length ? ui.Art.SkinUi(ProfileEmblems.Painting(value.Emblem)) : ui.Art.Sprite("boss__portrait"), shell.Page);
            if (value.ChangeName == null) editingName = false;
            if (savedName != value.Name) { savedName = value.Name; editedName = value.Name; }
            NameRow(value);
            if (!string.IsNullOrEmpty(value.Worn))
            {
                var worn = column.Typed("Worn", value.Worn, SkinUi.Type.Caption, 13, SkinTokens.TextMuted, editingName ? 29 : 19);
                Shade(SkinUi.ScreenRect(worn.rectTransform), ui.TextWidth(value.Worn, 13, SkinUi.Type.Caption), shell.Page);
                worn.transform.SetAsLastSibling();
            }
            if (editingName) { NameEditor(value); return; }
            var rows = new PageColumn(ui, shell.Page, actions, column.Left + 16 * d, column.Width - 32 * d, column.Top);
            ResultRow(rows, "Best Daily", "Best Daily", value.BestDailyScore.ToString("N0", CultureInfo.InvariantCulture), SkinTokens.Score, 6);
            ResultRow(rows, "Campaign stars", "Campaign stars", value.Stars + " / " + Protocol.Realms.Length * Protocol.CampaignTargets.Length * 3,
                SkinTokens.Score, 6);
            ResultRow(rows, "Daily streak", "Daily streak", Days(value.Streak), SkinTokens.Score, 13);
            column.Top = rows.Top;
            foreach (var fact in value.Facts) column.Typed("Profile fact", fact, SkinUi.Type.Body, 15, SkinTokens.Text, 8);
            if (!string.IsNullOrEmpty(value.Notice)) column.Typed("Profile notice", value.Notice, SkinUi.Type.Body, 15, SkinTokens.Text, 8);
            foreach (var action in value.Actions) Pill(column, action, false, null, 12);
            if (value.Emblems.Length != 0) Emblems(value.Emblems);
            if (value.Borders.Length != 0) column.Typed("Border heading", "BORDER", SkinUi.Type.Label, 12, SkinTokens.Accent, 10, TextAlignmentOptions.Left);
            foreach (var choice in value.Borders)
                Pill(column, new PageAction { Name = "Border " + choice.Id, Label = choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                    Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select }, false, null, 12);
            Pill(column, value.Save, false, null, 12); Pill(column, value.Restore, false, null, 12);
        }

        // The name on a 48 dp row. Tapping it edits the name in place; while
        // editing, the row holds the text field.
        private void NameRow(ProfilePageView value)
        {
            float d = ui.Density;
            var rect = column.Take(48 * d, 3);
            rect = new Rect(rect.x + 8 * d, rect.y, rect.width - 16 * d, rect.height);
            var row = ui.Piece("Player name", SkinSlots.ListRow, rect, shell.Page);
            string cue = value.ChangeName == null ? null : editingName ? "Editing" : "Edit name";
            float cueWidth = cue == null ? 0 : ui.TextWidth(cue, 13, SkinUi.Type.Caption);
            if (cue != null)
                ui.Label("Name cue", cue, new Rect(rect.xMax - 8 * d - cueWidth, rect.y, cueWidth, rect.height), 13, SkinTokens.Accent, row.transform,
                    SkinUi.Type.Caption, TextAlignmentOptions.Right);
            var text = new Rect(rect.x + 16 * d, rect.y, rect.width - 40 * d - cueWidth, rect.height);
            if (!editingName)
            {
                ui.Label("Name text", value.Name, text, 20, SkinTokens.Text, row.transform, SkinUi.Type.Number, TextAlignmentOptions.Left)
                    .textWrappingMode = TextWrappingModes.NoWrap;
                if (value.ChangeName == null) return;
                row.raycastTarget = true;
                var edit = row.gameObject.AddComponent<Button>(); edit.transition = Selectable.Transition.None; row.name = "Edit name";
                actions.Wire(edit, new PageAction { Name = "Edit name", Invoke = () => { editingName = true; editedName = value.Name; Redraw(); } },
                    fade: false);
                return;
            }
            row.raycastTarget = true;
            var field = row.gameObject.AddComponent<TMP_InputField>(); field.characterLimit = NameLimit;
            var area = ui.Rect<RectMask2D>("Text area", text, row.transform);
            var label = ui.Label("Name text", "", SkinUi.ScreenRect(area.rectTransform), 20, SkinTokens.Text, area.transform, SkinUi.Type.Number,
                TextAlignmentOptions.Left);
            label.textWrappingMode = TextWrappingModes.NoWrap;
            field.textViewport = area.rectTransform; field.textComponent = label; field.text = editedName;
            nameField = field;
        }
        private TMP_InputField nameField;

        // Editing: Save appears once the name differs from the saved one, then
        // what the name is for, and a preview of it as a shared result shows it.
        private void NameEditor(ProfilePageView value)
        {
            float d = ui.Density;
            var field = nameField;
            var slot = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top);
            var save = Pill(slot, new PageAction { Label = "Save name", Invoke = () => { editingName = false; value.ChangeName(field.text); } }, true, null, 24);
            var saveGroup = save.transform.parent.GetChild(save.transform.GetSiblingIndex() - 1);
            column.Top = slot.Top;
            column.Typed("Name purpose", "Your name appears on this device and on the results you share.", SkinUi.Type.Caption, 16, SkinTokens.Text, 42,
                TextAlignmentOptions.Left);
            var card = column.Card("Name preview card", null, 24, 25, 24);
            card.Typed("Name preview heading", "Name preview", SkinUi.Type.Caption, 12, SkinTokens.TextMuted, 16, TextAlignmentOptions.Left);
            var preview = card.Typed("Name preview", editedName, SkinUi.Type.Title, 27, SkinTokens.Text, 12, TextAlignmentOptions.Left);
            card.Typed("Name preview product", Application.productName + " · Daily", SkinUi.Type.Caption, 15, SkinTokens.Objective, 0,
                TextAlignmentOptions.Left);
            column = card.End(52);
            var limit = column.Typed("Name limit", "Names can use up to " + NameLimit + " characters.", SkinUi.Type.Caption, 13, SkinTokens.TextMuted, 16);
            Shade(SkinUi.ScreenRect(limit.rectTransform), ui.TextWidth(limit.text, 13, SkinUi.Type.Caption), shell.Page);
            limit.transform.SetAsLastSibling();
            void Changed(string text)
            {
                editedName = text; preview.text = text;
                bool changed = text != savedName;
                save.gameObject.SetActive(changed); saveGroup.gameObject.SetActive(changed);
            }
            field.onValueChanged.AddListener(Changed);
            field.onSubmit.AddListener(text => actions.Run(() => { editingName = false; value.ChangeName(text); }));
            Changed(field.text);
            back = new PageAction { Invoke = () => { editingName = false; Redraw(); } };
            field.ActivateInputField();
        }

        // The emblem grid: four across, each emblem in the guardian ring with its
        // name; locked ones are dimmed with a lock and take no tap.
        private void Emblems(ProfileChoiceView[] emblems)
        {
            float d = ui.Density;
            var heading = new PageColumn(ui, shell.Page, actions, column.Left + 16 * d, column.Width - 32 * d, column.Top);
            heading.Typed("Emblem heading", "GUARDIAN EMBLEMS", SkinUi.Type.Label, 12, SkinTokens.Accent, 8.6f, TextAlignmentOptions.Left);
            column.Top = heading.Top;
            int across = 4;
            // Four across, 16 dp inside the column, as drawn.
            float cell = 64 * d, pitch = (column.Width - 32 * d - cell) / (across - 1), left = column.Left + 16 * d;
            var portraits = new List<KeyValuePair<byte, Image>>();
            for (int row = 0; row * across < emblems.Length; row++)
            {
                float labelHeight = 0;
                for (int i = 0; i < across && row * across + i < emblems.Length; i++)
                    labelHeight = Mathf.Max(labelHeight, ui.TextHeight(emblems[row * across + i].Name, pitch - 8 * d, 11, SkinUi.Type.Caption));
                var line = column.Take(cell + labelHeight, 8);
                for (int i = 0; i < across && row * across + i < emblems.Length; i++)
                {
                    var choice = emblems[row * across + i];
                    float x = left + i * pitch;
                    var face = new Rect(x, line.yMax - cell, cell, cell);
                    var hit = ui.Rect<Image>("Emblem " + choice.Id, new Rect(x + cell / 2 - pitch / 2, line.y, pitch, line.height), shell.Page);
                    hit.color = Color.clear; hit.raycastTarget = choice.Available;
                    // A locked emblem dims its face only; its name stays readable.
                    var faceGroup = Holder("Emblem " + choice.Id + " face", shell.ScreenArea, hit.transform);
                    faceGroup.gameObject.AddComponent<CanvasGroup>().alpha = choice.Available ? 1 : .32f;
                    var image = ui.Medallion(choice.Realm != 0 ? "Guardian portrait" : "Achievement emblem", face,
                        choice.Realm != 0 ? null : ui.Art.SkinUi(ProfileEmblems.Painting(choice.Id)), faceGroup);
                    if (choice.Realm != 0) { image.enabled = false; portraits.Add(new KeyValuePair<byte, Image>(choice.Realm, image)); }
                    var nameRect = new Rect(x + cell / 2 - pitch / 2 + 4 * d, line.y, pitch - 8 * d, labelHeight);
                    if (!choice.Available) Shade(nameRect, ui.TextWidth(choice.Name, 11, SkinUi.Type.Caption), hit.transform);
                    ui.Label("Emblem " + choice.Id + " name", choice.Name, nameRect, 11,
                        choice.Detail != null ? SkinTokens.Accent : choice.Available ? SkinTokens.Text : SkinTokens.TextMuted, hit.transform, SkinUi.Type.Caption);
                    if (!choice.Available)
                    {
                        Tinted("Emblem " + choice.Id + " lock", SkinSlots.IconLock, new Rect(face.x + 46 * d, face.y + 3 * d, 18 * d, 18 * d),
                            SkinTokens.TextMuted, shell.Page);
                        continue;
                    }
                    var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                    hit.gameObject.AddComponent<PressSquash>();
                    actions.Wire(button, new PageAction { Name = "Emblem " + choice.Id, CanInvoke = choice.CanSelect, Invoke = choice.Select }, fade: false);
                }
            }
            if (portraits.Count != 0) StartCoroutine(LoadPortraits(portraits, epoch));
        }

        // Settings: the sound panel with a slider per channel (its row switches it
        // off and back to the level it had), the haptics and reduced motion
        // toggles, the text size, then the identity's own actions.
        private void Settings(SettingsPageView value)
        {
            float d = ui.Density;
            column.Gap(18);
            var card = column.Card("Sound card", null, 24, 20, 21);
            card.Typed("Sound heading", "SOUND", SkinUi.Type.Label, 12, SkinTokens.Accent, 22, TextAlignmentOptions.Left);
            Volume(card, "Music", SkinSlots.IconMusic, value.Music, value.SetMusic, true, 11);
            Volume(card, "Effects", SkinSlots.IconSound, value.Effects, value.SetEffects, false, 0);
            column = card.End(28);
            var rows = new PageColumn(ui, shell.Page, actions, column.Left + 8 * d, column.Width - 16 * d, column.Top);
            Switch(rows, "Haptics", value.Haptics, value.ToggleHaptics);
            Switch(rows, "Reduced motion", value.ReducedMotion, value.ToggleMotion);
            var size = rows.Take(56 * d, 0);
            var sizeRow = ui.Piece("Text size: " + (value.LargeText ? "larger" : "standard"), SkinSlots.ListRow, size, shell.Page);
            sizeRow.raycastTarget = true;
            ui.Label("Text size label", "Text size", new Rect(size.x + 16 * d, size.y, size.width / 2, size.height), 16, SkinTokens.Text, sizeRow.transform,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
            ui.Label("Text size value", value.LargeText ? "Larger" : "Standard", new Rect(size.center.x, size.y, size.width / 2 - 24 * d, size.height), 16,
                SkinTokens.Accent, sizeRow.transform, SkinUi.Type.Caption, TextAlignmentOptions.Right);
            var sizeButton = sizeRow.gameObject.AddComponent<Button>(); sizeButton.transition = Selectable.Transition.None;
            sizeRow.gameObject.AddComponent<PressSquash>();
            actions.Wire(sizeButton, new PageAction { Invoke = value.ToggleText }, fade: false);
            column.Top = rows.Top;
            var buttons = new PageColumn(ui, shell.Page, actions, PlayRect().x, PlayRect().width, column.Top - 54 * d);
            if (value.Muted) Pill(buttons, new PageAction { Label = "Unmute all sound", Invoke = value.Unmute }, false, SkinSlots.IconSound, 12);
            foreach (var action in value.Actions) Pill(buttons, action, false, null, 12);
            column.Top = buttons.Top - 11 * d;
            var saved = column.Typed("Settings saved", "Local preferences save automatically.", SkinUi.Type.Caption, 13, SkinTokens.TextMuted, 0);
            Shade(SkinUi.ScreenRect(saved.rectTransform), ui.TextWidth(saved.text, 13, SkinUi.Type.Caption), shell.Page);
            saved.transform.SetAsLastSibling();
        }
        // A 56 dp row whose whole width switches the kit toggle at its end, with
        // On or Off beside it.
        private void Switch(PageColumn rows, string title, bool on, Action toggle)
        {
            float d = ui.Density;
            var rect = rows.Take(56 * d, 14);
            var row = ui.Piece(title + " row", SkinSlots.ListRow, rect, shell.Page);
            ui.Label(title + " label", title, new Rect(rect.x + 16 * d, rect.y, rect.width - 150 * d, rect.height), 16, SkinTokens.Text, row.transform,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
            ui.Label(title + " state", on ? "On" : "Off", new Rect(rect.xMax - 117 * d, rect.y, 40 * d, rect.height), 13,
                on ? SkinTokens.Accent : SkinTokens.TextMuted, row.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            ui.Toggle(title + ": " + (on ? "on" : "off"), new Rect(rect.x, rect.y + (rect.height - 48 * d) / 2, rect.width - 22 * d, 48 * d), on,
                _ => actions.Run(toggle), row.transform);
        }
        // One sound channel: its icon, name and level, then its slider. Tapping
        // the name switches the channel off and back to its last level.
        private void Volume(PageColumn card, string title, string icon, double value, Action<double> set, bool music, float gapDp)
        {
            float d = ui.Density;
            var head = card.Take(24 * d, 5);
            var hit = ui.Rect<Image>(title + " switch", new Rect(head.x - 8 * d, head.center.y - 24 * d, head.width + 16 * d, 48 * d), shell.Page);
            hit.color = Color.clear; hit.raycastTarget = true;
            Tinted(title + " icon", icon, new Rect(head.x, head.y, 24 * d, 24 * d), SkinTokens.Text, hit.transform);
            ui.Label(title + " label", title, new Rect(head.x + 36 * d, head.y - 6 * d, head.width / 2, head.height + 12 * d), 17, SkinTokens.Text,
                hit.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            var level = ui.Label(title + " level", "", new Rect(head.center.x, head.y - 6 * d, head.width / 2 - 9 * d, head.height + 12 * d), 15,
                SkinTokens.TextMuted, hit.transform, SkinUi.Type.Caption, TextAlignmentOptions.Right);
            var track = card.Take(48 * d, gapDp);
            SkinSlider slider = null;
            Action<double> apply = next => {
                actions.Run(() => set(next)); value = next;
                if (next > 0) { if (music) lastMusic = next; else lastEffects = next; }
                level.text = next > 0 ? Math.Round(next * 100) + "%" : "Off";
                slider?.SetWithoutNotify((float)next);
            };
            slider = ui.Slider(title + " slider", new Rect(track.x - 6 * d, track.y, track.width + 12 * d, track.height), (float)value,
                next => apply(Math.Round(next * 100) / 100d), shell.Page);
            level.text = value > 0 ? Math.Round(value * 100) + "%" : "Off";
            var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None;
            actions.Wire(button, new PageAction { Name = title + " switch", Invoke = () => apply(value > 0 ? 0 : music ? lastMusic : lastEffects) }, fade: false);
        }
    }
}
