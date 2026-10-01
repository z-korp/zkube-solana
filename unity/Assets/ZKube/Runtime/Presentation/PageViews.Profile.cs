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

        // The profile, as the wireframe draws it: the title, the wearer's card
        // (the worn emblem, the name, edited in place where the identity allows
        // it, and what is worn, or the ladder standing, a tap on which chooses
        // the border; Edit name or the records on its right), the three stat
        // tiles and the guardian emblems in a card. The identity's own lines
        // and actions (borders, saving) follow.
        private void Profile(ProfilePageView value, string[] notices)
        {
            var kit = Kit;
            if (value.ChangeName == null) editingName = false;
            if (savedName != value.Name) { savedName = value.Name; editedName = value.Name; }
            var pieces = new List<Piece> { kit.Title("Profile", null) };
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            pieces.Add(WearerCard(value, kit));
            if (editingName) { Compose(pieces.ToArray()); NameEditor(value); return; }
            pieces.Add(kit.Stats(("Campaign stars", SkinSlots.StarLit, value.Stars + "/" + Protocol.Realms.Length * Protocol.CampaignTargets.Length * 3),
                ("Best Daily", SkinSlots.IconCrown, value.BestDailyScore.ToString("N0", CultureInfo.InvariantCulture)),
                ("Daily streak", SkinSlots.IconClock, Days(value.Streak))));
            if (value.Emblems.Length != 0) pieces.Add(EmblemCard(value.Emblems, kit));
            foreach (var fact in value.Facts) pieces.Add(kit.Note(fact));
            if (!string.IsNullOrEmpty(value.Notice)) pieces.Add(kit.Note(value.Notice));
            pieces.Add(Piece.Grow);
            Compose(pieces.ToArray());
            foreach (var action in value.Actions) Pill(column, action, false, null, 12);
            if (value.Borders.Length != 0) column.Typed("Border heading", "BORDER", SkinUi.Type.Label, 12, SkinTokens.Accent, 10, TextAlignmentOptions.Left);
            foreach (var choice in value.Borders)
                Pill(column, new PageAction { Name = "Border " + choice.Id, Label = choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                    Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select }, false, null, 12);
            Pill(column, value.Save, false, null, 12); Pill(column, value.Restore, false, null, 12);
        }
        // One quiet button as a row's part, as wide as its words.
        private ScreenKit.Side Quiet(ScreenKit kit, PageAction action, string icon = null)
        {
            var buttons = Buttons(kit, (action, ScreenKit.Kind.Quiet, icon));
            float width = ui.TextWidth(action.Label, kit.QuietDp, SkinUi.Type.Caption) + 32 * kit.U + (icon == null ? 0 : 36 * kit.U);
            return new ScreenKit.Side(width, buttons.Height, buttons.Draw);
        }

        // The wearer: the worn emblem in its ring (72u, or 76u in the ladder
        // border where there is a ladder), the name, or its field while
        // editing, and what is worn; Edit name or the records on the right.
        private Piece WearerCard(ProfilePageView value, ScreenKit kit)
        {
            float d = ui.Density, u = kit.U; var inside = kit.Inside();
            float face = (value.Tier.HasValue ? Step(76, 60) : Step(72, 56)) * u;
            var edit = value.ChangeName == null ? null
                : new PageAction { Name = "Edit name", Label = "Edit name", Invoke = () => { editingName = true; editedName = value.Name; Redraw(); } };
            var action = editingName ? null : edit ?? value.Records;
            ScreenKit.Side? side = action == null ? (ScreenKit.Side?)null : Quiet(inside, action);
            float text = inside.Width - face - 12 * u - (side.HasValue ? side.Value.Width + 12 * u : 0);
            string worn = value.Standing ?? value.Worn;
            float nameHeight = editingName ? 48 * d : inside.Block(value.Name, text, inside.CaptionDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            float wornHeight = inside.Block(worn, text, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            return kit.Card(null, new[] { new Piece(Mathf.Max(face, nameHeight + wornHeight), rect => {
                // Where there is a ladder, a tap on the row chooses the border.
                if (value.ChooseBorder != null && !editingName)
                {
                    var hit = ui.Rect<Image>(value.ChooseBorder.Name ?? value.ChooseBorder.Label, rect, shell.Page);
                    hit.color = Color.clear; hit.raycastTarget = true;
                    var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                    actions.Wire(button, value.ChooseBorder, fade: false);
                }
                ui.Medallion("Worn emblem", new Rect(rect.x, rect.center.y - face / 2, face, face), EmblemArt(value.Emblem), shell.Page,
                    value.Tier.HasValue ? SkinSlots.LadderBorder(value.Tier.Value) : SkinSlots.GuardianFrame);
                float x = rect.x + face + 12 * u, top = rect.center.y + (nameHeight + wornHeight) / 2;
                var nameRect = new Rect(x, top - nameHeight, text, nameHeight);
                if (editingName) NameField(nameRect);
                else inside.Text("Name text", value.Name, nameRect, inside.CaptionDp, SkinTokens.Text, SkinUi.Type.Caption, ScreenKit.CaptionLeading,
                    TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
                if (wornHeight > 0)
                    inside.Text(value.Standing != null ? "Standing line" : "Worn", worn, new Rect(x, top - nameHeight - wornHeight, text, wornHeight), inside.SmallDp,
                        SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
                if (side.HasValue) side.Value.Draw(new Rect(rect.xMax - side.Value.Width, rect.center.y - side.Value.Height / 2, side.Value.Width, side.Value.Height));
            }) }, "Wearer card");
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

        // The guardian emblems in a card (.grid4): how an emblem is won, 10u
        // over the grid, then four across, 4u apart and rows 8u apart, each
        // emblem 56u in the guardian ring over its name ("· worn" on the worn
        // one); locked ones are dimmed with a lock and take no tap.
        private Piece EmblemCard(ProfileChoiceView[] emblems, ScreenKit kit)
        {
            float u = kit.U, k = kit.K; var inside = kit.Inside();
            float cell = 56 * u, nameDp = Mathf.Max(11, 10.5f * k);
            const string how = "Win a guardian’s final trial to earn its emblem.";
            float howHeight = inside.Block(how, inside.Width, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            int across = 4; float pitch = (inside.Width - 3 * 4 * u) / across;
            string Name(ProfileChoiceView choice) => choice.Detail == null ? choice.Name : choice.Name + " · " + choice.Detail.ToLowerInvariant();
            var rows = Enumerable.Range(0, (emblems.Length + across - 1) / across).Select(row => emblems.Skip(row * across).Take(across)
                .Max(choice => inside.Block(Name(choice), pitch, nameDp, SkinUi.Type.Caption, 1.15f))).ToArray();
            float grid = rows.Sum(label => cell + 2 * u + label) + (rows.Length - 1) * 8 * u;
            return kit.Card("Guardian emblems", new[] {
                new Piece(howHeight + 6 * u, rect => inside.Text("Emblem how", how, new Rect(rect.x, rect.yMax - howHeight, rect.width, howHeight), inside.SmallDp,
                    SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left)),
                new Piece(grid, rect => {
                    float y = rect.yMax;
                    var portraits = new List<KeyValuePair<byte, Image>>();
                    for (int row = 0; row < rows.Length; row++)
                    {
                        for (int i = 0; i < across && row * across + i < emblems.Length; i++)
                        {
                            var choice = emblems[row * across + i];
                            float cx = rect.x + i * (pitch + 4 * u) + pitch / 2;
                            var face = new Rect(cx - cell / 2, y - cell, cell, cell);
                            var hit = ui.Rect<Image>("Emblem " + choice.Id, new Rect(cx - pitch / 2, y - cell - 2 * u - rows[row], pitch, cell + 2 * u + rows[row]), shell.Page);
                            hit.color = Color.clear; hit.raycastTarget = choice.Available;
                            // A locked emblem dims its face only; its name stays readable.
                            var faceGroup = Holder("Emblem " + choice.Id + " face", shell.ScreenArea, hit.transform);
                            faceGroup.gameObject.AddComponent<CanvasGroup>().alpha = choice.Available ? 1 : .32f;
                            var image = ui.Medallion(choice.Realm != 0 ? "Guardian portrait" : "Achievement emblem", face,
                                choice.Realm != 0 ? null : ui.Art.SkinUi(ProfileEmblems.Painting(choice.Id)), faceGroup);
                            if (choice.Realm != 0) { image.enabled = false; portraits.Add(new KeyValuePair<byte, Image>(choice.Realm, image)); }
                            inside.Text("Emblem " + choice.Id + " name", Name(choice), new Rect(cx - pitch / 2, y - cell - 2 * u - rows[row], pitch, rows[row]), nameDp,
                                choice.Detail != null ? SkinTokens.Accent : choice.Available ? SkinTokens.Text : SkinTokens.TextMuted, SkinUi.Type.Caption, 1.15f,
                                TextAlignmentOptions.Top, hit.transform);
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
                        y -= cell + 2 * u + rows[row] + 8 * u;
                    }
                    if (portraits.Count != 0) StartCoroutine(LoadPortraits(portraits, epoch));
                }) }, "Emblem card");
        }

        // Settings, as the wireframe draws it: the title, the Sound card (a
        // slider per channel, whose name switches it off and back to the level
        // it had), the card of haptics, reduced motion and the text size, then
        // the identity's own actions and where preferences are kept.
        private void Settings(SettingsPageView value, string[] notices)
        {
            var kit = Kit; var inside = kit.Inside();
            var pieces = new List<Piece> { kit.Title("Settings", null) };
            foreach (var notice in notices) pieces.Add(kit.Note(notice));
            pieces.Add(kit.Card("Sound", new[] { Volume(inside, "Music", SkinSlots.IconMusic, value.Music, value.SetMusic, true, false),
                Volume(inside, "Effects", SkinSlots.IconSound, value.Effects, value.SetEffects, false, true) }, "Sound card"));
            string current = (value.LargeText ? "Larger" : "Standard") + " ›";
            pieces.Add(kit.Card(null, new[] { Switch(inside, "Haptics", value.Haptics, value.ToggleHaptics, false),
                Switch(inside, "Reduced motion", value.ReducedMotion, value.ToggleMotion, true),
                Tapped(inside.Row("Text size", null, "Text size", null, inside.Value("Text size value", current, SkinTokens.Text), true),
                    "Text size: " + (value.LargeText ? "larger" : "standard"), value.ToggleText) }, "Switches card"));
            if (value.Muted) pieces.Add(Buttons(kit, (new PageAction { Label = "Unmute all sound", Invoke = value.Unmute }, ScreenKit.Kind.Quiet, SkinSlots.IconSound)));
            // The identity's own actions are quiet buttons over where preferences are kept.
            if (value.Identity.Length != 0)
                pieces.Add(value.Identity.All(block => block.Kind == PanelKind.Button)
                    ? Buttons(kit, value.Identity.Select(block => (block.Action, block.Primary == 0 ? ScreenKit.Kind.Primary : ScreenKit.Kind.Quiet, block.Sprite)).ToArray())
                    : BlockPiece("Identity settings", value.Identity, kit));
            pieces.Add(kit.Note("Preferences save on this device."));
            pieces.Add(Piece.Grow);
            Compose(pieces.ToArray());
        }
        // A row that is one button: a tap anywhere on it runs invoke.
        private Piece Tapped(Piece row, string name, Action invoke) => new Piece(row.Height, rect => {
            var face = ui.Rect<Image>(name, rect, shell.Page); face.color = Color.clear; face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None;
            face.gameObject.AddComponent<PressSquash>();
            actions.Wire(button, new PageAction { Invoke = invoke }, fade: false);
            row.Draw(rect);
        });
        // A row whose whole width switches the kit toggle at its end; the toggle shows its state.
        private Piece Switch(ScreenKit inside, string title, bool on, Action toggle, bool ruled)
        {
            var row = inside.Row(title, null, title, null, new ScreenKit.Side(52 * inside.U, 26 * inside.U, _ => { }), ruled);
            return new Piece(row.Height, rect => {
                row.Draw(rect);
                ui.Toggle(title + ": " + (on ? "on" : "off"), rect, on, _ => actions.Run(toggle), shell.Page);
            });
        }
        // One sound channel on one row (.row3): its icon and name (a tap
        // switches the channel off and back to its last level), its 120u slider
        // and its level.
        private Piece Volume(ScreenKit inside, string title, string icon, double value, Action<double> set, bool music, bool ruled)
        {
            float d = ui.Density, u = inside.U, size = 26 * u, levelWidth = ui.TextWidth("100%", inside.NumeralDp, SkinUi.Type.Display);
            float labelWidth = ui.TextWidth("Effects", inside.CaptionDp, SkinUi.Type.Caption) + 4 * u;
            return new Piece(inside.Touch(50), rect => {
                if (ruled) inside.Rule(title + " rule", rect);
                var hit = ui.Rect<Image>(title + " switch", new Rect(rect.x, rect.y, size + 10 * u + labelWidth, rect.height), shell.Page);
                hit.color = Color.clear; hit.raycastTarget = true;
                Tinted(title + " icon", icon, new Rect(rect.x, rect.center.y - size / 2, size, size), SkinTokens.Text, hit.transform);
                inside.Text(title + " label", title, new Rect(rect.x + size + 10 * u, rect.center.y - inside.CaptionDp * ui.Scale * d * .6f, labelWidth,
                    inside.CaptionDp * ui.Scale * d * 1.2f), inside.CaptionDp, SkinTokens.Text, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left,
                    hit.transform);
                var level = inside.Text(title + " level", "", new Rect(rect.xMax - levelWidth, rect.y, levelWidth, rect.height), inside.NumeralDp, SkinTokens.Text,
                    SkinUi.Type.Display, 1, TextAlignmentOptions.Right);
                level.textWrappingMode = TextWrappingModes.NoWrap;
                float trackX = Mathf.Max(rect.x + size + 10 * u + labelWidth + 8 * u, rect.xMax - levelWidth - 10 * u - 120 * u);
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
            });
        }
    }
}
