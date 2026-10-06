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
        // The profile, as the wireframe draws it: the title, the wearer's card
        // (the worn emblem, the player's name where the identity has one, and
        // what is worn, or the ladder standing, a tap on which chooses the
        // border; the records on its right), the three stat tiles and the
        // guardian emblems in a card, a tap on an unlocked one wearing it. The
        // identity's own lines and actions (borders, saving) follow.
        private void Profile(ProfilePageView value)
        {
            var kit = Kit;
            var pieces = new List<Piece> { kit.Title("Profile", null) };
            pieces.Add(WearerCard(value, kit));
            pieces.Add(kit.Stats(("Campaign stars", SkinSlots.StarLit, value.Stars + "/" + Protocol.Realms.Length * Protocol.CampaignTargets.Length * 3),
                ("Best Daily", SkinSlots.IconCrown, value.BestDailyScore.ToString("N0", CultureInfo.InvariantCulture)),
                ("Daily streak", SkinSlots.IconClock, Days(value.Streak))));
            if (value.Emblems.Length != 0) pieces.Add(EmblemCard(value.Emblems, kit, value.Tier == null));
            foreach (var fact in value.Facts) pieces.Add(kit.Note(fact));
            if (!string.IsNullOrEmpty(value.Notice)) pieces.Add(kit.Note(value.Notice));
            // The identity's own actions (a device to manage, saving, restoring) are quiet buttons in one row.
            var more = value.Actions.Concat(new[] { value.Save, value.Restore }).Where(action => action != null).ToArray();
            if (more.Length != 0) pieces.Add(Buttons(kit, more.Select(action => (action, ScreenKit.Kind.Quiet, (string)null)).ToArray()));
            pieces.Add(Piece.Grow);
            Compose(pieces.ToArray());
            if (value.Borders.Length != 0) column.Typed("Border heading", "BORDER", SkinUi.Type.Label, 12, SkinTokens.Accent, 10, TextAlignmentOptions.Left);
            foreach (var choice in value.Borders)
                Pill(column, new PageAction { Name = "Border " + choice.Id, Label = choice.Name + (choice.Detail == null ? "" : " · " + choice.Detail),
                    Enabled = choice.Available, CanInvoke = choice.CanSelect, Invoke = choice.Select }, false, null, 12);
        }
        // One quiet button as a row's part, as wide as its words.
        private ScreenKit.Side Quiet(ScreenKit kit, PageAction action, string icon = null)
        {
            var buttons = Buttons(kit, ScreenKit.Role.WayIn, (action, ScreenKit.Kind.Quiet, icon));
            float width = ui.TextWidth(action.Label, kit.QuietDp, SkinUi.Type.Caption) + 32 * kit.U + (icon == null ? 0 : 36 * kit.U);
            return new ScreenKit.Side(width, buttons.Height, buttons.Draw);
        }

        // The wearer: the worn emblem in its ring (72u, or 76u in the ladder
        // border where there is a ladder); the player's name where the identity
        // has one (a platform account's, led by its round avatar, or the
        // Arena's Seeker ID or address), its badge under it (a verified
        // Seeker), and under that the ladder points as a figure led by their
        // tier's badge, or without a ladder what is worn; the records on the
        // right. Every identity has a name line.
        private Piece WearerCard(ProfilePageView value, ScreenKit kit)
        {
            float u = kit.U; var inside = kit.Inside();
            float face = (value.Tier.HasValue ? Step(76, 60) : Step(72, 56)) * u;
            ScreenKit.Side? side = value.Records == null ? (ScreenKit.Side?)null : Quiet(inside, value.Records);
            float text = inside.Width - face - 12 * u - (side.HasValue ? side.Value.Width + 12 * u : 0);
            ScreenKit.Side? ladder = value.LadderPoints.HasValue ? inside.Beside(6, inside.Icon("Ladder badge", SkinSlots.LadderBadge(value.LadderTier), 20),
                inside.Value("Ladder points", NumberFit.Figure(value.LadderPoints.Value), sizeDp: inside.CaptionDp)) : (ScreenKit.Side?)null;
            float avatar = value.Avatar == null ? 0 : 24 * u, lead = avatar == 0 ? 0 : avatar + 6 * u;
            float nameHeight = Mathf.Max(avatar, inside.Block(value.Name, text - lead, inside.CaptionDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading));
            float wornHeight = ladder.HasValue ? ladder.Value.Height + 4 * u
                : inside.Block(value.Worn, text, inside.SmallDp, SkinUi.Type.Caption, ScreenKit.CaptionLeading);
            ScreenKit.Side? badge = value.Badge == null ? (ScreenKit.Side?)null : Tag(inside, value.Badge, SkinTokens.Positive, "Profile badge");
            float badgeHeight = badge.HasValue ? badge.Value.Height + 4 * u : 0;
            float block = nameHeight + badgeHeight + wornHeight;
            return kit.Card(null, new[] { new Piece(Mathf.Max(face, block), rect => {
                // Where there is a ladder, a tap on the row chooses the border.
                if (value.ChooseBorder != null)
                {
                    var hit = ui.Rect<Image>(value.ChooseBorder.Name ?? value.ChooseBorder.Label, rect, shell.Page);
                    hit.color = Color.clear; hit.raycastTarget = true;
                    var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; button.targetGraphic = hit;
                    actions.Wire(button, value.ChooseBorder, fade: false);
                }
                ui.Medallion("Worn emblem", new Rect(rect.x, rect.center.y - face / 2, face, face), EmblemArt(value.Emblem), shell.Page,
                    value.Tier.HasValue ? SkinSlots.LadderBorder(value.Tier.Value) : SkinSlots.GuardianFrame);
                float x = rect.x + face + 12 * u, top = rect.center.y + block / 2;
                if (avatar > 0)
                {
                    // The account's picture, round, as the platform shows it.
                    var round = ui.Pill("Player avatar", new Rect(x, top - nameHeight / 2 - avatar / 2, avatar, avatar), shell.Page, Color.white);
                    round.gameObject.AddComponent<Mask>().showMaskGraphic = false;
                    var picture = ui.Rect<RawImage>("Player avatar picture", SkinUi.ScreenRect(round.rectTransform), round.transform);
                    picture.texture = value.Avatar; picture.raycastTarget = false;
                }
                inside.Text("Name text", value.Name, new Rect(x + lead, top - nameHeight, text - lead, nameHeight), inside.CaptionDp, SkinTokens.Text, SkinUi.Type.Caption,
                    ScreenKit.CaptionLeading, TextAlignmentOptions.Left).textWrappingMode = TextWrappingModes.NoWrap;
                if (badge.HasValue) badge.Value.Draw(new Rect(x, top - nameHeight - badge.Value.Height - 2 * u, badge.Value.Width, badge.Value.Height));
                if (ladder.HasValue) ladder.Value.Draw(new Rect(x, top - block, ladder.Value.Width, ladder.Value.Height));
                else if (wornHeight > 0)
                    inside.Text("Worn", value.Worn, new Rect(x, top - block, text, wornHeight), inside.SmallDp,
                        SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left);
                if (side.HasValue) side.Value.Draw(new Rect(rect.xMax - side.Value.Width, rect.center.y - side.Value.Height / 2, side.Value.Width, side.Value.Height));
            }) }, "Wearer card");
        }

        // The guardian emblems in a card (.grid4): how an emblem is won, 10u
        // over the grid (where the profile has no ladder standing to show in
        // its place, as the Arena's wireframe draws it), then four across, 4u apart and rows 8u apart, each
        // emblem 56u in the guardian ring over its name ("· worn" on the worn
        // one); locked ones are dimmed with a lock and take no tap.
        private Piece EmblemCard(ProfileChoiceView[] emblems, ScreenKit kit, bool explained)
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
            var parts = new List<Piece>();
            if (explained) parts.Add(new Piece(howHeight + 6 * u, rect => inside.Text("Emblem how", how, new Rect(rect.x, rect.yMax - howHeight, rect.width, howHeight), inside.SmallDp,
                    SkinTokens.TextMuted, SkinUi.Type.Caption, ScreenKit.CaptionLeading, TextAlignmentOptions.Left)));
            parts.Add(new Piece(grid, rect => {
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
                }));
            return kit.Card("Guardian emblems", parts, "Emblem card");
        }

        // Settings: the title, the Sound card (a slider per channel, whose name
        // switches it off and back to the level it had; while everything is muted
        // its header ends with the Unmute chip), the card of haptics, reduced
        // motion, the text size and How to play, a row that replays every lesson,
        // then the identity's own cards. The identity's actions are the foot row.
        private void Settings(SettingsPageView value)
        {
            var kit = Kit; var inside = kit.Inside();
            ScreenKit.Side? unmute = null;
            if (value.Muted)
            {
                var chip = Tag(kit, "Unmute", SkinTokens.Accent, "Unmute");
                float reach = inside.Touch(44);
                unmute = new ScreenKit.Side(chip.Width, chip.Height, rect => {
                    chip.Draw(rect);
                    // The chip takes a tap over 48 dp round its face.
                    var hit = ui.Rect<Image>("Unmute tap", new Rect(rect.center.x - Mathf.Max(rect.width, reach) / 2, rect.center.y - reach / 2, Mathf.Max(rect.width, reach), reach), shell.Page);
                    hit.color = Color.clear; Tap(hit, new PageAction { Label = "Unmute", Name = "Unmute all sound", Invoke = value.Unmute }, ScreenKit.Role.CardAction);
                });
            }
            var body = new List<Piece> { kit.Card("Sound", new[] { Volume(inside, "Music", SkinSlots.IconMusic, value.Music, value.SetMusic, true, false),
                Volume(inside, "Effects", SkinSlots.IconSound, value.Effects, value.SetEffects, false, true) }, "Sound card", end: unmute) };
            string current = (value.LargeText ? "Larger" : "Standard") + " ›";
            body.Add(kit.Card(null, new[] { Switch(inside, "Haptics", value.Haptics, value.ToggleHaptics, false),
                Switch(inside, "Reduced motion", value.ReducedMotion, value.ToggleMotion, true),
                Tapped(inside.Row("Text size", null, "Text size", null, inside.Value("Text size value", current, SkinTokens.Text), true),
                    "Text size: " + (value.LargeText ? "larger" : "standard"), value.ToggleText, ScreenKit.Role.Setting),
                Tapped(inside.Row("How to play row", inside.Icon("How to play icon", SkinSlots.HandPointer, 26), "How to play", null,
                    inside.Value("How to play chevron", "›", SkinTokens.Text), true),
                    "How to play", () => Teach(Lessons.HowToPlay(brand == "arena"), null), ScreenKit.Role.WayIn) }, "Switches card"));
            if (value.Identity.Length != 0) body.Add(BlockPiece("Identity settings", value.Identity, kit));
            Place(kit, new ScreenKit.Slots { Title = kit.Title("Settings", null), Body = body, Tertiary = Control(value.Tertiary), Destructive = Control(value.Destructive) });
        }
        // A row that is one button: a tap anywhere on it runs invoke.
        private Piece Tapped(Piece row, string name, Action invoke, ScreenKit.Role role) => new Piece(row.Height, rect => {
            var face = ui.Rect<Image>(name, rect, shell.Page); face.color = Color.clear; face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; ScreenKit.As(button, role);
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
                    if (music) Music(true);
                    if (next > 0) { if (music) lastMusic = next; else lastEffects = next; }
                    level.text = next > 0 ? Math.Round(next * 100) + "%" : "Off";
                    slider?.SetWithoutNotify((float)next);
                };
                slider = ui.Slider(title + " slider", new Rect(trackX, rect.center.y - 24 * d, rect.xMax - levelWidth - 10 * u - trackX, 48 * d), (float)value,
                    next => apply(Math.Round(next * 100) / 100d), shell.Page);
                level.text = value > 0 ? Math.Round(value * 100) + "%" : "Off";
                var button = hit.gameObject.AddComponent<Button>(); button.transition = Selectable.Transition.None; ScreenKit.As(button, ScreenKit.Role.Setting);
                actions.Wire(button, new PageAction { Name = title + " switch", Invoke = () => apply(value > 0 ? 0 : music ? lastMusic : lastEffects) }, fade: false);
            });
        }
    }
}
