using System;
using System.Collections;
using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    public sealed class AppShell : MonoBehaviour
    {
        public GameObject Root { get; private set; }
        public RectTransform Content { get; private set; }
        public RectTransform Safe { get; private set; }
        public Image Background { get; private set; }
        public BoardArt Artwork { get; private set; }
        public bool Loading { get; private set; }
        public Exception ArtworkError { get; private set; }
        private byte requestedRealm;
        private Camera backdrop;
        private Rect lastSafe;
        private Vector2Int lastSize;

        public void Initialize(string title)
        {
            backdrop = new GameObject("Page background", typeof(Camera)).GetComponent<Camera>();
            backdrop.transform.SetParent(transform, false); backdrop.clearFlags = CameraClearFlags.SolidColor;
            backdrop.backgroundColor = new Color(.06f, .10f, .17f, 1); backdrop.cullingMask = 0; backdrop.depth = -100;
            backdrop.allowHDR = backdrop.allowMSAA = false;
            Root = CanvasRoot(title, transform, 20);
            Background = AppPages.Rect("Realm backdrop", Root.transform).gameObject.AddComponent<Image>();
            AppPages.Stretch(Background.rectTransform); Background.color = Color.clear; Background.raycastTarget = false;
            Safe = AppPages.Rect("Safe content", Root.transform); PlaceSafe();
            var viewport = AppPages.Rect("Viewport", Safe); AppPages.Stretch(viewport);
            viewport.gameObject.AddComponent<RectMask2D>(); viewport.gameObject.AddComponent<Image>().color = Color.clear;
            var scroll = Safe.gameObject.AddComponent<ScrollRect>(); scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped; scroll.viewport = viewport;
            Content = AppPages.Rect("Page", viewport); Content.anchorMin = new Vector2(0, 1); Content.anchorMax = Vector2.one;
            Content.pivot = new Vector2(.5f, 1); Content.sizeDelta = Vector2.zero;
            var group = Content.gameObject.AddComponent<VerticalLayoutGroup>(); group.spacing = 12;
            group.childControlHeight = group.childControlWidth = group.childForceExpandWidth = true;
            group.childForceExpandHeight = false; group.padding = new RectOffset(8, 8, 8, 20);
            Content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = Content;
        }

        public void Show(bool visible) { Root.SetActive(visible); backdrop.enabled = visible; }
        public void ResetScroll()
        { var scroll = Safe.GetComponent<ScrollRect>(); scroll.StopMovement(); Content.anchoredPosition = Vector2.zero; }
        public void Clear()
        {
            foreach (Transform child in Content) { child.gameObject.SetActive(false); Destroy(child.gameObject); }
            ResetScroll();
        }
        public void PlaceSafe()
        {
            if (Safe == null || Screen.width <= 0 || Screen.height <= 0) return;
            lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
            Safe.anchorMin = new Vector2(lastSafe.xMin / Screen.width, lastSafe.yMin / Screen.height);
            Safe.anchorMax = new Vector2(lastSafe.xMax / Screen.width, lastSafe.yMax / Screen.height);
            Safe.offsetMin = new Vector2(18, 18); Safe.offsetMax = new Vector2(-18, -18);
        }
        private void Update()
        { if (lastSafe != Screen.safeArea || lastSize != new Vector2Int(Screen.width, Screen.height)) PlaceSafe(); }

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
                if (realm == requestedRealm)
                { Background.sprite = Artwork.Sprite("background"); Background.color = new Color(.4f, .4f, .4f); }
            }
            Loading = false;
        }
        public void ReleaseArtwork()
        {
            StopAllCoroutines(); Loading = false; requestedRealm = 0; ArtworkError = null;
            if (Background != null) { Background.sprite = null; Background.color = Color.clear; }
            Artwork?.Dispose(); Artwork = null;
        }
        private void OnDestroy() => ReleaseArtwork();

        public static GameObject CanvasRoot(string title, Transform parent, int order)
        {
            var root = AppPages.Rect(title, parent).gameObject; var canvas = root.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = order;
            var scaler = root.AddComponent<CanvasScaler>(); scaler.enabled = false;
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(430, 932); scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.Expand;
            scaler.enabled = true; root.AddComponent<GraphicRaycaster>(); return root;
        }
    }
}
