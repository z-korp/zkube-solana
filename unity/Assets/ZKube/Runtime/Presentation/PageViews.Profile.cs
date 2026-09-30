using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using Piece = ZKube.Presentation.ScreenKit.Piece;

namespace ZKube.Presentation
{
    // The Profile and Settings pages.
    public sealed partial class PageViews
    {
        public const int NameLimit = 24;
        private bool editingName;

        // The profile, as the v3 composites draw it: the title plate, the
        // wearer's card (the worn emblem, the name, edited in place where the
        // identity allows it, and what is worn, or the ladder standing, a tap on
        // which chooses the border), the three stat tiles and the guardian emblems
        // in a card, then Edit name or the records. The identity's own lines and
        // actions (borders, saving) follow.
        private void Profile(ProfilePageView value, string[] notices)
        {
            var kit = Kit;
            if (value.ChangeName == null) editingName = false;
            if (savedName != value.Name) { savedName = value.Name; editedName = value.Name; }
            var pieces = new List<Piece> { kit.TitlePlate("Profile", null) };
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            pieces.Add(WearerCard(value, kit));
            if (editingName) { Compose(pieces.ToArray()); NameEditor(value); return; }
            pieces.Add(StatTiles(value, kit));
            if (value.Emblems.Length != 0) pieces.Add(EmblemCard(value.Emblems, kit));
            foreach (var fact in value.Facts) pieces.Add(kit.Note(fact));
            if (!string.IsNullOrEmpty(value.Notice)) pieces.Add(kit.Note(value.Notice));
            var edit = value.ChangeName == null ? null
                : new PageAction { Name = "Edit name", Label = "Edit name", Invoke = () => { editingName = true; editedName = value.Name; Redraw(); } };
            if (edit != null || value.Records != null)
            {
                pieces.Add(Piece.Grow);
                pieces.Add(Buttons((edit, false, SkinSlots.IconProfile), (value.Records, false, SkinSlots.IconCrown)));
            }
            Compose(pieces.ToArray());
            foreach (var action in value.Actions) Pill(column, action, false, null, 12);
            if (value.Borders.Length != 0) column.Typed("Border heading", "BORDER", SkinUi.Type.Label, 12, SkinTokens.Accent, 10, TextAlignmentOptions.Left);
            foreach (var choice in value.Borders)
                Pill(column, new PageAction { Name = "Border " + choice.Id, Label = choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                    Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select }, false, null, 12);
            Pill(column, value.Save, false, null, 12); Pill(column, value.Restore, false, null, 12);
        }

        // The wearer: the worn emblem in its ring (the ladder border where there
        // is a ladder), the name, or its field while editing, and what is worn.
        private Piece WearerCard(ProfilePageView value, ScreenKit kit)
        {
            float d = ui.Density, u = kit.U, k = kit.K, face = Step(64, 52) * u;
            float nameDp = Mathf.Max(16, 19 * k), wornDp = Mathf.Max(12, 14 * k), text = kit.Inner - face - 12 * u;
            float nameHeight = Mathf.Max(editingName ? 48 * d : 0, ui.TextHeight(value.Name, text, nameDp, SkinUi.Type.Caption));
            string worn = value.Standing ?? value.Worn;
            float wornHeight = string.IsNullOrEmpty(worn) ? 0 : ui.TextHeight(worn, text, wornDp, SkinUi.Type.Caption);
            float row = Mathf.Max(face, nameHeight + wornHeight);
            return kit.Card(row + 24 * u, card => {
                float x = card.x + 12 * u, middle = card.center.y;
                ui.Medallion("Worn emblem", new Rect(x, middle - face / 2, face, face), EmblemArt(value.Emblem), shell.Page,
                    value.Tier.HasValue ? SkinSlots.LadderBorder(value.Tier.Value) : SkinSlots.GuardianFrame);
                float tx = x + face + 12 * u, top = middle + (nameHeight + wornHeight) / 2;
                var nameRect = new Rect(tx, top - nameHeight, text, nameHeight);
                if (editingName) NameField(nameRect);
                else ui.Label("Name text", value.Name, nameRect, nameDp, SkinTokens.Text, shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.Left)
                    .textWrappingMode = TextWrappingModes.NoWrap;
                if (wornHeight > 0)
                    ui.Label(value.Standing != null ? "Standing line" : "Worn", worn, new Rect(tx, top - nameHeight - wornHeight, text, wornHeight), wornDp,
                        SkinTokens.TextMuted, shell.Page, SkinUi.Type.Caption, TextAlignmentOptions.Left);
                // Where there is a ladder, a tap on the card chooses the border.
                if (value.ChooseBorder != null && !editingName)
                {
                    var hit = ui.Rect<Image>(value.ChooseBorder.Name ?? value.ChooseBorder.Label, card, shell.Page);
                    hit.color = Color.clear; hit.raycastTarget = true;
                    var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                    actions.Wire(button, value.ChooseBorder, fade: false);
                }
            }, "Wearer card");
        }

