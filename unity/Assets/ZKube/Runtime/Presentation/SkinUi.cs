using System;
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
        private Sprite circle;
        private Texture2D circleTexture;

        public SkinUi(BoardArt art, float density, float textScale)
        {
            Art = art ?? throw new ArgumentNullException(nameof(art));
            Density = density; Scale = textScale;
        }

        // borderScale draws a sliced piece's ends smaller than authored.
        public Image Piece(string name, string slot, Rect rect, Transform parent, float borderScale = 1)
        {
            var image = Rect<Image>(name, rect, parent);
            image.sprite = Art.SkinUi(slot); image.raycastTarget = false;
            if (image.sprite.border != Vector4.zero) { image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = 1 / (Ui * borderScale); }
            else image.preserveAspect = true;
            return image;
        }

        public TMP_Text Label(string name, string value, Rect rect, float sizeDp, string token, Transform parent, bool display = false,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center)
        {
            var text = Rect<TextMeshProUGUI>(name, rect, parent);
            text.font = display ? Art.Display : Art.Body; text.fontSharedMaterial = Styled(text.font, display);
            text.text = value; text.fontSize = sizeDp * Density * Scale;
            text.color = Art.Token(token); text.alignment = alignment; text.raycastTarget = false;
            text.enableWordWrapping = true; text.enableAutoSizing = false; text.overflowMode = TextOverflowModes.Overflow;
            return text;
        }

        // An icon button: pressed art swaps on press, the icon sits centred and an
        // optional count badge sits on the upper right corner.
        public Button IconButton(string name, Rect rect, string icon, Action action, Transform parent, bool withCount,
            out Image glyph, out TMP_Text count)
        {
            var face = Piece(name, SkinSlots.ButtonIcon, rect, parent); face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.targetGraphic = face;
            button.transition = Selectable.Transition.SpriteSwap;
            button.spriteState = new SpriteState { pressedSprite = Art.SkinUi(SkinSlots.ButtonIconPressed), disabledSprite = face.sprite };
            button.onClick.AddListener(() => action());
            float inset = rect.width * .2f;
            glyph = Piece(name + " icon", icon, new Rect(rect.x + inset, rect.y + inset, rect.width - 2 * inset, rect.height - 2 * inset), face.transform);
            count = null;
            if (!withCount) return button;
            float badge = Mathf.Max(24 * Density, rect.width * .4f);
            var pipRect = new Rect(rect.xMax - badge * .78f, rect.yMax - badge * .78f, badge, badge);
            Piece(name + " badge", SkinSlots.Badge, pipRect, face.transform);
            count = Label(name + " label", "", pipRect, 12, SkinTokens.TextOnPrimary, face.transform, true);
            return button;
        }

        public Button TextButton(string name, Rect rect, string label, Action action, bool primary, Transform parent, out TMP_Text text)
        {
            var face = Piece(name, primary ? SkinSlots.ButtonPrimary : SkinSlots.ButtonSecondary, rect, parent); face.raycastTarget = true;
            var button = face.gameObject.AddComponent<Button>(); button.targetGraphic = face;
            button.transition = Selectable.Transition.SpriteSwap;
            button.spriteState = new SpriteState
            {
                pressedSprite = Art.SkinUi(primary ? SkinSlots.ButtonPrimaryPressed : SkinSlots.ButtonSecondaryPressed),
                disabledSprite = face.sprite,
            };
            button.onClick.AddListener(() => action());
            float pad = 10 * Density;
            text = Label(name + " label", label, new Rect(rect.x + pad, rect.y, rect.width - 2 * pad, rect.height), 15,
                primary ? SkinTokens.TextOnPrimary : SkinTokens.TextOnSecondary, face.transform, true);
            return button;
        }

        // A round portrait framed by the skin's guardian ring. The portrait is
        // clipped to the ring's opening, a centred circle 232/320 of the frame.
        public Image Medallion(string name, Rect rect, Sprite portrait, Transform parent)
        {
            float opening = rect.width * 232f / 320f;
            var clip = Rect<Image>(name + " clip", new Rect(rect.center.x - opening / 2, rect.center.y - opening / 2, opening, opening), parent);
            clip.sprite = Circle(); clip.raycastTarget = false;
            clip.gameObject.AddComponent<Mask>().showMaskGraphic = false;
            var image = Rect<Image>(name, ScreenRect(clip.rectTransform), clip.transform);
            image.sprite = portrait; image.preserveAspect = true; image.raycastTarget = false;
            Piece(name + " frame", SkinSlots.GuardianFrame, rect, parent);
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

        // A bottom tab bar with equal tabs, each an icon over its label.
        public SkinTabBar TabBar(string name, Rect rect, (string icon, string label, Action action)[] tabs, int selected, Transform parent)
        {
            if (tabs == null || tabs.Length == 0) throw new ArgumentException("A tab bar needs tabs", nameof(tabs));
            var bar = Piece(name, SkinSlots.TabBar, rect, parent);
            float pad = 12 * Density, width = (rect.width - 2 * pad) / tabs.Length;
            var cells = new Rect[tabs.Length];
            for (int i = 0; i < tabs.Length; i++) cells[i] = new Rect(rect.x + pad + i * width, rect.y + 6 * Density, width, rect.height - 12 * Density);
            var plate = Piece(name + " selected", SkinSlots.TabSelected, cells[0], bar.transform);
            for (int i = 0; i < tabs.Length; i++)
            {
                var (icon, label, action) = tabs[i];
                var cell = cells[i];
                var hit = Rect<Image>(name + " " + label, cell, bar.transform); hit.color = Color.clear; hit.raycastTarget = true;
                hit.gameObject.AddComponent<Button>().onClick.AddListener(() => action());
                float size = cell.height * .45f;
                Piece(name + " " + label + " icon", icon, new Rect(cell.center.x - size / 2, cell.yMax - 4 * Density - size, size, size), hit.transform);
                Label(name + " " + label + " label", label, new Rect(cell.x, cell.y, cell.width, cell.height - size - 4 * Density), 12, SkinTokens.Text,
                    hit.transform, true);
            }
            var tabBar = bar.gameObject.AddComponent<SkinTabBar>();
            tabBar.Bind(cells, plate.rectTransform, selected);
            return tabBar;
        }

        public T Rect<T>(string name, Rect rect, Transform parent) where T : Component
        {
            var go = new GameObject(name, typeof(RectTransform), typeof(T));
            go.transform.SetParent(parent, false);
            Place(go.GetComponent<RectTransform>(), rect, parent);
            return go.GetComponent<T>();
        }

        public float TextHeight(string value, float width, float sizeDp, bool display)
        {
            var probe = Probe(display, sizeDp);
            try { return Mathf.Ceil(probe.GetPreferredValues(value, width, float.PositiveInfinity).y) + 2 * Density; }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        public float TextWidth(string value, float sizeDp, bool display)
        {
            var probe = Probe(display, sizeDp);
            try { return Mathf.Ceil(probe.GetPreferredValues(value, float.PositiveInfinity, float.PositiveInfinity).x) + 2 * Density; }
            finally { UnityEngine.Object.Destroy(probe.gameObject); }
        }
        private TextMeshProUGUI Probe(bool display, float sizeDp)
        {
            var go = new GameObject("Temporary TMP layout measurement", typeof(RectTransform), typeof(TextMeshProUGUI));
            go.hideFlags = HideFlags.HideAndDontSave;
            var text = go.GetComponent<TextMeshProUGUI>();
            text.enableAutoSizing = false; text.enableWordWrapping = true;
            text.font = display ? Art.Display : Art.Body; text.fontSize = sizeDp * Density * Scale;
            return text;
        }

        // Game text: display type gets a dark outline and a drop shadow, body type a
        // soft shadow. One shared material per font keeps text batched.
        private readonly System.Collections.Generic.Dictionary<TMP_FontAsset, Material> styles =
            new System.Collections.Generic.Dictionary<TMP_FontAsset, Material>();
        private Material Styled(TMP_FontAsset font, bool display)
        {
            if (styles.TryGetValue(font, out var material)) return material;
            material = new Material(font.material) { name = font.name + " game style" };
            material.SetFloat(ShaderUtilities.ID_OutlineWidth, display ? .22f : 0);
            material.SetColor(ShaderUtilities.ID_OutlineColor, new Color(.05f, .07f, .06f, .85f));
            material.EnableKeyword(ShaderUtilities.Keyword_Underlay);
            material.SetColor(ShaderUtilities.ID_UnderlayColor, new Color(0, 0, 0, display ? .6f : .45f));
            material.SetFloat(ShaderUtilities.ID_UnderlayOffsetY, display ? -.9f : -.6f);
            material.SetFloat(ShaderUtilities.ID_UnderlaySoftness, .2f);
            material.SetFloat(ShaderUtilities.ID_UnderlayDilate, display ? .25f : 0);
            styles.Add(font, material);
            return material;
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
            if (circleTexture != null) UnityEngine.Object.Destroy(circleTexture);
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
