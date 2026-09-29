using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
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
            Stage();
            Chrome = Child<RectTransform>("Page chrome", Root.transform);
            swell = Child<Image>("Page change glow", Root.transform); swell.raycastTarget = false; swell.enabled = false;
        }

        // The stage a page is drawn on: the scrolling body and its fixed overlay.
        private void Stage()
        {
            stage = Child<RectTransform>("Page stage", Root.transform);
            stage.SetSiblingIndex(Background.transform.GetSiblingIndex() + 1 + leaving.Count);
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
        }

        public void Show(bool visible) { Root.SetActive(visible); backdrop.enabled = visible; }

        // Art a drawn page uses is released only once no page that drew with it
        // is on screen: the page itself, the tab bar drawn beside it, or the page
        // still leaving. Each page holds the art it drew with until the next page
        // replaces it, and a leaving page holds it until its motion ends.
        private List<Action> held = new List<Action>();
        private readonly List<(GameObject layer, List<Action> art)> leaving = new List<(GameObject, List<Action>)>();
        public void Hold(Action release) { if (release != null && !held.Contains(release)) held.Add(release); }
        private void Release(IEnumerable<Action> art)
        {
            foreach (var release in art.ToArray())
                if (!held.Contains(release) && !leaving.Any(layer => layer.art.Contains(release)) && release != current) release();
        }
        private Action current;

        // The screen the pages lay out in, from the bottom-left of the real one,
        // and its safe area. A test simulates a phone inside the Game view with
        // the safe area that phone's device reports, so a layout that passes
        // there passes on the device; otherwise they are the real screen's.
        public Rect? Frame { get; private set; }
        public Rect? Safe { get; private set; }
        public void Simulate(Rect screen, Rect safe)
        {
            if (!screen.Contains(safe.min) || !screen.Contains(safe.max - new Vector2(.001f, .001f)))
                throw new ArgumentException("A phone's safe area lies inside its screen");
            Frame = screen; Safe = safe;
        }
        public void EndSimulation() { Frame = null; Safe = null; }
        public Rect ScreenArea => Frame ?? new Rect(0, 0, Screen.width, Screen.height);
        public Rect SafeArea => Safe ?? Screen.safeArea;

        // Retires the previous page and places an empty body between the header and
        // the tab bar. Page pieces are laid out from the top of Page, in screen pixels.
        // fade softens the body's top and bottom edges, in pixels, so content
        // scrolling under the header or down to the tab bar fades out there.
        public void Clear(Rect body, float fade = 0)
        {
            StopTransition();
            foreach (var layer in new[] { Chrome, Overlay, Page })
                foreach (Transform child in layer) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            var previous = held; held = new List<Action>();
            if (Artwork != null) Hold(current);
            Release(previous);
            var screen = ScreenArea;
            SkinUi.Place(stage, screen, Root.transform);
            SkinUi.Place(Overlay, screen, stage);
            SkinUi.Place(Chrome, screen, Root.transform);
            SkinUi.Place(Viewport, body, stage);
            Viewport.GetComponent<RectMask2D>().softness = new Vector2Int(0, Mathf.RoundToInt(fade));
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

        // A page change: the outgoing page sinks 8 dp and fades while it takes no
        // input, as the next page rises 12 dp and fades in over it, with a soft
        // glow swelling from where the player tapped. The tab bar stays still.
        // Reduced motion keeps a short cross-fade and no movement.
        // The outgoing page leaves on its own layer, keeping the art it drew with
        // until it is gone, so the next page can load and draw while it leaves.
        // When the next page is in another realm the painting leaves with it and
        // the new painting rises with the next page.
        public void Depart(bool reducedMotion, float density, bool painting = false)
        {
            if (Input.touchCount > 0) { tap = Input.GetTouch(0).position; tapTime = Time.unscaledTime; }
            else if (Input.GetMouseButton(0) || Input.GetMouseButtonUp(0)) { tap = Input.mousePosition; tapTime = Time.unscaledTime; }
            if (!Root.activeInHierarchy || Page.childCount == 0 && Overlay.childCount == 0) return;
            StopTransition();
            var layer = stage.gameObject; layer.name = "Leaving page";
            var group = fade; group.interactable = group.blocksRaycasts = false;
            var art = new List<Action>(held);
            if (painting && Background.sprite != null)
            {
                var copy = Child<Image>("Leaving painting", stage); copy.raycastTarget = false;
                copy.sprite = Background.sprite; copy.color = Background.color; copy.transform.SetAsFirstSibling();
                SkinUi.Place(copy.rectTransform, SkinUi.ScreenRect(Background.rectTransform), stage);
                var hidden = Background.color; hidden.a = 0; Background.color = hidden; paintingHidden = true;
            }
            leaving.Add((layer, art));
            Stage();
            StartCoroutine(Leave(layer, group, art, reducedMotion, density));
        }
        private IEnumerator Leave(GameObject layer, CanvasGroup group, List<Action> art, bool reducedMotion, float density)
        {
            var sheet = (RectTransform)layer.transform; var anchor = sheet.anchoredPosition;
            yield return Tween(reducedMotion ? ReducedSeconds : LeaveSeconds, t => {
                if (group == null) return;
                group.alpha = 1 - t;
                sheet.anchoredPosition = anchor - new Vector2(0, reducedMotion ? 0 : 8 * density * t * t);
            });
            Retire(layer);
        }
        private void Retire(GameObject layer)
        {
            int index = leaving.FindIndex(entry => entry.layer == layer);
            if (index < 0) return;
            var art = leaving[index].art; leaving.RemoveAt(index);
            if (layer != null) { layer.SetActive(false); Destroy(layer); }
            Release(art);
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
            // The realm's scrim and glow, read once for the whole rise.
            var scrim = Artwork != null ? Artwork.Token(SkinTokens.Scrim) : Color.clear;
            var glow = Artwork != null ? Artwork.Token(SkinTokens.LightGlow) : Color.clear;
            float size = 160 * density;
            yield return Tween(reducedMotion ? ReducedSeconds : Mathf.Max(EnterSeconds, GlowSeconds), t => {
                float page = Mathf.Clamp01(t * (reducedMotion ? 1 : Mathf.Max(EnterSeconds, GlowSeconds) / EnterSeconds));
                float eased = 1 - (1 - page) * (1 - page);
                fade.alpha = eased; stage.anchoredPosition = anchor - new Vector2(0, rise * (1 - eased));
                if (vignette != null && !reducedMotion) vignette.color = SkinUi.WithAlpha(scrim, .42f * Mathf.Sin(Mathf.PI * page));
                if (paintingHidden) { var shown = Background.color; shown.a = eased; Background.color = shown; }
                if (!swell.enabled) return;
                var color = glow; color.a = .5f * (1 - t);
                swell.color = color;
                float grown = size * (.6f + t);
                SkinUi.Place(swell.rectTransform, new Rect(origin.Value.x - grown / 2, origin.Value.y - grown / 2, grown, grown), Root.transform);
            });
            swell.enabled = false; transition = null; paintingHidden = false;
        }
        private bool paintingHidden;
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
            var area = ScreenArea;
            float scale = Mathf.Max(area.width / sprite.rect.width, area.height / sprite.rect.height);
            var size = sprite.rect.size * scale;
            SkinUi.Place(Background.rectTransform, new Rect(area.center.x - size.x / 2, area.center.y - size.y / 2, size.x, size.y), Root.transform);
        }

        public bool RealmReady(byte realm) => !Loading && ArtworkError == null && Artwork?.RealmId == realm;
        public void RequestRealm(byte realm)
        {
            requestedRealm = realm; ArtworkError = null;
            if (!Loading && isActiveAndEnabled && !RealmReady(realm)) StartCoroutine(LoadRealm());
        }
        // A realm loads into its own art; the art already drawn stays whole until
        // the pages that drew with it are gone.
        private IEnumerator LoadRealm()
        {
            Loading = true;
            while (requestedRealm != 0 && Artwork?.RealmId != requestedRealm)
            {
                byte realm = requestedRealm;
                var incoming = new BoardArt();
                var request = incoming.Load(realm);
                while (true)
                {
                    bool more;
                    try { more = request.MoveNext(); }
                    catch (Exception error)
                    { ArtworkError = error; Loading = false; incoming.Dispose(); yield break; }
                    if (!more) break; yield return request.Current;
                }
                var previous = current;
                Artwork = incoming; current = incoming.Dispose;
                if (previous != null) Release(new[] { previous });
            }
            Loading = false;
        }
        public void ReleaseArtwork()
        {
            StopAllCoroutines(); StopTransition(); Loading = false; requestedRealm = 0; ArtworkError = null;
            if (Background != null) { Background.sprite = null; Background.color = Color.clear; }
            foreach (var entry in leaving.ToArray()) if (entry.layer != null) { entry.layer.SetActive(false); Destroy(entry.layer); }
            var art = held.Concat(leaving.SelectMany(entry => entry.art)).Append(current).Where(release => release != null).Distinct().ToArray();
            leaving.Clear(); held.Clear(); current = null; Artwork = null;
            foreach (var release in art) release();
        }
        // A leaving page's motion stops with this component; it goes with it.
        private void OnDisable() { foreach (var entry in leaving.ToArray()) Retire(entry.layer); }
        private void OnDestroy() => ReleaseArtwork();

        private static T Child<T>(string name, Transform parent) where T : Component
        {
            var go = new GameObject(name, typeof(RectTransform)); go.transform.SetParent(parent, false);
            return typeof(T) == typeof(RectTransform) ? go.GetComponent<T>() : go.AddComponent(typeof(T)) as T;
        }
    }
}
