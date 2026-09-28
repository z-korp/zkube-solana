using System;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The navigation shell every page draws into: the realm background behind the
    // page, the stage (the scrolling page body and its fixed overlay: header,
    // dialogs) and a still chrome layer for the tab bar. Everything is placed in
    // screen pixels on an unscaled canvas, the same space the skin kit and the
    // board HUD use.
    public sealed class PageShell : MonoBehaviour
    {
        public const float LeaveSeconds = .16f, EnterSeconds = .22f, ReducedSeconds = .06f, GlowSeconds = .3f;
        public GameObject Root { get; private set; }
        public RectTransform Chrome { get; private set; }
        public RectTransform Overlay { get; private set; }
        public RectTransform Viewport { get; private set; }
        public RectTransform Page { get; private set; }
        public ScrollRect Scroll { get; private set; }
        public Image Background { get; private set; }
        public BoardArt Artwork { get; private set; }
        public bool Loading { get; private set; }
        public Exception ArtworkError { get; private set; }
        private RectTransform content, stage;
        private CanvasGroup fade;
        private Camera backdrop;
        private byte requestedRealm;
        private Coroutine transition;
        private Image swell;
        private Vector2 tap;
        private float tapTime = float.NegativeInfinity;

        public void Initialize(string title)
        {
            // An overlay canvas does not clear the frame; this camera does, so a
            // packaged scene draws without inheriting a board or scene camera.
            backdrop = new GameObject("Page background", typeof(Camera)).GetComponent<Camera>();
            backdrop.transform.SetParent(transform, false); backdrop.clearFlags = CameraClearFlags.SolidColor;
            backdrop.backgroundColor = new Color(.02f, .06f, .05f, 1); backdrop.cullingMask = 0; backdrop.depth = -100;
            backdrop.allowHDR = backdrop.allowMSAA = false;
            Root = new GameObject(title, typeof(RectTransform), typeof(Canvas), typeof(GraphicRaycaster));
            Root.transform.SetParent(transform, false);
            var canvas = Root.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = 20;
            Background = Child<Image>("Realm backdrop", Root.transform); Background.color = Color.clear; Background.raycastTarget = false;
            stage = Child<RectTransform>("Page stage", Root.transform);
            fade = stage.gameObject.AddComponent<CanvasGroup>();
            Viewport = Child<RectTransform>("Page viewport", stage);
            Viewport.gameObject.AddComponent<RectMask2D>();
            // A transparent graphic lets a drag on empty page space reach the scroll view.
            var hit = Viewport.gameObject.AddComponent<Image>(); hit.color = Color.clear;
            content = Child<RectTransform>("Page content", Viewport);
            Scroll = Viewport.gameObject.AddComponent<ScrollRect>(); Scroll.horizontal = false;
            Scroll.movementType = ScrollRect.MovementType.Clamped; Scroll.viewport = Viewport; Scroll.content = content;
            Scroll.scrollSensitivity = 24;
            Page = Child<RectTransform>("Page", content);
            Overlay = Child<RectTransform>("Page overlay", stage);
            Chrome = Child<RectTransform>("Page chrome", Root.transform);
            swell = Child<Image>("Page change glow", Root.transform); swell.raycastTarget = false; swell.enabled = false;
        }

        public void Show(bool visible) { Root.SetActive(visible); backdrop.enabled = visible; }

        // Retires the previous page and places an empty body between the header and
        // the tab bar. Page pieces are laid out from the top of Page, in screen pixels.
        public void Clear(Rect body)
        {
            StopTransition();
            foreach (var layer in new[] { Chrome, Overlay, Page })
                foreach (Transform child in layer) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            var screen = new Rect(0, 0, Screen.width, Screen.height);
            SkinUi.Place(stage, screen, Root.transform);
            SkinUi.Place(Overlay, screen, stage);
            SkinUi.Place(Chrome, screen, Root.transform);
            SkinUi.Place(Viewport, body, stage);
            Scroll.StopMovement();
            content.anchorMin = new Vector2(0, 1); content.anchorMax = Vector2.one; content.pivot = new Vector2(.5f, 1);
            content.anchoredPosition = Vector2.zero; content.sizeDelta = Vector2.zero;
            // Page is a zero-height anchor on the content's top edge, so growing the
            // content to the laid-out height keeps every placed piece where it is.
            Page.anchorMin = Page.anchorMax = new Vector2(0, 1); Page.pivot = new Vector2(0, 1);
            Page.anchoredPosition = Vector2.zero; Page.sizeDelta = new Vector2(body.width, 0);
        }

        // Called after the page is laid out, with the lowest screen y it used.
        public void Finish(float bottom)
        {
            float height = Mathf.Max(0, Viewport.rect.height, SkinUi.ScreenRect(Viewport).yMax - bottom);
            content.sizeDelta = new Vector2(0, height);
            Scroll.verticalNormalizedPosition = 1;
        }

        // The scroll offset from the top, kept when a page redraws in place.
        public float Offset
        {
            get => content.anchoredPosition.y;
            set => content.anchoredPosition = new Vector2(0, Mathf.Clamp(value, 0, Mathf.Max(0, content.sizeDelta.y - Viewport.rect.height)));
        }
        // Scrolls so an unscrolled screen height sits in the middle of the viewport.
        public void Reveal(float y) => Offset = SkinUi.ScreenRect(Viewport).yMax - y - Viewport.rect.height / 2;

        // A page change: the outgoing stage fades and sinks 8 dp while it takes no
        // input, then the new page is drawn and rises 12 dp as it fades in, with a
        // soft glow swelling from where the player tapped. The tab bar stays still.
        // Reduced motion keeps a short cross-fade and no movement.
        public IEnumerator Leave(bool reducedMotion, float density)
        {
            if (!Root.activeInHierarchy || !fade.blocksRaycasts || Page.childCount == 0 && Overlay.childCount == 0) yield break;
            StopTransition();
            fade.interactable = fade.blocksRaycasts = false;
            yield return Tween(reducedMotion ? ReducedSeconds : LeaveSeconds, t => {
                fade.alpha = 1 - t;
                stage.anchoredPosition = new Vector2(stage.anchoredPosition.x, 0) - new Vector2(0, reducedMotion ? 0 : 8 * density * t * t);
            });
        }
        public void Enter(bool reducedMotion, float density)
        {
            StopTransition();
            if (!isActiveAndEnabled) return;
            var origin = Time.unscaledTime - tapTime < .6f ? tap : (Vector2?)null;
            transition = StartCoroutine(Rise(reducedMotion, density, origin));
        }
        private IEnumerator Rise(bool reducedMotion, float density, Vector2? origin)
        {
            var anchor = stage.anchoredPosition;
            float rise = reducedMotion ? 0 : 12 * density;
            if (origin.HasValue && !reducedMotion && Artwork != null)
            {
                swell.sprite = Artwork.SkinUi(SkinSlots.FxGlow); swell.enabled = true;
                swell.transform.SetAsLastSibling();
            }
            // A dark vignette swells at the screen's edges and clears as it rises.
            if (!reducedMotion && Artwork != null && vignette == null)
            {
                vignette = Child<Image>("Page vignette", Root.transform); vignette.raycastTarget = false;
                vignette.sprite = Artwork.SkinUi(SkinSlots.FxVignette);
                // 1.5 times the screen, centred: its dark band lands on the edges.
                var screen = new Rect(-Screen.width * .25f, -Screen.height * .25f, Screen.width * 1.5f, Screen.height * 1.5f);
                SkinUi.Place(vignette.rectTransform, screen, Root.transform);
            }
            float size = 160 * density;
            yield return Tween(reducedMotion ? ReducedSeconds : Mathf.Max(EnterSeconds, GlowSeconds), t => {
                float page = Mathf.Clamp01(t * (reducedMotion ? 1 : Mathf.Max(EnterSeconds, GlowSeconds) / EnterSeconds));
                float eased = 1 - (1 - page) * (1 - page);
                fade.alpha = eased; stage.anchoredPosition = anchor - new Vector2(0, rise * (1 - eased));
                if (vignette != null && !reducedMotion) vignette.color = SkinUi.WithAlpha(Artwork.Token(SkinTokens.Scrim), .42f * Mathf.Sin(Mathf.PI * page));
                if (!swell.enabled) return;
                var color = Artwork.Token(SkinTokens.LightGlow); color.a = .5f * (1 - t);
                swell.color = color;
                float grown = size * (.6f + t);
                SkinUi.Place(swell.rectTransform, new Rect(origin.Value.x - grown / 2, origin.Value.y - grown / 2, grown, grown), Root.transform);
            });
            swell.enabled = false; transition = null;
        }
        private static IEnumerator Tween(float seconds, Action<float> step)
        {
            float start = Time.unscaledTime;
            while (true)
            {
                float t = Mathf.Clamp01((Time.unscaledTime - start) / seconds);
                step(t);
                if (t >= 1) yield break;
                yield return null;
            }
        }
        private void StopTransition()
        {
            if (transition != null) StopCoroutine(transition);
            transition = null;
            if (fade != null) { fade.alpha = 1; fade.interactable = fade.blocksRaycasts = true; }
            if (stage != null) stage.anchoredPosition = new Vector2(stage.anchoredPosition.x, 0);
            if (swell != null) swell.enabled = false;
            if (vignette != null) vignette.color = Color.clear;
        }
        private Image vignette;
        private void Update()
        {
            if (Input.touchCount > 0) { tap = Input.GetTouch(0).position; tapTime = Time.unscaledTime; }
            else if (Input.GetMouseButton(0) || Input.GetMouseButtonUp(0)) { tap = Input.mousePosition; tapTime = Time.unscaledTime; }
        }

        // The page background covers the screen and keeps the art's aspect.
        public void Backdrop(Sprite sprite, float brightness)
        {
            Background.sprite = sprite; Background.color = sprite == null ? Color.clear : new Color(brightness, brightness, brightness, 1);
            if (sprite == null) return;
            float scale = Mathf.Max(Screen.width / sprite.rect.width, Screen.height / sprite.rect.height);
            var size = sprite.rect.size * scale;
            SkinUi.Place(Background.rectTransform, new Rect((Screen.width - size.x) / 2, (Screen.height - size.y) / 2, size.x, size.y), Root.transform);
        }

        public bool RealmReady(byte realm) => !Loading && ArtworkError == null && Artwork?.RealmId == realm;
        public void RequestRealm(byte realm)
        {
            requestedRealm = realm; ArtworkError = null;
            if (!Loading && isActiveAndEnabled && !RealmReady(realm)) StartCoroutine(LoadRealm());
        }
        private IEnumerator LoadRealm()
        {
            Loading = true;
            while (requestedRealm != 0 && Artwork?.RealmId != requestedRealm)
            {
                byte realm = requestedRealm; Background.sprite = null; Background.color = Color.clear;
                if (Artwork == null) Artwork = new BoardArt();
                var request = Artwork.Load(realm);
                while (true)
                {
                    bool more;
                    try { more = request.MoveNext(); }
                    catch (Exception error)
                    { ArtworkError = error; Loading = false; Artwork.Dispose(); Artwork = null; yield break; }
                    if (!more) break; yield return request.Current;
                }
            }
            Loading = false;
        }
        public void ReleaseArtwork()
        {
            StopAllCoroutines(); StopTransition(); Loading = false; requestedRealm = 0; ArtworkError = null;
            if (Background != null) { Background.sprite = null; Background.color = Color.clear; }
            Artwork?.Dispose(); Artwork = null;
        }
        private void OnDestroy() => ReleaseArtwork();

        private static T Child<T>(string name, Transform parent) where T : Component
        {
            var go = new GameObject(name, typeof(RectTransform)); go.transform.SetParent(parent, false);
            return typeof(T) == typeof(RectTransform) ? go.GetComponent<T>() : go.AddComponent(typeof(T)) as T;
        }
    }
}
