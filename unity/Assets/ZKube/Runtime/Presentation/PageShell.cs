using System;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The navigation shell every page draws into: the realm background behind the
    // page, a chrome layer for the header and tab bar, and the scrolling page body
    // between them. Everything is placed in screen pixels on an unscaled canvas,
    // the same space the skin kit and the board HUD use.
    public sealed class PageShell : MonoBehaviour
    {
        public const float TransitionSeconds = .22f;
        public GameObject Root { get; private set; }
        public RectTransform Chrome { get; private set; }
        public RectTransform Viewport { get; private set; }
        public RectTransform Page { get; private set; }
        public ScrollRect Scroll { get; private set; }
        public Image Background { get; private set; }
        public BoardArt Artwork { get; private set; }
        public bool Loading { get; private set; }
        public Exception ArtworkError { get; private set; }
        private RectTransform content;
        private CanvasGroup fade;
        private Camera backdrop;
        private byte requestedRealm;
        private Coroutine transition;

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
            Viewport = Child<RectTransform>("Page viewport", Root.transform);
            Viewport.gameObject.AddComponent<RectMask2D>();
            // A transparent graphic lets a drag on empty page space reach the scroll view.
            var hit = Viewport.gameObject.AddComponent<Image>(); hit.color = Color.clear;
            content = Child<RectTransform>("Page content", Viewport);
            fade = content.gameObject.AddComponent<CanvasGroup>();
            Scroll = Viewport.gameObject.AddComponent<ScrollRect>(); Scroll.horizontal = false;
            Scroll.movementType = ScrollRect.MovementType.Clamped; Scroll.viewport = Viewport; Scroll.content = content;
            Scroll.scrollSensitivity = 24;
            Chrome = Child<RectTransform>("Page chrome", Root.transform);
            Page = Child<RectTransform>("Page", content);
        }

        public void Show(bool visible) { Root.SetActive(visible); backdrop.enabled = visible; }

        // Retires the previous page and places an empty body between the header and
        // the tab bar. Page pieces are laid out from the top of Page, in screen pixels.
        public void Clear(Rect body)
        {
            StopTransition();
            foreach (Transform child in Chrome) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            foreach (Transform child in Page) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            var screen = new Rect(0, 0, Screen.width, Screen.height);
            SkinUi.Place(Chrome, screen, Root.transform);
            SkinUi.Place(Viewport, body, Root.transform);
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

        // A page arrives as the motion spec draws it: it rises 12 dp as it fades in
        // over 220 ms, with a dark vignette swelling at the screen's edges and
        // clearing again. Nothing slides sideways, so direction is unused.
        // Reduced motion cross-fades in 120 ms.
        public const float ReducedTransitionSeconds = .12f, RiseDp = 12;
        public void Enter(int direction, bool reducedMotion, float density)
        {
            StopTransition();
            if (!isActiveAndEnabled) return;
            transition = StartCoroutine(Arrive(reducedMotion, density));
        }
        private IEnumerator Arrive(bool reducedMotion, float density)
        {
            float seconds = reducedMotion ? ReducedTransitionSeconds : TransitionSeconds, rise = reducedMotion ? 0 : RiseDp * density;
            if (!reducedMotion && Artwork != null && vignette == null)
            {
                vignette = Child<Image>("Page vignette", Root.transform); vignette.raycastTarget = false;
                vignette.sprite = Artwork.SkinUi(SkinSlots.FxVignette);
                // 1.5 times the screen, centred: its dark band lands on the edges.
                var screen = new Rect(-Screen.width * .25f, -Screen.height * .25f, Screen.width * 1.5f, Screen.height * 1.5f);
                SkinUi.Place(vignette.rectTransform, screen, Root.transform);
            }
            float start = Time.unscaledTime;
            while (true)
            {
                float t = Mathf.Clamp01((Time.unscaledTime - start) / seconds), eased = 1 - (1 - t) * (1 - t);
                fade.alpha = eased;
                Page.anchoredPosition = new Vector2(0, -rise * (1 - eased));
                if (vignette != null) vignette.color = SkinUi.WithAlpha(Artwork.Token(SkinTokens.Scrim), .42f * Mathf.Sin(Mathf.PI * t));
                if (t >= 1) break;
                yield return null;
            }
            transition = null;
        }
        private Image vignette;
        private void StopTransition()
        {
            if (transition != null) StopCoroutine(transition);
            transition = null;
            if (vignette != null) vignette.color = Color.clear;
            if (fade != null) fade.alpha = 1;
            if (Page != null) Page.anchoredPosition = Vector2.zero;
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
            StopAllCoroutines(); transition = null; Loading = false; requestedRealm = 0; ArtworkError = null;
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