        // Campaign stars, the best Daily and the streak, a tile each: the icon,
        // the number and what it counts.
        private Piece StatTiles(ProfilePageView value, ScreenKit kit)
        {
            float u = kit.U, k = kit.K, gap = 8 * u, tile = (kit.Width - 2 * gap) / 3, icon = 24 * u, numberDp = 24 * k, captionDp = Mathf.Max(11, 12 * k);
            var tiles = new[] {
                ("Campaign stars", SkinSlots.IconCampaign, value.Stars + "/" + Protocol.Realms.Length * Protocol.CampaignTargets.Length * 3),
                ("Best Daily", SkinSlots.IconCrown, value.BestDailyScore.ToString("N0", CultureInfo.InvariantCulture)),
                ("Daily streak", SkinSlots.IconClock, Days(value.Streak)) };
            float numberHeight = ui.TextHeight("0", tile, numberDp, SkinUi.Type.Display);
            float captionHeight = tiles.Max(entry => ui.TextHeight(entry.Item1, tile - 8 * u, captionDp, SkinUi.Type.Caption));
            return new Piece(10 * u + icon + 4 * u + numberHeight + captionHeight + 10 * u, rect => {
                for (int i = 0; i < tiles.Length; i++)
                {
                    var (name, slot, number) = tiles[i];
                    var card = new Rect(rect.x + i * (tile + gap), rect.y, tile, rect.height);
                    ui.Piece(name + " tile", SkinSlots.Card, card, shell.Page);
                    ui.Piece(name + " icon", slot, new Rect(card.center.x - icon / 2, card.yMax - 10 * u - icon, icon, icon), shell.Page);
                    var numberRect = new Rect(card.x + 4 * u, card.yMax - 14 * u - icon - numberHeight, tile - 8 * u, numberHeight);
                    NumberFit.Apply(ui, ui.Label(name, number, numberRect, numberDp, SkinTokens.Score, shell.Page, SkinUi.Type.Display), numberRect.width, numberDp);
                    ui.Label(name + " label", name, new Rect(card.x + 4 * u, card.y + 10 * u, tile - 8 * u, captionHeight), captionDp, SkinTokens.Text,
                        shell.Page, SkinUi.Type.Caption);
                }
            });
        }

