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

        public Image Piece(string name, string slot, Rect rect, Transform parent)
        {
            var image = Rect<Image>(name, rect, parent);
            image.sprite = Art.SkinUi(slot); image.raycastTarget = false;
            if (image.sprite.border != Vector4.zero) { image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = 1 / Ui; }
            else image.preserveAspect = true;
            return image;
        }

        public TMP_Text Label(string name, string value, Rect rect, float sizeDp, string token, Transform parent, bool display = false,
            TextAlignmentOptions alignment = TextAlignmentOptions.Center)
        {
            var text = Rect<TextMeshProUGUI>(name, rect, parent);
            text.font = display ? Art.Display : Art.Body; text.text = value; text.fontSize = sizeDp * Density * Scale;
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
