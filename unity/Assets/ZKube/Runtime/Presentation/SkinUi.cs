using System;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The skin component kit. Every HUD and page element is one of these pieces,
    // drawn from the active skin's UI kit and tokens and placed in screen pixels.
    // Skin art is authored at two source pixels per dp, so Ui converts authored
    // stretch borders to the screen at the current density.
    public sealed class SkinUi
    {
        public readonly BoardArt Art;
        public readonly float Density, Scale;
        public float Ui => Density / 2;
        private Sprite circle, pill;
        private Texture2D circleTexture;

        public SkinUi(BoardArt art, float density, float textScale)
        {
            Art = art ?? throw new ArgumentNullException(nameof(art));
            Density = density; Scale = textScale;
        }

        // borderScale draws a sliced piece's ends smaller than authored.
        // The type roles: Fraunces for titles, Lilita One for the board HUD's
        // display numerals and signs, Nunito for everything else, by weight.
        public enum Type { Title, Number, Label, Caption, Body, Display }
        public static string FontName(Type type) => type switch
        {
            Type.Title => "Fraunces-650", Type.Display => "LilitaOne-Regular", Type.Number => "Nunito-1000", Type.Label => "Nunito-900",
            Type.Caption => "Nunito-800", _ => "Nunito-700",
        };
        // Callers that only distinguish display text get numbers and plain text.
        private static Type Role(bool display) => display ? Type.Number : Type.Body;

        public Image Piece(string name, string slot, Rect rect, Transform parent, float borderScale = 1)
        {
            var image = Rect<Image>(name, rect, parent);
            image.sprite = Art.SkinUi(slot); image.raycastTarget = false;
            if (image.sprite.border != Vector4.zero) { image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = 1 / (Ui * borderScale); }
            else image.preserveAspect = true;
            return image;
        }

        public TMP_Text Label(string name, string value, Rect rect, float sizeDp, string token, Transform parent, bool display = false,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center) =>
            Label(name, value, rect, sizeDp, token, parent, Role(display), alignment);
        public TMP_Text Label(string name, string value, Rect rect, float sizeDp, string token, Transform parent, Type type,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center)
        {
            var text = Rect<TextMeshProUGUI>(name, rect, parent);
            text.font = Art.Font(type); text.fontSharedMaterial = Styled(text.font);
            Letter(text, type);
            text.text = value; text.fontSize = sizeDp * Density * Scale;
            text.color = Art.Token(token); text.alignment = alignment; text.raycastTarget = false;
            text.enableWordWrapping = true; text.enableAutoSizing = false; text.overflowMode = TextOverflowModes.Overflow;
            return text;
        }

        // A tablet: the glass square of a power, reroll or utility. Its face swaps
        // to the pressed art on press; the icon, drawn in light, sits centred.
        // A counted tablet (a power) wears a charge badge on its upper right and
        // lights up while charged; an empty one stays visible, unlit, badge 0.
        public SkinTablet Tablet(string name, Rect rect, string icon, Action action, Transform parent, bool counted)
        {
            var face = Rect<Image>(name, rect, parent);
            face.sprite = Art.SkinUi(SkinSlots.ButtonIcon); face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.targetGraphic = face;
            face.gameObject.AddComponent<PressSquash>().Bind(Art.SkinUi(SkinSlots.FxPress), Density);
            button.transition = Selectable.Transition.SpriteSwap;
            button.spriteState = new SpriteState { pressedSprite = Art.SkinUi(SkinSlots.ButtonIconPressed), disabledSprite = face.sprite };
            button.onClick.AddListener(() => action());
            float size = rect.width;
            Image halo = null, badgeHalo = null, badge = null;
            TMP_Text count = null;
            if (counted)
            {
                halo = Glow(name + " light", new Rect(rect.x + 4 * Density, rect.y + 4 * Density, size - 8 * Density, size - 8 * Density),
                    WithAlpha(Art.Token(SkinTokens.LightKey), .65f), face.transform, SkinTablet.BreathSeconds);
            }
            var glyph = Piece(name + " icon", icon, new Rect(rect.x + size * .24f, rect.y + size * .24f, size * .52f, size * .52f), face.transform);
            glyph.color = Art.Token(SkinTokens.Text);
            if (counted)
            {
                // The badge is 26 dp, 6 dp above the tablet and 2 dp past its right edge.
                float pip = 26 * Density;
                var badgeRect = new Rect(rect.xMax - 24 * Density, rect.yMax + 6 * Density - pip, pip, pip);
                badgeHalo = Glow(name + " badge light", new Rect(rect.xMax - 28 * Density, rect.yMax + 12 * Density - 38 * Density, 38 * Density, 38 * Density),
                    WithAlpha(Art.Token(SkinTokens.Accent), .35f), face.transform);
                badge = Piece(name + " badge", SkinSlots.Badge, badgeRect, face.transform);
                count = Label(name + " label", "", badgeRect, 14, SkinTokens.TextOnPrimary, face.transform, Type.Number);
            }
            var tablet = face.gameObject.AddComponent<SkinTablet>();
            tablet.Bind(button, glyph, halo, badgeHalo, badge, count, Art.Token(SkinTokens.TextOnPrimary), Art.Token(SkinTokens.Text));
            return tablet;
        }
        public static Color WithAlpha(Color color, float alpha) { color.a = alpha; return color;
        }
        public Button IconButton(string name, Rect rect, string icon, Action action, Transform parent, bool withCount,
            out Image glyph, out TMP_Text count)
        {
            var tablet = Tablet(name, rect, icon, action, parent, withCount);
            glyph = tablet.Icon; count = tablet.Count;
            return tablet.Button;
        }

        // A soft dark patch behind small text laid over the painting, so it reads
        // without a glowing label. rect is the text's own extent. The patch
        // reaches UnderpaintPadDp past the words and fades over UnderpaintRampDp,
        // so the fade starts under the words and no edge reads as a box.
        public const float UnderpaintPadDp = 16, UnderpaintRampDp = 24;
        public Image Underpaint(string name, Rect rect, Transform parent)
        {
            float pad = UnderpaintPadDp * Density;
            var patch = Rect<Image>(name, new Rect(rect.x - pad, rect.y - pad * .75f, rect.width + 2 * pad, rect.height + 1.5f * pad), parent);
            // The soft patch's 24 px border draws UnderpaintRampDp wide.
            patch.sprite = SoftPatch(); patch.type = Image.Type.Sliced; patch.pixelsPerUnitMultiplier = 24 / (UnderpaintRampDp * Density);
            patch.color = new Color(6 / 255f, 17 / 255f, 31 / 255f, .92f); patch.raycastTarget = false;
            return patch;
        }

        // A pill: an action with a word, and optionally a leading 24 dp icon.
        // The screens around the board set their own type, size and icon size.
        public Button TextButton(string name, Rect rect, string label, Action action, bool primary, Transform parent, out TMP_Text text,
            string icon = null, Type type = Type.Number, float sizeDp = ButtonDp, float iconDp = 24)
        {
            var face = Piece(name, primary ? SkinSlots.ButtonPrimary : SkinSlots.ButtonSecondary, rect, parent); face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.targetGraphic = face;
            face.gameObject.AddComponent<PressSquash>().Bind(Art.SkinUi(SkinSlots.FxPress), Density);
            button.transition = Selectable.Transition.SpriteSwap;
            button.spriteState = new SpriteState
            {
                pressedSprite = Art.SkinUi(primary ? SkinSlots.ButtonPrimaryPressed : SkinSlots.ButtonSecondaryPressed),
                disabledSprite = face.sprite,
            };
            button.onClick.AddListener(() => action());
            float pad = 10 * Density, lead = 0;
            string ink = primary ? SkinTokens.TextOnPrimary : SkinTokens.TextOnSecondary;
            if (icon != null)
            {
                // The icon sits 16 dp in; its word starts 6 dp after it.
                float size = iconDp * Density;
                Piece(name + " icon", icon, new Rect(rect.x + 16 * Density, rect.center.y - size / 2, size, size), face.transform).color = Art.Token(ink);
                lead = (iconDp + 12) * Density;
            }
            text = Label(name + " label", label, new Rect(rect.x + pad + lead, rect.y, rect.width - 2 * pad - lead, rect.height), sizeDp,
                ink, face.transform, type);
            return button;
        }

        // Every pill label is Nunito Black at 19 dp.
        public const float ButtonDp = 19;

        // Lights placed by code. Only live, pressable or earned things glow, so
        // a screen holds at most MaxGlows at once and at most MaxBreathing breathe.
        public const int MaxGlows = 8, MaxBreathing = 3;
        private readonly System.Collections.Generic.List<SkinGlow> glows = new System.Collections.Generic.List<SkinGlow>();
        public int LiveGlows => glows.Count;
        // tint's alpha is the glow's strength; breathSeconds 0 holds it steady.
        public Image Glow(string name, Rect rect, Color tint, Transform parent, float breathSeconds = 0)
        {
            glows.RemoveAll(glow => glow == null);
            if (glows.Count >= MaxGlows) throw new InvalidOperationException("A screen shows at most " + MaxGlows + " glows");
            if (breathSeconds > 0 && glows.Count(glow => glow.Breathing) >= MaxBreathing)
                throw new InvalidOperationException("At most " + MaxBreathing + " glows breathe on a screen");
            var image = Rect<Image>(name, rect, parent);
            image.sprite = Art.SkinUi(SkinSlots.FxGlow); image.raycastTarget = false;
            var glow = image.gameObject.AddComponent<SkinGlow>();
            glow.Registry = glows; glows.Add(glow);
            glow.Bind(image, tint, breathSeconds);
            return image;
        }

        // The guardian's dialogue box, as drawn: the box across width from top
        // down, the realm's ledge rail along its top edge, and the guardian
        // (180 dp, or narrower on small screens) leaning on the rail, its body
        // behind the rail and its paws in front. A gold name tag hangs over the
        // rail with the guardian's title beside it; the line starts 42 dp down.
        // The box grows to hold the longest page and its rule.
        public GuardianTalk Talk(string name, float x, float top, float width, PageCatalog.RealmPage realm, TalkPage[] pages, Action finished,
            Transform parent, bool hint = true)
        {
            float d = Density, inner = width - 40 * d;
            float Glyph(float fromTop, float sizeDp) => top - fromTop * d + HudLayout.DigitTop * sizeDp * Scale * d;
            // At least two lines tall, so a short line still gives a settled box.
            float lineHeight = 2 * TalkLeadingDp * Scale * d;
            foreach (var page in pages)
                if (page.Line != null) lineHeight = Mathf.Max(lineHeight, Lines(page.Line, inner, TalkLineDp, Type.Caption) * TalkLeadingDp * Scale * d);
            // A rule page: the Earn panel at size, then the rule and its effect, centred.
            var ruled = pages.FirstOrDefault(page => page.Rule != null);
            float icon = RuleIconDp * d, sentence = 0, effect = 0, ruleHeight = 0;
            if (ruled != null)
            {
                sentence = TextHeight(ruled.RuleSentence, inner, TalkLineDp, Type.Caption);
                effect = TextHeight(ruled.Rule.effect, inner, 13, Type.Caption);
                ruleHeight = icon + 12 * d + sentence + 4 * d + effect;
            }
            // The box fits its tallest page.
            float height = 42 * d + Mathf.Max(lineHeight, ruleHeight) + 32 * d;
            var box = new Rect(x, top - height, width, height);

            // The guardian leans on the ledge right of centre, clear of the name tag.
            float body = Mathf.Min(180 * d, width * .49f), rail = 14 * d;
            var frame = new Rect(box.x + width * TalkGuardianAt - body / 2, top - (1 - Art.GuardianRailY) * body, body, body);
            var guardian = Rect<Image>(name + " guardian", frame, parent);
            guardian.sprite = Art.Sprite("boss__idle"); guardian.preserveAspect = true; guardian.raycastTarget = false;
            var panel = Piece(name, SkinSlots.Dialog, box, parent); panel.raycastTarget = true;
            var ledge = Rect<Image>(name + " rail", new Rect(box.x - 2 * d, top - rail, width + 4 * d, rail), parent);
            ledge.sprite = Art.SkinRealm(SkinSlots.Ledge); ledge.type = Image.Type.Sliced; ledge.pixelsPerUnitMultiplier = 1 / Ui;
            ledge.raycastTarget = false;
            var paws = Rect<Image>(name + " paws", frame, parent);
            paws.sprite = Art.Sprite("boss__paws"); paws.preserveAspect = true; paws.raycastTarget = false;

            // The name tag breaks the box's top edge: the name, and the guardian's
            // title under it; on the rule page, what the rule earns.
            string heading = ruled?.RuleHeading ?? "";
            float nameWidth = Mathf.Max(TextWidth(realm.guardianName, TalkNameDp, Type.Display), TextWidth(heading, TalkNameDp, Type.Display));
            float tagWidth = Mathf.Min(inner, Mathf.Max(nameWidth, TextWidth(realm.guardianTitle, 12, Type.Caption)) + 24 * d);
            float nameHeight = TextHeight(realm.guardianName, tagWidth, TalkNameDp, Type.Display), titleHeight = TextHeight(realm.guardianTitle, tagWidth, 12, Type.Caption);
            var tag = new Rect(box.x + 12 * d, top + 12 * d - (nameHeight + titleHeight + 8 * d), tagWidth, nameHeight + titleHeight + 8 * d);
            Piece(name + " name tag", SkinSlots.TitlePlate, tag, parent);
            var tagName = Label(name + " name", realm.guardianName, new Rect(tag.x + 12 * d, tag.yMax - 4 * d - nameHeight, tagWidth - 24 * d, nameHeight),
                TalkNameDp, SkinTokens.Accent, parent, Type.Display, TextAlignmentOptions.Left);
            tagName.textWrappingMode = TextWrappingModes.NoWrap;
            var tagTitle = Label(name + " title", realm.guardianTitle, new Rect(tag.x + 12 * d, tag.y + 4 * d, tagWidth - 24 * d, titleHeight), 12,
                SkinTokens.TextMuted, parent, Type.Caption, TextAlignmentOptions.TopLeft);

            var text = Label(name + " line", "", new Rect(box.x + 20 * d, Glyph(42, TalkLineDp) - lineHeight - 4 * d, inner, lineHeight + 4 * d),
                TalkLineDp, SkinTokens.Text, parent, Type.Caption, TextAlignmentOptions.TopLeft);
            text.lineSpacing = LineSpacing(text.font, TalkLeadingDp / TalkLineDp);
            GameObject rules = null;
            if (ruled != null)
            {
                rules = new GameObject(name + " rule", typeof(RectTransform));
                rules.transform.SetParent(parent, false); Place((RectTransform)rules.transform, box, parent);
                float row = top - 42 * d - icon, centre = box.center.x;
                Piece(name + " rule trigger", ruled.Rule.pictogram, new Rect(centre - icon - 22 * d, row, icon, icon), rules.transform);
                if (!string.IsNullOrEmpty(ruled.Rule.chip))
                    Label(name + " rule chip", ruled.Rule.chip, new Rect(centre - icon - 26 * d, row - 4 * d, 30 * d, 18 * d), 13, SkinTokens.Text, rules.transform,
                        Type.Display).textWrappingMode = TextWrappingModes.NoWrap;
                Label(name + " rule arrow", "→", new Rect(centre - 16 * d, row, 32 * d, icon), 22, SkinTokens.TextMuted, rules.transform, Type.Caption);
                Piece(name + " rule bonus", HudLayout.BonusIcon(ruled.Rule.bonus, true), new Rect(centre + 22 * d, row, icon, icon), rules.transform);
                Label(name + " rule", ruled.RuleSentence, new Rect(box.x + 20 * d, row - 12 * d - sentence, inner, sentence), TalkLineDp, SkinTokens.Text,
                    rules.transform, Type.Caption);
                Label(name + " rule effect", ruled.Rule.effect, new Rect(box.x + 20 * d, row - 12 * d - sentence - 4 * d - effect, inner, effect), 13,
                    SkinTokens.TextMuted, rules.transform, Type.Caption);
            }
            var cue = Label(name + " continue", "▼", new Rect(box.xMax - 36 * d, box.y + 8 * d, 20 * d, 20 * d), 10, SkinTokens.Text, parent, Type.Body);
            // The hint shares the box's bottom band with the ▼, inside the box,
            // so nothing the page draws beneath can meet it.
            if (hint)
                Label(name + " hint", TapHint, new Rect(box.x + 20 * d, box.y + 8 * d, box.xMax - 42 * d - (box.x + 20 * d), 20 * d), 12,
                    SkinTokens.TextMuted, parent, Type.Caption, TextAlignmentOptions.Right);

            var talk = panel.gameObject.AddComponent<GuardianTalk>();
            talk.Bind(Art, guardian, text, tagName, tagTitle, rules, cue, pages, finished);
            return talk;
        }
        // The guardian stands at this share of the box's width; the rule's pictograms are 56 dp; the name 20 dp.
        public const float TalkGuardianAt = .64f, RuleIconDp = 56, TalkNameDp = 20;
        public const string TapHint = "Tap to continue";
        // The dialogue line is 17 dp on a 24 dp leading, as drawn.
        public const float TalkLineDp = 17, TalkLeadingDp = 24;

        // A round portrait or emblem in a ring: the skin's guardian ring, or a
        // ladder tier's border (SkinSlots.LadderBorder) around a worn emblem.
        // Portraits and emblems are painted for the ring's opening, a centred
        // circle 232/320 of the frame, so they are drawn at the ring's size and
        // clipped there; the ring is drawn last.
        public Image Medallion(string name, Rect rect, Sprite portrait, Transform parent, string ring = SkinSlots.GuardianFrame)
        {
            float opening = rect.width * 232f / 320f;
            var clip = Rect<Image>(name + " clip", new Rect(rect.center.x - opening / 2, rect.center.y - opening / 2, opening, opening), parent);
            clip.sprite = Circle(); clip.raycastTarget = false;
            clip.gameObject.AddComponent<Mask>().showMaskGraphic = false;
            var image = Rect<Image>(name, rect, clip.transform);
            image.sprite = portrait; image.preserveAspect = true; image.raycastTarget = false;
            Piece(name + " frame", ring, rect, parent);
            return image;
        }

        // An earned star uses star-on, or star-big once drawn larger than star-on's
        // own pixels, so a star is never upscaled; an unearned star uses star-off.
        public Sprite StarSprite(bool earned, float heightPixels)
        {
            if (!earned) return Art.SkinUi(SkinSlots.StarOff);
            var small = Art.SkinUi(SkinSlots.StarOn);
            return heightPixels > small.rect.height ? Art.SkinUi(SkinSlots.StarBig) : small;
        }
        public Image Star(string name, Rect rect, bool earned, Transform parent)
        {
            var image = Rect<Image>(name, rect, parent);
            image.sprite = StarSprite(earned, rect.height); image.preserveAspect = true; image.raycastTarget = false;
            return image;
        }

        // A card: the skin panel with an optional heading. Content belongs inside
        // CardInset of its edges, clear of the panel's corner leaves.
        public float CardInset => 28 * Density;
        public Image Card(string name, Rect rect, string heading, Transform parent, out TMP_Text title)
        {
            var panel = Piece(name, SkinSlots.Panel, rect, parent);
            title = null;
            if (heading == null) return panel;
            float width = rect.width - 2 * CardInset, height = TextHeight(heading, width, 17, true);
            title = Label(name + " heading", heading, new Rect(rect.x + CardInset, rect.yMax - CardInset - height, width, height), 17,
                SkinTokens.Accent, panel.transform, true);
            return panel;
        }

        // A list row: an optional icon and a label on the left, an optional value on
        // the right. A row with an action is one button.
        public Image ListRow(string name, Rect rect, string icon, string label, string value, Action action, Transform parent,
            out TMP_Text labelText, out TMP_Text valueText)
        {
            var row = Piece(name, SkinSlots.ListRow, rect, parent);
            if (action != null)
            {
                row.raycastTarget = true;
                row.gameObject.AddComponent<Button>().onClick.AddListener(() => action());
                row.gameObject.AddComponent<PressSquash>().Bind(Art.SkinUi(SkinSlots.FxPress), Density);
            }
            float pad = 16 * Density, x = rect.x + pad, right = rect.xMax - pad;
            if (icon != null)
            {
                float size = Mathf.Min(rect.height - 16 * Density, 32 * Density);
                Piece(name + " icon", icon, new Rect(x, rect.center.y - size / 2, size, size), row.transform);
                x += size + 10 * Density;
            }
            valueText = null;
            if (value != null)
            {
                float width = Mathf.Min(TextWidth(value, 15, true), (right - x) / 2);
                valueText = Label(name + " value", value, new Rect(right - width, rect.y, width, rect.height), 15, SkinTokens.Objective,
                    row.transform, true, TextAlignmentOptions.Right);
                right -= width + 8 * Density;
            }
            labelText = Label(name + " label", label, new Rect(x, rect.y, right - x, rect.height), 14, SkinTokens.Text, row.transform, false,
                TextAlignmentOptions.Left);
            return row;
        }

        // A slider across rect, which takes the touches (keep it at least 48 dp tall).
        public SkinSlider Slider(string name, Rect rect, float value, Action<float> changed, Transform parent)
        {
            var hit = Rect<Image>(name, rect, parent); hit.color = Color.clear; hit.raycastTarget = true;
            float knob = Mathf.Min(rect.height, 32 * Density), bar = 16 * Density;
            var track = new Rect(rect.x + knob / 2, rect.center.y - bar / 2, rect.width - knob, bar);
            Piece(name + " track", SkinSlots.SliderTrack, track, hit.transform);
            var clip = Rect<RectMask2D>(name + " fill", track, hit.transform);
            Piece(name + " fill bar", SkinSlots.SliderFill, track, clip.transform);
            var handle = Piece(name + " knob", SkinSlots.SliderKnob, new Rect(track.x, track.center.y - knob / 2, knob, knob), hit.transform);
            var slider = hit.gameObject.AddComponent<SkinSlider>();
            slider.Bind(track, clip.rectTransform, handle.rectTransform, value, changed);
            return slider;
        }

        // An on/off switch at the right end of rect, which takes the taps.
        public SkinToggle Toggle(string name, Rect rect, bool value, Action<bool> changed, Transform parent)
        {
            var hit = Rect<Image>(name, rect, parent); hit.color = Color.clear; hit.raycastTarget = true;
            float height = Mathf.Min(rect.height, 32 * Density), inset = 4 * Density;
            var track = new Rect(rect.xMax - 2 * height, rect.center.y - height / 2, 2 * height, height);
            Piece(name + " track", SkinSlots.ToggleTrack, track, hit.transform);
            var on = Piece(name + " on", SkinSlots.SliderFill, new Rect(track.x + inset, track.y + inset, track.width - 2 * inset, track.height - 2 * inset),
                hit.transform);
            var knob = Piece(name + " knob", SkinSlots.ToggleKnob, new Rect(track.x, track.y, height, height), hit.transform);
            var toggle = hit.gameObject.AddComponent<SkinToggle>();
            toggle.Bind(track, on, knob.rectTransform, value, changed);
            return toggle;
        }

        // The bottom tab bar, ornaments included, sits inside the side gutters and
        // above the bottom of the safe area. Pages end their scroll area at its yMax.
        // A tab label as drawn: 11 dp words centred 42 dp down a 58 dp chip,
        // never below 9 dp. Four tabs share the bar, so the selected chip's round
        // ends draw at half their kit size, as the composites draw them.
        public const float TabLabelDp = 11, TabLabelMinimumDp = 9, TabLabelLine = 42f / 58, TabChipBorder = .5f;
        // A chip's width less its round ends, the selected chip's slice borders.
        public float TabLabelRoom(float chipWidth)
        {
            var border = Art.SkinUi(SkinSlots.TabSelected).border;
            return chipWidth - (border.x + border.z) * Ui * TabChipBorder;
        }
        public Rect TabBarRect(Rect safeArea) =>
            new Rect(safeArea.x + 16 * Density, safeArea.y + 8 * Density, safeArea.width - 32 * Density, 72 * Density);

        // A bottom tab bar with equal tabs, each an icon over its label.
        public SkinTabBar TabBar(string name, Rect safeArea, (string icon, string label, Action action)[] tabs, int selected, Transform parent)
        {
            if (tabs == null || tabs.Length == 0) throw new ArgumentException("A tab bar needs tabs", nameof(tabs));
            var rect = TabBarRect(safeArea);
            var bar = Piece(name, SkinSlots.TabBar, rect, parent);
            // Tabs keep clear of the scroll ornaments at both ends.
            float pad = 20 * Density, width = (rect.width - 2 * pad) / tabs.Length;
            var cells = new Rect[tabs.Length];
            for (int i = 0; i < tabs.Length; i++) cells[i] = new Rect(rect.x + pad + i * width, rect.y + 6 * Density, width, rect.height - 12 * Density);
            var plate = Piece(name + " selected", SkinSlots.TabSelected, cells[0], bar.transform, TabChipBorder);
            var icons = new Image[tabs.Length]; var labels = new TMP_Text[tabs.Length];
            // Every label stays clear of the chip's painted round ends, shrinking
            // together toward the Label floor only when a word needs it.
            float room = TabLabelRoom(width), labelDp = TabLabelDp;
            // The floor is the drawn size, so larger text stops at the same 9 dp.
            while (labelDp > TabLabelMinimumDp / Scale && tabs.Any(tab => TextWidth(tab.label, labelDp, Type.Caption) > room))
                labelDp = Mathf.Max(labelDp - .25f, TabLabelMinimumDp / Scale);
            for (int i = 0; i < tabs.Length; i++)
            {
                var (icon, label, action) = tabs[i];
                var cell = cells[i];
                var hit = Rect<Image>(name + " " + label, cell, bar.transform); hit.color = Color.clear; hit.raycastTarget = true;
                hit.gameObject.AddComponent<Button>().onClick.AddListener(() => action());
                float size = cell.height * .45f;
                icons[i] = Piece(name + " " + label + " icon", icon, new Rect(cell.center.x - size / 2, cell.yMax - 4 * Density - size, size, size), hit.transform);
                // The capitals centre on the chip's label line, clear of its lip.
                float height = TextHeight(label, room, labelDp, Type.Caption), line = cell.yMax - TabLabelLine * cell.height;
                labels[i] = Label(name + " " + label + " label", label, new Rect(cell.center.x - room / 2, line - height / 2, room, height), labelDp, SkinTokens.Text,
                    hit.transform, Type.Caption);
                labels[i].textWrappingMode = TextWrappingModes.NoWrap;
            }
            var tabBar = bar.gameObject.AddComponent<SkinTabBar>();
            tabBar.Bind(cells, plate.rectTransform, selected, icons, labels, Art.Token(SkinTokens.TextOnPrimary), Art.Token(SkinTokens.Text));
            return tabBar;
        }

        public T Rect<T>(string name, Rect rect, Transform parent) where T : Component
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(T));
            go.transform.SetParent(parent, false);
            Place(go.GetComponent<RectTransform>(), rect, parent);
            return go.GetComponent<T>();
        }

        public float TextHeight(string value, float width, float sizeDp, bool display) => TextHeight(value, width, sizeDp, Role(display));
        public float TextHeight(string value, float width, float sizeDp, Type type) => TextHeight(value, width, sizeDp, type, 0);
        // Leading, in em, measures text drawn with that line advance; zero keeps the font's.
        public float TextHeight(string value, float width, float sizeDp, Type type, float leading)
        {
            var probe = Probe(type, sizeDp);
            if (leading > 0) probe.lineSpacing = LineSpacing(probe.font, leading);
            try { return Mathf.Ceil(probe.GetPreferredValues(value, width, float.PositiveInfinity).y) + 2 * Density; }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        public float TextWidth(string value, float sizeDp, bool display) => TextWidth(value, sizeDp, Role(display));
        public float TextWidth(string value, float sizeDp, Type type)
        {
            var probe = Probe(type, sizeDp);
            try { return Mathf.Ceil(probe.GetPreferredValues(value, float.PositiveInfinity, float.PositiveInfinity).x) + 2 * Density; }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        // How many lines value wraps to at width.
        public int Lines(string value, float width, float sizeDp, Type type)
        {
            // Preferred height is one line box plus one line advance per extra line.
            var probe = Probe(type, sizeDp);
            try
            {
                var face = probe.font.faceInfo;
                float em = probe.fontSize / face.pointSize, first = (face.ascentLine - face.descentLine) * em, advance = face.lineHeight * em;
                float height = probe.GetPreferredValues(value, width, float.PositiveInfinity).y;
                return Mathf.Max(1, 1 + Mathf.RoundToInt((height - first) / advance));
            }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        // Labels are capitals with +9% tracking, as the type spec sets them.
        public const float LabelTracking = 9;
        private static void Letter(TMP_Text text, Type type)
        {
            if (type != Type.Label) return;
            text.fontStyle |= FontStyles.UpperCase; text.characterSpacing = LabelTracking;
        }
        // The extra spacing that makes a line advance leading em, in TMP's units.
        public static float LineSpacing(TMP_FontAsset font, float leading) =>
            (leading - font.faceInfo.lineHeight / font.faceInfo.pointSize) * 100;
        private TextMeshProUGUI Probe(Type type, float sizeDp)
        {
            var go = new GameObject("Temporary TMP layout measurement", typeof(RectTransform), typeof(TextMeshProUGUI));
            go.hideFlags = HideFlags.HideAndDontSave;
            var text = go.GetComponent<TextMeshProUGUI>();
            text.enableAutoSizing = false; text.enableWordWrapping = true;
            text.font = Art.Font(type); text.fontSize = sizeDp * Density * Scale;
            Letter(text, type);
            return text;
        }

        // Game text gets a soft shadow, never an outline or a glow. One shared
        // material per font keeps text batched.
        private readonly System.Collections.Generic.Dictionary<TMP_FontAsset, Material> styles =
            new System.Collections.Generic.Dictionary<TMP_FontAsset, Material>();
        private Material Styled(TMP_FontAsset font)
        {
            if (styles.TryGetValue(font, out var material)) return material;
            material = new Material(font.material) { name = font.name + " game style" };
            material.SetFloat(ShaderUtilities.ID_OutlineWidth, 0);
            material.EnableKeyword(ShaderUtilities.Keyword_Underlay);
            material.SetColor(ShaderUtilities.ID_UnderlayColor, new Color(0, .02f, .05f, .55f));
            material.SetFloat(ShaderUtilities.ID_UnderlayOffsetY, -.6f);
            material.SetFloat(ShaderUtilities.ID_UnderlaySoftness, .35f);
            material.SetFloat(ShaderUtilities.ID_UnderlayDilate, .1f);
            styles.Add(font, material);
            return material;
        }

        private Sprite softPatch;
        private Texture2D softPatchTexture;
        // A rounded patch whose edge fades over its outer 24 of 64 pixels.
        private Sprite SoftPatch()
        {
            if (softPatch != null) return softPatch;
            const int size = 64, edge = 24;
            softPatchTexture = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < size; y++) for (int x = 0; x < size; x++)
            {
                float dx = Mathf.Max(0, Mathf.Abs(x + .5f - size / 2f) - (size / 2f - edge));
                float dy = Mathf.Max(0, Mathf.Abs(y + .5f - size / 2f) - (size / 2f - edge));
                float t = Mathf.Clamp01(1 - Mathf.Sqrt(dx * dx + dy * dy) / edge);
                softPatchTexture.SetPixel(x, y, new Color(1, 1, 1, t * t * (3 - 2 * t)));
            }
            softPatchTexture.Apply();
            return softPatch = Sprite.Create(softPatchTexture, new Rect(0, 0, size, size), Vector2.one / 2, 100, 0, SpriteMeshType.FullRect,
                new Vector4(edge, edge, edge, edge));
        }

        // The dark pill behind the HUD's star crown, rounded at half its height.
        // A code stand-in until the kit paints the crown pill.
        public Image Pill(string name, Rect rect, Transform parent, Color? color = null)
        {
            var image = Rect<Image>(name, rect, parent);
            Circle();
            if (pill == null) pill = Sprite.Create(circleTexture, new Rect(0, 0, 128, 128), Vector2.one / 2, 100, 0, SpriteMeshType.FullRect, Vector4.one * 63);
            image.sprite = pill; image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = 128 / rect.height;
            image.color = color ?? new Color(6 / 255f, 18 / 255f, 27 / 255f, .72f); image.raycastTarget = false;
            return image;
        }
        private Sprite Circle()
        {
            if (circle != null) return circle;
            const int size = 128;
            circleTexture = new Texture2D(size, size, TextureFormat.RGBA32, false);
            for (int y = 0; y < size; y++) for (int x = 0; x < size; x++)
            {
                float distance = Vector2.Distance(new Vector2(x + .5f, y + .5f), Vector2.one * size / 2);
                circleTexture.SetPixel(x, y, new Color(1, 1, 1, Mathf.Clamp01(size / 2f - distance)));
            }
            circleTexture.Apply();
            return circle = Sprite.Create(circleTexture, new Rect(0, 0, size, size), Vector2.one / 2, 100);
        }

        public void Dispose()
        {
            foreach (var material in styles.Values) UnityEngine.Object.Destroy(material);
            styles.Clear();
            if (circle != null) UnityEngine.Object.Destroy(circle);
            if (pill != null) UnityEngine.Object.Destroy(pill);
            if (circleTexture != null) UnityEngine.Object.Destroy(circleTexture);
            if (softPatch != null) UnityEngine.Object.Destroy(softPatch);
            if (softPatchTexture != null) UnityEngine.Object.Destroy(softPatchTexture);
        }

        public static void Place(RectTransform target, Rect screen, Transform parent)
        {
            target.anchorMin = target.anchorMax = Vector2.zero; target.pivot = Vector2.zero;
            target.anchoredPosition = screen.position - FrameOf(parent); target.sizeDelta = screen.size;
        }
        private static Vector2 FrameOf(Transform parent)
        {
            if (parent == null || !(parent is RectTransform rect)) return Vector2.zero;
            var corners = new Vector3[4]; rect.GetWorldCorners(corners); return corners[0];
        }
        public static Rect ScreenRect(RectTransform rect)
        {
            var corners = new Vector3[4]; rect.GetWorldCorners(corners);
            return new Rect(corners[0], corners[2] - corners[0]);
        }
    }
}
