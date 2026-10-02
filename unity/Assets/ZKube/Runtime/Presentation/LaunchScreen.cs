using System;
using UnityEngine;
using UnityEngine.U2D;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The first frame and the loading screen: the product's full splash scene,
    // drawn exactly where the Android launch window draws it so the handover
    // shows one picture, then brought to life as the old client's loading
    // screen was: the scene breathes in a slow zoom while motes of light rise
    // through it, the product's lockup rises in over it and the loading line
    // sweeps under the lockup. Both are live layers placed on the scene's
    // canvas (the art pack's layout); the splash and the lockup are staged per
    // product by build.py. Once the first page has drawn, a dark veil closes
    // over the scene and opens on the page, so the two are never blended.
    // Reduced motion holds the scene, the motes and the line still.
    public sealed class LaunchScreen : MonoBehaviour
    {
        public const float VeilCloseSeconds = .14f, VeilOpenSeconds = .18f, SweepSeconds = 1.2f;
        // The scene's zoom: up to ZoomLift larger and back once every ZoomSeconds, as the old client's 30 s breath.
        public const float ZoomSeconds = 30, ZoomLift = .08f, LockupSeconds = .5f, LockupRiseDp = 12;
        public const int Motes = 14;
        // The scene's canvas, and where its lockup and loading line sit on it.
        public static readonly Vector2 Canvas = new Vector2(1200, 2670);
        public static readonly Rect LockupOnCanvas = new Rect(120, 1135, 960, 481), LineOnCanvas = new Rect(396, 1701, 408, 21);
        // The sweeping segment's share of the line.
        public const float SegmentShare = .36f;
        private Func<bool> ready;
        private RectTransform segment;
        private float density, began, leaving = -1, travel;
        private Vector2 lockupAt;
        private (RectTransform rect, Image image, float speed, float sway, float phase, float x)[] motes;
        private Rect painting;
        public Image Painting { get; private set; }
        public Image Lockup { get; private set; }
        public Image Veil { get; private set; }
        public bool Leaving => leaving >= 0;

        // Where Android draws the launch drawable (ZKubeAndroidProject): the
        // bitmap from drawable-xxhdpi, scaled to the screen's density and
        // centred with integer arithmetic, in Unity's bottom-up pixels.
        public static Rect WindowRect(Vector2 source, int densityDpi, int width, int height)
        {
            const int Xxhdpi = 480;
            int w = ((int)source.x * densityDpi + Xxhdpi / 2) / Xxhdpi, h = ((int)source.y * densityDpi + Xxhdpi / 2) / Xxhdpi;
            int left = (width - w) / 2, top = (height - h) / 2;
            return new Rect(left, height - top - h, w, h);
        }
        // A rect on the scene's canvas (from its top left), on the drawn painting.
        public static Rect OnPainting(Rect painting, Rect canvas) => new Rect(painting.x + canvas.x / Canvas.x * painting.width,
            painting.yMax - (canvas.y + canvas.height) / Canvas.y * painting.height, canvas.width / Canvas.x * painting.width, canvas.height / Canvas.y * painting.height);

        public static LaunchScreen Create(Transform parent, Func<bool> firstPageDrawn, float density)
        {
            var splash = Resources.Load<Sprite>("ZKube/Splash") ?? throw new InvalidOperationException("The product splash is not staged");
            var lockup = Resources.Load<Sprite>("ZKube/Wordmark") ?? throw new InvalidOperationException("The product lockup is not staged");
            var root = new GameObject("Launch screen", typeof(RectTransform), typeof(Canvas), typeof(CanvasGroup));
            root.transform.SetParent(parent, false);
            var canvas = root.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 1000;
            var screen = root.AddComponent<LaunchScreen>();
            screen.ready = firstPageDrawn; screen.density = density; screen.began = Time.unscaledTime;
            var group = root.GetComponent<CanvasGroup>(); group.blocksRaycasts = false; group.interactable = false;
            screen.Draw(splash, lockup);
            return screen;
        }

        private void Draw(Sprite splash, Sprite lockup)
        {
            // Black around the painting, as the launch window's layer list is.
            Picture("Launch backdrop", new Rect(0, 0, Screen.width, Screen.height), null, Color.black);
            painting = WindowRect(splash.rect.size, Mathf.RoundToInt(density * 160), Screen.width, Screen.height);
            Painting = Picture("Launch splash", painting, splash, Color.white);
            // The scene zooms about its centre.
            var scene = Painting.rectTransform; scene.pivot = new Vector2(.5f, .5f); scene.anchoredPosition += scene.sizeDelta / 2;

            var kit = Resources.Load<SpriteAtlas>("ZKube/Atlases/skin-" + PageCatalog.Load().DefaultSkin.id + "-ui")
                ?? throw new InvalidOperationException("Prepare the bundled skin atlases before launch");
            Sprite Kit(string slot) => kit.GetSprite(slot) ?? throw new InvalidOperationException("Missing skin sprite: ui/" + slot);

            // Motes of warm light drift up through the scene, swaying, each at its own pace.
            var mote = Kit(SkinSlots.FxMote);
            var random = new System.Random(5);
            motes = new (RectTransform, Image, float, float, float, float)[Motes];
            for (int i = 0; i < Motes; i++)
            {
                float size = (6 + 8 * (float)random.NextDouble()) * density;
                var image = Picture("Launch mote", new Rect(0, 0, size, size), mote, Color.clear);
                motes[i] = (image.rectTransform, image, (14 + 22 * (float)random.NextDouble()) * density, (6 + 14 * (float)random.NextDouble()) * density,
                    (float)random.NextDouble(), painting.x + painting.width * (.08f + .84f * (float)random.NextDouble()));
            }

            Lockup = Picture("Launch lockup", OnPainting(painting, LockupOnCanvas), lockup, Color.white);
            Lockup.preserveAspect = true; lockupAt = Lockup.rectTransform.anchoredPosition;

            var line = OnPainting(painting, LineOnCanvas);
            var track = Picture("Launch track", line, Kit(SkinSlots.SliderTrack), Color.white);
            Sliced(track);
            var fill = Picture("Launch progress", new Rect(0, 0, line.width * SegmentShare, line.height), Kit(SkinSlots.SliderFill), Color.white, track.transform);
            Sliced(fill); segment = fill.rectTransform;
            segment.anchorMin = segment.anchorMax = segment.pivot = new Vector2(0, .5f); segment.anchoredPosition = Vector2.zero;
            travel = line.width * (1 - SegmentShare);
            Veil = Picture("Launch veil", new Rect(0, 0, Screen.width, Screen.height), null, Color.clear);
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

        private void Update()
        {
            bool still = AppPreferences.ReducedMotion;
            float t = Time.unscaledTime - began;
            // The scene's breath starts at its window size, so the first frame is the launch window's picture.
            float zoom = still ? 1 : 1 + ZoomLift * (.5f - .5f * Mathf.Cos(t * 2 * Mathf.PI / ZoomSeconds));
            Painting.rectTransform.localScale = new Vector3(zoom, zoom, 1);
            // The lockup rises in over the scene the launch window drew without it.
            float rise = still ? 1 : PageSequence.EaseOut(Mathf.Clamp01(t / LockupSeconds));
            Lockup.color = new Color(1, 1, 1, rise);
            Lockup.rectTransform.anchoredPosition = lockupAt - new Vector2(0, LockupRiseDp * density * (1 - rise));
            foreach (var (rect, image, speed, sway, phase, x) in motes)
            {
                if (still) { image.color = Color.clear; continue; }
                // Each mote climbs the scene from its foot in a loop, brightest mid-way.
                float span = painting.height + rect.sizeDelta.y, k = Mathf.Repeat(phase + t * speed / span, 1);
                rect.anchoredPosition = new Vector2(x + sway * Mathf.Sin((t + phase * 7) * 1.3f), painting.y + k * span - rect.sizeDelta.y);
                image.color = new Color(1, .965f, .855f, .55f * Mathf.Sin(Mathf.PI * k));
            }
            // The segment sweeps the line and back; reduced motion holds it still.
            float sweep = still ? 0 : Mathf.PingPong(Time.unscaledTime / SweepSeconds, 1);
            segment.anchoredPosition = new Vector2(travel * Mathf.SmoothStep(0, 1, sweep), 0);
            if (leaving < 0 && ready != null && ready()) leaving = Time.unscaledTime;
            if (leaving < 0) return;
            if (still) { Destroy(gameObject); return; }
            float since = Time.unscaledTime - leaving;
            if (since < VeilCloseSeconds) { Veil.color = new Color(0, 0, 0, since / VeilCloseSeconds); return; }
            // Closed: the splash goes and the veil opens on the page.
            foreach (Transform child in transform) if (child != Veil.transform) child.gameObject.SetActive(false);
            float open = Mathf.Clamp01((since - VeilCloseSeconds) / VeilOpenSeconds);
            Veil.color = new Color(0, 0, 0, 1 - open);
            if (open >= 1) Destroy(gameObject);
        }
    }
}
