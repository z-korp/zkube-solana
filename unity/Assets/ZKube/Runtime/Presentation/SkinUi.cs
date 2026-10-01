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

        // The guardian's dialogue box (.talkbox), as the wireframe draws it: the
        // box across width from top, padded 26u over 16u and 14u under, its line
        // 16u at 1.35, the ▼ and the tap hint at 12u in its bottom band. The
        // guardian (220u, 170u on a compact phone) stands right, 4u in from the
        // box's edge, its rail line on the realm's ledge along the box's top,
        // its body behind and its paws in front. The name tag breaks the top
        // edge 14u in: the name, and the guardian's title beside it. u is the
        // screen's (ScreenKit.U). The box grows to hold the longest page and
        // its rule.
        public GuardianTalk Talk(string name, float x, float top, float width, float u, PageCatalog.RealmPage realm, TalkPage[] pages, Action finished,
            Transform parent, bool hint = true)
        {
            float d = Density, k = u / d, pad = 16 * u, inner = width - 2 * pad, lineDp = 16 * k, cueDp = 12 * k, tagDp = 18 * k, titleDp = 11 * k;
            float Leading(float sizeDp, float leading) => sizeDp * Scale * d * leading;
            float cueHeight = Leading(cueDp, 1.364f);
            // At least two lines tall, so a short line still gives a settled box.
            float LineBlock(string line) => Mathf.Max(2, Lines(line, inner, lineDp, Type.Caption)) * Leading(lineDp, TalkLeading);
            float lineHeight = pages.Where(page => page.Line != null).Select(page => LineBlock(page.Line)).DefaultIfEmpty(LineBlock("")).Max();
            // A rule page: the Earn panel at size, then the rule and its effect, centred.
            var ruled = pages.FirstOrDefault(page => page.Rule != null);
            float icon = RuleIconU * u, sentence = 0, effect = 0, ruleHeight = 0;
            if (ruled != null)
            {
                sentence = Lines(ruled.RuleSentence, inner, lineDp, Type.Caption) * Leading(lineDp, TalkLeading);
                effect = Lines(ruled.Rule.effect, inner, 13 * k, Type.Caption) * Leading(13 * k, TalkLeading);
                ruleHeight = 4 * u + icon + 8 * u + sentence + 4 * u + effect;
            }
            // The box fits its first page; a taller page grows it upward from its bottom.
            float Height(TalkPage page) => 26 * u + (page.Rule != null ? ruleHeight : LineBlock(page.Line)) + 8 * u + cueHeight + 14 * u;
            var heights = pages.Select(Height).ToArray();
            float height = heights[0];
            var box = new Rect(x, top - height, width, height);

            float body = Mathf.Min((k > .95f ? 220 : 170) * u, width * .65f), rail = 14 * d;
            var frame = new Rect(box.xMax - 4 * u - body, top - (1 - Art.GuardianRailY) * body, body, body);
            var guardian = Rect<Image>(name + " guardian", frame, parent);
            guardian.sprite = Art.Sprite("boss__idle"); guardian.preserveAspect = true; guardian.raycastTarget = false;
            var panel = Piece(name, SkinSlots.Dialog, box, parent); panel.raycastTarget = true;
            var ledge = Rect<Image>(name + " rail", new Rect(box.x - 2 * d, top - rail, width + 4 * d, rail), parent);
            ledge.sprite = Art.SkinRealm(SkinSlots.Ledge); ledge.type = Image.Type.Sliced; ledge.pixelsPerUnitMultiplier = 1 / Ui;
            ledge.raycastTarget = false;
            var paws = Rect<Image>(name + " paws", frame, parent);
            paws.sprite = Art.Sprite("boss__paws"); paws.preserveAspect = true; paws.raycastTarget = false;

            // The name tag (.nametag): padded 4u by 12u, 16u over the box's top
            // and 14u in; the title follows the name 6u on, or goes under it when
            // the tag would cross the guardian.
            string heading = ruled?.RuleHeading ?? "";
            float nameWidth = Mathf.Max(TextWidth(realm.guardianName, tagDp, Type.Display), TextWidth(heading, tagDp, Type.Display));
            float titleWidth = TextWidth(realm.guardianTitle, titleDp, Type.Caption), nameHeight = Leading(tagDp, 1.14f);
            bool beside = nameWidth + 6 * u + titleWidth + 24 * u <= frame.x - (box.x + 14 * u);
            float tagWidth = Mathf.Min(width - 28 * u, beside ? nameWidth + 6 * u + titleWidth + 24 * u : Mathf.Max(nameWidth, titleWidth) + 24 * u);
            float titleHeight = beside ? 0 : Leading(titleDp, 1.364f);
            var tag = new Rect(box.x + 14 * u, top + 16 * u - (nameHeight + titleHeight + 8 * u), tagWidth, nameHeight + titleHeight + 8 * u);
            Piece(name + " name tag", SkinSlots.TitlePlate, tag, parent);
            var tagName = Label(name + " name", realm.guardianName, new Rect(tag.x + 12 * u, tag.yMax - 4 * u - nameHeight, nameWidth, nameHeight),
                tagDp, SkinTokens.Accent, parent, Type.Display, TextAlignmentOptions.Left);
            tagName.textWrappingMode = TextWrappingModes.NoWrap;
            var tagTitle = Label(name + " title", realm.guardianTitle, beside
                    ? new Rect(tag.x + 12 * u + nameWidth + 6 * u, tag.yMax - 4 * u - nameHeight, titleWidth, nameHeight)
                    : new Rect(tag.x + 12 * u, tag.y + 4 * u, tagWidth - 24 * u, titleHeight), titleDp,
                SkinTokens.TextMuted, parent, Type.Caption, beside ? TextAlignmentOptions.Left : TextAlignmentOptions.TopLeft);

            var text = Label(name + " line", "", new Rect(box.x + pad, top - 26 * u - lineHeight, inner, lineHeight),
                lineDp, SkinTokens.Text, parent, Type.Caption, TextAlignmentOptions.TopLeft);
            text.lineSpacing = LineSpacing(text.font, TalkLeading);
            GameObject rules = null;
            if (ruled != null)
            {
                rules = new GameObject(name + " rule", typeof(RectTransform));
                rules.transform.SetParent(parent, false); Place((RectTransform)rules.transform, box, parent);
                float row = top - 26 * u - 4 * u - icon, centre = box.center.x, arrow = 22 * u;
                Pictogram(name + " rule trigger", ruled.Rule.pictogram, ruled.Rule.chip, new Rect(centre - arrow / 2 - 10 * u - icon, row, icon, icon), rules.transform);
                Label(name + " rule arrow", "→", new Rect(centre - arrow / 2, row, arrow, icon), 22 * k, SkinTokens.TextMuted, rules.transform, Type.Caption);
                Piece(name + " rule bonus", HudLayout.BonusIcon(ruled.Rule.bonus, true), new Rect(centre + arrow / 2 + 10 * u, row, icon, icon), rules.transform);
                var said = Label(name + " rule", ruled.RuleSentence, new Rect(box.x + pad, row - 8 * u - sentence, inner, sentence), lineDp, SkinTokens.Text,
                    rules.transform, Type.Caption);
                said.lineSpacing = LineSpacing(said.font, TalkLeading);
                var does = Label(name + " rule effect", ruled.Rule.effect, new Rect(box.x + pad, row - 8 * u - sentence - 4 * u - effect, inner, effect), 13 * k,
                    SkinTokens.TextMuted, rules.transform, Type.Caption);
                does.lineSpacing = LineSpacing(does.font, TalkLeading);
            }
            // The ▼ and the hint centre on the box's bottom band, each as tall as its face draws it.
            float cueWidth = 12 * u, band = box.y + 14 * u + cueHeight / 2;
            float mark = TextHeight("▼", cueWidth, cueDp, Type.Body), words = TextHeight(TapHint, inner, cueDp, Type.Caption);
            var cue = Label(name + " continue", "▼", new Rect(box.xMax - pad - cueWidth, band - mark / 2, cueWidth, mark), cueDp, SkinTokens.Text, parent, Type.Body);
            // The hint shares the box's bottom band with the ▼, inside the box,
            // so nothing the page draws beneath can meet it.
            if (hint)
                Label(name + " hint", TapHint, new Rect(box.x + pad, band - words / 2, inner - cueWidth - 4 * u, words), cueDp,
                    SkinTokens.TextMuted, parent, Type.Caption, TextAlignmentOptions.Right);

            var talk = panel.gameObject.AddComponent<GuardianTalk>();
            // What stands on the box's top moves with it when a page resizes the box.
            var tops = new RectTransform[] { guardian.rectTransform, ledge.rectTransform, paws.rectTransform, tagName.rectTransform, tagTitle.rectTransform,
                text.rectTransform, (RectTransform)parent.Find(name + " name tag"), rules == null ? null : (RectTransform)rules.transform }.Where(rect => rect != null).ToArray();
            talk.Bind(Art, guardian, text, tagName, tagTitle, rules, cue, pages, finished, panel.rectTransform, tops, heights);
            return talk;
        }
        // The rule's pictograms are 56u; the line is 16u at 1.35.
        public const float RuleIconU = 56, TalkLeading = 1.35f;
        public const string TapHint = "Tap to continue";

        // A goal's pictogram (pictograms.rs): the picture and, when the goal has
        // one, its chip, the badge of signs and numbers on the picture's lower
        // right, overhanging it by 1/16 of its size, sized from the picture as
        // the HUD's 32 dp goal picture draws it (13.5 dp tall, its top 19 dp
        // down, its signs 11 dp and never under 9). The HUD and every page draw
        // a goal through this one builder; the chip is a child of the picture.
        public Image Pictogram(string name, string slot, string chip, Rect picture, Transform parent)
        {
            var image = Piece(name + " pictogram", slot, picture, parent);
            if (string.IsNullOrEmpty(chip)) return image;
            float s = picture.width / 32, size = Mathf.Max(11 * s / Density, 9);
            float height = 13.5f * s, width = Mathf.Max(15 * s, TextWidth(chip, size, Type.Display) / Scale + 4 * s);
            // A wide chip shifts right rather than run past the picture's own left margin.
            var rect = new Rect(Mathf.Max(picture.x - 4 * s, picture.xMax + 2 * s - width), picture.yMax - 19 * s - height, width, height);
            Piece(name + " chip", SkinSlots.Chip, rect, image.transform);
            float line = Mathf.Max(rect.height, TextHeight(chip, float.PositiveInfinity, size, Type.Display) / Scale);
            var sign = Label(name + " chip label", chip, new Rect(rect.x, rect.center.y - line / 2, rect.width, line), size, SkinTokens.Text, image.transform,
                Type.Display);
            // A sign on the picture keeps its drawn size at any text size.
            sign.fontSize = size * Density; sign.enableWordWrapping = false;
            return image;
        }
        // The multiplier's pictogram: its ring with the × inside, as its value reads beside it.
        public Image MultiplierPictogram(string name, Rect rect, Transform parent)
        {
            var ring = Piece(name + " pictogram", SkinSlots.MultiplierRing, rect, parent);
            var sign = Label(name + " sign", "×", rect, rect.height * .62f / Density, SkinTokens.Accent, ring.transform, Type.Display);
            sign.fontSize = rect.height * .62f; sign.enableWordWrapping = false;
            return ring;
        }

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
            var panel = Piece(name, SkinSlots.Card, rect, parent);
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

        // The bottom tab bar (.tabs3), at the rect ScreenKit.TabRect gives it:
        // padded 4u round equal cells, each 6u of padding round a 26u icon, 2u
        // and its label of at least 11 dp. Four tabs share the bar, so the
        // selected chip's round ends draw at half their kit size, as the
        // composites draw them.
        public const float TabLabelDp = 11, TabLabelMinimumDp = 9, TabChipBorder = .5f;
        // A chip's width less its round ends, the selected chip's slice borders.
        public float TabLabelRoom(float chipWidth)
        {
            var border = Art.SkinUi(SkinSlots.TabSelected).border;
            return chipWidth - (border.x + border.z) * Ui * TabChipBorder;
        }

        // A bottom tab bar with equal tabs, each an icon over its label; u is the screen's.
        public SkinTabBar TabBar(string name, Rect rect, float u, (string icon, string label, Action action)[] tabs, int selected, Transform parent)
        {
            if (tabs == null || tabs.Length == 0) throw new ArgumentException("A tab bar needs tabs", nameof(tabs));
            var bar = Piece(name, SkinSlots.TabBar, rect, parent);
            float width = (rect.width - 8 * u) / tabs.Length;
            var cells = new Rect[tabs.Length];
            for (int i = 0; i < tabs.Length; i++) cells[i] = new Rect(rect.x + 4 * u + i * width, rect.y + 4 * u, width, rect.height - 8 * u);
            var plate = Piece(name + " selected", SkinSlots.TabSelected, cells[0], bar.transform, TabChipBorder);
            var icons = new Image[tabs.Length]; var labels = new TMP_Text[tabs.Length];
            // Every label stays clear of the chip's painted round ends, shrinking
            // together toward the Label floor only when a word needs it.
            float room = TabLabelRoom(width), labelDp = Mathf.Max(TabLabelDp, TabLabelDp * u / Density);
            // The floor is the drawn size, so larger text stops at the same 9 dp.
            while (labelDp > TabLabelMinimumDp / Scale && tabs.Any(tab => TextWidth(tab.label, labelDp, Type.Caption) > room))
                labelDp = Mathf.Max(labelDp - .25f, TabLabelMinimumDp / Scale);
            for (int i = 0; i < tabs.Length; i++)
            {
                var (icon, label, action) = tabs[i];
                var cell = cells[i];
                // A tab takes taps over the bar's whole height.
                var hit = Rect<Image>(name + " " + label, new Rect(cell.x, rect.y, cell.width, rect.height), bar.transform); hit.color = Color.clear; hit.raycastTarget = true;
                hit.gameObject.AddComponent<Button>().onClick.AddListener(() => action());
                float size = 26 * u, top = cell.yMax - 6 * u - size;
                icons[i] = Piece(name + " " + label + " icon", icon, new Rect(cell.center.x - size / 2, top, size, size), hit.transform);
                float height = Mathf.Min(top - 2 * u - cell.y, TextHeight(label, room, labelDp, Type.Caption));
                labels[i] = Label(name + " " + label + " label", label, new Rect(cell.center.x - room / 2, top - 2 * u - height, room, height), labelDp, SkinTokens.Text,
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