        // The name's field while editing, in the wearer card: a visible caret in
        // the accent light.
        private void NameField(Rect rect)
        {
            float d = ui.Density;
            var row = ui.Piece("Player name", SkinSlots.ListRow, rect, shell.Page);
            row.raycastTarget = true;
            ui.Label("Name cue", "Editing", new Rect(rect.xMax - 8 * d - ui.TextWidth("Editing", 13, SkinUi.Type.Caption), rect.y,
                ui.TextWidth("Editing", 13, SkinUi.Type.Caption), rect.height), 13, SkinTokens.Accent, row.transform, SkinUi.Type.Caption, TextAlignmentOptions.Right);
            var field = row.gameObject.AddComponent<TMP_InputField>(); field.characterLimit = NameLimit;
            var area = ui.Rect<RectMask2D>("Text area", new Rect(rect.x + 12 * d, rect.y, rect.width - 32 * d - ui.TextWidth("Editing", 13, SkinUi.Type.Caption),
                rect.height), row.transform);
            var label = ui.Label("Name text", "", SkinUi.ScreenRect(area.rectTransform), 20, SkinTokens.Text, area.transform, SkinUi.Type.Number,
                TextAlignmentOptions.Left);
            label.textWrappingMode = TextWrappingModes.NoWrap;
            field.textViewport = area.rectTransform; field.textComponent = label; field.text = editedName;
            field.customCaretColor = true; field.caretColor = ui.Art.Token(SkinTokens.Accent);
            field.caretWidth = Mathf.Max(2, Mathf.RoundToInt(2 * d)); field.caretBlinkRate = .85f;
            field.selectionColor = SkinUi.WithAlpha(ui.Art.Token(SkinTokens.Accent), .35f);
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
            // The helper text keeps the cards' text margin, 24 dp inside the column.
            var helper = new PageColumn(ui, shell.Page, actions, column.Left + 24 * d, column.Width - 48 * d, column.Top);
            helper.Typed("Name purpose", "Your name appears on this device and on the results you share.", SkinUi.Type.Caption, 16, SkinTokens.Text, 42,
                TextAlignmentOptions.Left);
            column.Top = helper.Top;
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

        // The guardian emblems in a card: the heading and how an emblem is won,
        // then four across, each emblem in the guardian ring with its name ("·
        // worn" on the worn one); locked ones are dimmed with a lock and take no tap.
        private Piece EmblemCard(ProfileChoiceView[] emblems, ScreenKit kit)
        {
            float d = ui.Density, u = kit.U, k = kit.K, inner = kit.Inner, cell = Step(48, 40) * u, nameDp = Mathf.Max(11, 12 * k);
            const string how = "Win a guardian’s final trial to earn its emblem.";
            float headingHeight = ui.TextHeight("GUARDIAN EMBLEMS", inner, 12, SkinUi.Type.Label), howHeight = ui.TextHeight(how, inner, Mathf.Max(12, 13 * k), SkinUi.Type.Caption);
            int across = 4; float pitch = inner / across;
            string Name(ProfileChoiceView choice) => choice.Detail == null ? choice.Name : choice.Name + " · " + choice.Detail.ToLowerInvariant();
            var rows = Enumerable.Range(0, (emblems.Length + across - 1) / across).Select(row => emblems.Skip(row * across).Take(across)
                .Max(choice => ui.TextHeight(Name(choice), pitch - 4 * u, nameDp, SkinUi.Type.Caption))).ToArray();
            float grid = rows.Sum(label => cell + 4 * u + label) + (rows.Length - 1) * 8 * u;
            return kit.Card(10 * u + headingHeight + 2 * u + howHeight + 10 * u + grid + 12 * u, card => {
                float x = card.x + 12 * u, y = card.yMax - 10 * u;
                ui.Label("Emblem heading", "GUARDIAN EMBLEMS", new Rect(x, y - headingHeight, inner, headingHeight), 12, SkinTokens.Text, shell.Page,
                    SkinUi.Type.Label, TextAlignmentOptions.Left);
                y -= headingHeight + 2 * u;
                ui.Label("Emblem how", how, new Rect(x, y - howHeight, inner, howHeight), Mathf.Max(12, 13 * k), SkinTokens.TextMuted, shell.Page,
                    SkinUi.Type.Caption, TextAlignmentOptions.Left);
                y -= howHeight + 10 * u;
                var portraits = new List<KeyValuePair<byte, Image>>();
                for (int row = 0; row < rows.Length; row++)
                {
                    for (int i = 0; i < across && row * across + i < emblems.Length; i++)
                    {
                        var choice = emblems[row * across + i];
                        float cx = x + (i + .5f) * pitch;
                        var face = new Rect(cx - cell / 2, y - cell, cell, cell);
                        var hit = ui.Rect<Image>("Emblem " + choice.Id, new Rect(cx - pitch / 2, y - cell - 4 * u - rows[row], pitch, cell + 4 * u + rows[row]), shell.Page);
                        hit.color = Color.clear; hit.raycastTarget = choice.Available;
                        // A locked emblem dims its face only; its name stays readable.
                        var faceGroup = Holder("Emblem " + choice.Id + " face", shell.ScreenArea, hit.transform);
                        faceGroup.gameObject.AddComponent<CanvasGroup>().alpha = choice.Available ? 1 : .32f;
                        var image = ui.Medallion(choice.Realm != 0 ? "Guardian portrait" : "Achievement emblem", face,
                            choice.Realm != 0 ? null : ui.Art.SkinUi(ProfileEmblems.Painting(choice.Id)), faceGroup);
                        if (choice.Realm != 0) { image.enabled = false; portraits.Add(new KeyValuePair<byte, Image>(choice.Realm, image)); }
                        ui.Label("Emblem " + choice.Id + " name", Name(choice), new Rect(cx - pitch / 2 + 2 * u, y - cell - 4 * u - rows[row], pitch - 4 * u, rows[row]),
                            nameDp, choice.Detail != null ? SkinTokens.Accent : choice.Available ? SkinTokens.Text : SkinTokens.TextMuted, hit.transform,
                            SkinUi.Type.Caption);
                        if (!choice.Available)
                        {
                            Tinted("Emblem " + choice.Id + " lock", SkinSlots.IconLock, new Rect(face.xMax - .3f * cell, face.y, .3f * cell, .3f * cell),
                                SkinTokens.TextMuted, shell.Page);
                            continue;
                        }
                        var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                        hit.gameObject.AddComponent<PressSquash>();
                        actions.Wire(button, new PageAction { Name = "Emblem " + choice.Id, CanInvoke = choice.CanSelect, Invoke = choice.Select }, fade: false);
                    }
                    y -= cell + 4 * u + rows[row] + 8 * u;
                }
                if (portraits.Count != 0) StartCoroutine(LoadPortraits(portraits, epoch));
            }, "Emblem card");
        }

        // Settings, as the v3 composite draws it: the title plate, the sound card
        // (a slider per channel, whose name switches it off and back to the level
        // it had), the card of haptics, reduced motion and the text size, then the
        // identity's own actions and where preferences are kept.
        private void Settings(SettingsPageView value, string[] notices)
        {
            var kit = Kit; float d = ui.Density, u = kit.U, k = kit.K, inner = kit.Inner, row = Mathf.Max(48 * d, 52 * u);
            var pieces = new List<Piece> { kit.TitlePlate("Settings", null) };
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            float headingHeight = ui.TextHeight("SOUND", inner, 12, SkinUi.Type.Label);
            pieces.Add(kit.Card(10 * u + headingHeight + 2 * row + 6 * u, card => {
                float x = card.x + 12 * u, y = card.yMax - 10 * u;
                ui.Label("Sound heading", "SOUND", new Rect(x, y - headingHeight, inner, headingHeight), 12, SkinTokens.Text, shell.Page, SkinUi.Type.Label,
                    TextAlignmentOptions.Left);
                y -= headingHeight;
                Volume(kit, new Rect(x, y - row, inner, row), "Music", SkinSlots.IconMusic, value.Music, value.SetMusic, true);
                Volume(kit, new Rect(x, y - 2 * row, inner, row), "Effects", SkinSlots.IconSound, value.Effects, value.SetEffects, false);
            }, "Sound card"));
            pieces.Add(kit.Card(3 * row + 12 * u, card => {
                float x = card.x + 12 * u, y = card.yMax - 6 * u;
                Switch(kit, new Rect(x, y - row, inner, row), "Haptics", value.Haptics, value.ToggleHaptics, false);
                Switch(kit, new Rect(x, y - 2 * row, inner, row), "Reduced motion", value.ReducedMotion, value.ToggleMotion, true);
                var size = new Rect(x, y - 3 * row, inner, row);
                kit.Rule("Text size rule", size);
                var sizeRow = ui.Rect<Image>("Text size: " + (value.LargeText ? "larger" : "standard"), size, shell.Page);
                sizeRow.color = Color.clear; sizeRow.raycastTarget = true;
                string current = (value.LargeText ? "Larger" : "Standard") + " ›";
                float valueWidth = kit.NumeralWidth(current);
                ui.Label("Text size label", "Text size", new Rect(size.x, size.y, size.width - valueWidth - 10 * u, size.height), kit.CaptionDp, SkinTokens.Text,
                    sizeRow.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
                kit.Numeral("Text size value", current, new Rect(size.xMax - valueWidth, size.y, valueWidth, size.height), SkinTokens.Text);
                var sizeButton = sizeRow.gameObject.AddComponent<Button>(); sizeButton.transition = Selectable.Transition.None;
                sizeRow.gameObject.AddComponent<PressSquash>();
                actions.Wire(sizeButton, new PageAction { Invoke = value.ToggleText }, fade: false);
            }, "Switches card"));
            if (value.Muted) pieces.Add(Buttons((new PageAction { Label = "Unmute all sound", Invoke = value.Unmute }, false, SkinSlots.IconSound)));
            // The identity's own actions sit low, over where preferences are kept.
            pieces.Add(Piece.Grow);
            if (value.Identity.Length != 0) pieces.Add(BlockPiece("Identity settings", value.Identity, kit));
            pieces.Add(kit.Note("Preferences save on this device."));
            Compose(pieces.ToArray());
        }
        // A row whose whole width switches the kit toggle at its end; the toggle
        // shows its state.
        private void Switch(ScreenKit kit, Rect rect, string title, bool on, Action toggle, bool ruled)
        {
            if (ruled) kit.Rule(title + " rule", rect);
            ui.Label(title + " label", title, new Rect(rect.x, rect.y, rect.width - 80 * ui.Density, rect.height), kit.CaptionDp, SkinTokens.Text, shell.Page,
                SkinUi.Type.Caption, TextAlignmentOptions.Left);
            ui.Toggle(title + ": " + (on ? "on" : "off"), rect, on, _ => actions.Run(toggle), shell.Page);
        }
        // One sound channel on one row: its icon and name (a tap switches the
        // channel off and back to its last level), its slider and its level.
        private void Volume(ScreenKit kit, Rect rect, string title, string icon, double value, Action<double> set, bool music)
        {
            float d = ui.Density, u = kit.U, size = 28 * u, levelWidth = kit.NumeralWidth("100%");
            float labelWidth = ui.TextWidth("Effects", kit.CaptionDp, SkinUi.Type.Caption) + 4 * u;
            var hit = ui.Rect<Image>(title + " switch", new Rect(rect.x, rect.y, size + 10 * u + labelWidth, rect.height), shell.Page);
            hit.color = Color.clear; hit.raycastTarget = true;
            Tinted(title + " icon", icon, new Rect(rect.x, rect.center.y - size / 2, size, size), SkinTokens.Text, hit.transform);
            ui.Label(title + " label", title, new Rect(rect.x + size + 10 * u, rect.y, labelWidth, rect.height), kit.CaptionDp, SkinTokens.Text,
                hit.transform, SkinUi.Type.Caption, TextAlignmentOptions.Left);
            var level = kit.Numeral(title + " level", "", new Rect(rect.xMax - levelWidth, rect.y, levelWidth, rect.height), SkinTokens.Text);
            float trackX = rect.x + size + 10 * u + labelWidth + 8 * u;
            SkinSlider slider = null;
            Action<double> apply = next => {
                actions.Run(() => set(next)); value = next;
                if (next > 0) { if (music) lastMusic = next; else lastEffects = next; }
                level.text = next > 0 ? Math.Round(next * 100) + "%" : "Off";
                slider?.SetWithoutNotify((float)next);
            };
            slider = ui.Slider(title + " slider", new Rect(trackX, rect.center.y - 24 * d, rect.xMax - levelWidth - 10 * u - trackX, 48 * d), (float)value,
                next => apply(Math.Round(next * 100) / 100d), shell.Page);
            level.text = value > 0 ? Math.Round(value * 100) + "%" : "Off";
            var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None;
            actions.Wire(button, new PageAction { Name = title + " switch", Invoke = () => apply(value > 0 ? 0 : music ? lastMusic : lastEffects) }, fade: false);
        }
    }
}
