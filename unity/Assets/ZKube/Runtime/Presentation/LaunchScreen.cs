using System;
using TMPro;
using UnityEngine;
using UnityEngine.U2D;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The first frame: the product's splash painting, its lockup painted in,
    // with the loading line under it as drawn on the 400 x 890 dp loading
    // screen. The splash is staged per product by build.py, so each package
    // shows its own. It fades out once the first page has drawn.
    public sealed class LaunchScreen : MonoBehaviour
    {
        public const string Opening = "Opening the realms…", Preparing = "Preparing your saved progress";
        public const float FadeSeconds = .22f, SweepSeconds = 1.2f;
        // The loading screen's canvas, and where its line sits on it.
        private const float CanvasDp = 890, WidthDp = 400, OpeningDp = 650, BarDp = 704, ShadeDp = 724, PreparingDp = 740;
        private const float BarWidthDp = 256, BarHeightDp = 8, SegmentDp = 92;
        private Func<bool> ready;
        private CanvasGroup group;
        private RectTransform segment;
        private float density, fadeStart = -1;
        public Image Painting { get; private set; }

        public static LaunchScreen Create(Transform parent, Func<bool> firstPageDrawn, float density)
        {
            var splash = Resources.Load<Sprite>("ZKube/Splash")
                ?? throw new InvalidOperationException("The product splash is not staged");
            var root = new GameObject("Launch screen", typeof(RectTransform), typeof(Canvas), typeof(CanvasGroup));
            root.transform.SetParent(parent, false);
            var canvas = root.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 1000;
            var screen = root.AddComponent<LaunchScreen>();
            screen.ready = firstPageDrawn; screen.density = density;
            screen.group = root.GetComponent<CanvasGroup>(); screen.group.blocksRaycasts = false; screen.group.interactable = false;
            screen.Draw(splash);
            return screen;
        }

        private void Draw(Sprite splash)
        {
            // The painting covers the screen; the line keeps its place on it.
            float scale = Mathf.Max(Screen.width / splash.rect.width, Screen.height / splash.rect.height);
            var painting = new Rect((Screen.width - splash.rect.width * scale) / 2, (Screen.height - splash.rect.height * scale) / 2,
                splash.rect.width * scale, splash.rect.height * scale);
            Painting = Picture("Launch splash", painting, splash, Color.white);
            float Y(float dp) => painting.yMax - dp / CanvasDp * painting.height;
            float d = density;

            var skin = PageCatalog.Load().DefaultSkin;
            Color Token(string name)
            {
                foreach (var token in skin.tokens)
                    if (token.name == name) return new Color(token.value[0], token.value[1], token.value[2], token.value[3]);
                throw new InvalidOperationException("Skin token is missing: " + name);
            }
            var kit = Resources.Load<SpriteAtlas>("ZKube/Atlases/skin-" + skin.id + "-ui")
                ?? throw new InvalidOperationException("Prepare the bundled skin atlases before launch");
            Sprite Kit(string slot) => kit.GetSprite(slot) ?? throw new InvalidOperationException("Missing skin sprite: ui/" + slot);
            var caption = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(SkinUi.Type.Caption))
                ?? throw new InvalidOperationException("Prepare the bundled fonts before launch");

            float centre = Screen.width / 2f;
            Text("Launch opening", Opening, new Rect(centre - WidthDp / 2 * d, Y(OpeningDp) - 24 * d, WidthDp * d, 24 * d), 18 * d, Token(SkinTokens.Text), caption);
            var track = Picture("Launch track", new Rect(centre - BarWidthDp / 2 * d, Y(BarDp) - BarHeightDp * d, BarWidthDp * d, BarHeightDp * d),
                Kit(SkinSlots.SliderTrack), Color.white);
            Sliced(track);
            var fill = Picture("Launch progress", new Rect(0, 0, SegmentDp * d, BarHeightDp * d), Kit(SkinSlots.SliderFill), Color.white, track.transform);
            Sliced(fill); segment = fill.rectTransform;
            segment.anchorMin = segment.anchorMax = segment.pivot = new Vector2(0, .5f); segment.anchoredPosition = Vector2.zero;
            Picture("Launch caption shade", new Rect(centre - 110 * d, Y(ShadeDp) - 45 * d, 220 * d, 45 * d),
                Kit(SkinSlots.FxGlow), SkinUi.WithAlpha(Token(SkinTokens.Scrim), .97f));
            Text("Launch preparing", Preparing, new Rect(centre - WidthDp / 2 * d, Y(PreparingDp) - 18 * d, WidthDp * d, 18 * d), 13 * d, Token(SkinTokens.TextMuted), caption);
            Update();
        }

        private void Sliced(Image image)
        {
            if (image.sprite.border == Vector4.zero) return;
            image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = 1 / density;
        }
        private Image Picture(string name, Rect rect, Sprite sprite, Color color, Transform parent = null)
        {
            var image = new GameObject(name, typeof(RectTransform), typeof(Image)).GetComponent<Image>();
            image.transform.SetParent(parent ?? transform, false);
            SkinUi.Place(image.rectTransform, rect, parent ?? transform);
            image.sprite = sprite; image.color = color; image.raycastTarget = false;
            return image;
        }
        private void Text(string name, string text, Rect rect, float size, Color color, TMP_FontAsset font)
        {
            var label = new GameObject(name, typeof(RectTransform), typeof(TextMeshProUGUI)).GetComponent<TextMeshProUGUI>();
            label.transform.SetParent(transform, false);
            SkinUi.Place(label.rectTransform, rect, transform);
            label.font = font; label.fontSize = size; label.color = color; label.text = text; label.raycastTarget = false;
            label.alignment = TextAlignmentOptions.Center; label.textWrappingMode = TextWrappingModes.NoWrap;
        }

        private void Update()
        {
            // The segment sweeps the track and back; reduced motion holds it still.
            float travel = (BarWidthDp - SegmentDp) * density;
            float t = AppPreferences.ReducedMotion ? 0 : Mathf.PingPong(Time.unscaledTime / SweepSeconds, 1);
            segment.anchoredPosition = new Vector2(travel * Mathf.SmoothStep(0, 1, t), 0);
            if (fadeStart < 0 && ready != null && ready()) fadeStart = Time.unscaledTime;
            if (fadeStart < 0) return;
            group.alpha = AppPreferences.ReducedMotion ? 0 : 1 - Mathf.Clamp01((Time.unscaledTime - fadeStart) / FadeSeconds);
            if (group.alpha <= 0) Destroy(gameObject);
        }
    }
}
