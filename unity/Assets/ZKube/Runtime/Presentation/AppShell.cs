using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    // A plain scrolling text page for an app that could not start: no realm
    // art, no skin, only the reason in readable text.
    public sealed class AppShell : MonoBehaviour
    {
        public GameObject Root { get; private set; }
        public RectTransform Content { get; private set; }
        private RectTransform safe;
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
            safe = Rect("Safe content", Root.transform); PlaceSafe();
            var viewport = Rect("Viewport", safe); Stretch(viewport);
            viewport.gameObject.AddComponent<RectMask2D>(); viewport.gameObject.AddComponent<Image>().color = Color.clear;
            var scroll = safe.gameObject.AddComponent<ScrollRect>(); scroll.horizontal = false;
            scroll.movementType = ScrollRect.MovementType.Clamped; scroll.viewport = viewport;
            Content = Rect("Page", viewport); Content.anchorMin = new Vector2(0, 1); Content.anchorMax = Vector2.one;
            Content.pivot = new Vector2(.5f, 1); Content.sizeDelta = Vector2.zero;
            var group = Content.gameObject.AddComponent<VerticalLayoutGroup>(); group.spacing = 12;
            group.childControlHeight = group.childControlWidth = group.childForceExpandWidth = true;
            group.childForceExpandHeight = false; group.padding = new RectOffset(8, 8, 8, 20);
            Content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
            scroll.content = Content;
        }

        public void Show(bool visible) { Root.SetActive(visible); backdrop.enabled = visible; }
        private void PlaceSafe()
        {
            if (safe == null || Screen.width <= 0 || Screen.height <= 0) return;
            lastSafe = Screen.safeArea; lastSize = new Vector2Int(Screen.width, Screen.height);
            safe.anchorMin = new Vector2(lastSafe.xMin / Screen.width, lastSafe.yMin / Screen.height);
            safe.anchorMax = new Vector2(lastSafe.xMax / Screen.width, lastSafe.yMax / Screen.height);
            safe.offsetMin = new Vector2(18, 18); safe.offsetMax = new Vector2(-18, -18);
        }
        private void Update()
        { if (lastSafe != Screen.safeArea || lastSize != new Vector2Int(Screen.width, Screen.height)) PlaceSafe(); }

        public static GameObject CanvasRoot(string title, Transform parent, int order)
        {
            var root = Rect(title, parent).gameObject; var canvas = root.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay; canvas.sortingOrder = order;
            var scaler = root.AddComponent<CanvasScaler>(); scaler.enabled = false;
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(430, 932); scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.Expand;
            scaler.enabled = true; root.AddComponent<GraphicRaycaster>(); return root;
        }
        public static RectTransform Rect(string name, Transform parent)
        { var rect = new GameObject(name, typeof(RectTransform)).GetComponent<RectTransform>(); rect.SetParent(parent, false); return rect; }
        private static void Stretch(RectTransform rect)
        { rect.anchorMin = Vector2.zero; rect.anchorMax = Vector2.one; rect.offsetMin = rect.offsetMax = Vector2.zero; }
    }
}
