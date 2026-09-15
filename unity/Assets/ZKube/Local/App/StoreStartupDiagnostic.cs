#if UNITY_EDITOR || ZKUBE_EVIDENCE
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;
using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Local.App
{
    // Attached only by StoreStartup. Observes one launch; never changes layout,
    // creates a camera, forces a render, or observes arbitrary application logs.
    [DisallowMultipleComponent]
    public sealed class StoreStartupDiagnostic : MonoBehaviour
    {
        public const string FileName = "store-startup-diagnostic-v1.json";
        private const float TimeoutSeconds = 60;
        private const int MaximumBytes = 65536;
        private ErrorInfo observedError;
        private bool written;

        [Serializable] private sealed class ErrorInfo
        {
            public string phase, type, site, stack;
            public int hresult;
        }
        [Serializable] private sealed class Report
        {
            public int schema = 1, frame, width, height, cameraCount, canvasCount, rendererCount;
            public string scope = "store-startup-editor-or-evidence", reason, page, graphicsApi;
            public float elapsedSeconds;
            public bool appPresent, flowPresent, pageReady, loading, dirty, hostActive, hostEnabled, truncated;
            public Rect safeArea;
            public int pageRootId, warningRootId;
            public AssetInfo assets;
            public CanvasInfo[] canvases = Array.Empty<CanvasInfo>();
            public RendererInfo[] renderers = Array.Empty<RendererInfo>();
            public CameraInfo[] cameras = Array.Empty<CameraInfo>();
            public ErrorInfo error, inspectionError;
        }
        [Serializable] private sealed class RectInfo
        {
            public Rect rect;
            public Vector3 position, localScale, lossyScale;
            public Vector2 anchorMin, anchorMax;
        }
        [Serializable] private sealed class CanvasInfo
        {
            public int id, rootId, order, display;
            public string node, mode;
            public bool active, enabled, root;
            public float scaleFactor;
            public Rect pixelRect;
            public RectInfo transform;
        }
        [Serializable] private sealed class RendererInfo
        {
            public int id, canvasId, vertices, absoluteDepth;
            public string node;
            public bool active, culled, hasMesh;
            public RectInfo transform;
            public ErrorInfo error;
        }
        [Serializable] private sealed class CameraInfo
        {
            public int id, cullingMask, display;
            public float depth;
            public string clearFlags;
            public Rect pixelRect;
        }
        [Serializable] private sealed class RequestInfo
        {
            public bool exists, done, assetChecked, assetAvailable;
            public float progress;
        }
        [Serializable] private sealed class AssetInfo
        {
            public bool present, displayFont, bodyFont;
            public int realm;
            public string theme;
            public RequestInfo realmRequest, commonRequest;
            public BoardArt.TextureInfo[] textures = Array.Empty<BoardArt.TextureInfo>();
        }

        // Keep error identity and throw frames, not arbitrary exception messages:
        // parser/billing messages can contain local product data or receipt text.
        public void RecordError(string phase, Exception error)
        { if (!written && observedError == null) observedError = DescribeError(phase, error); }

        private IEnumerator Start()
        {
            float started = Time.realtimeSinceStartup;
            string reason = "timeout";
            while (Time.realtimeSinceStartup - started < TimeoutSeconds)
            {
                if (observedError != null) { reason = "error"; break; }
                var app = GetComponent<StoreAppController>();
                if (app != null && app.PageReady) { reason = "ready"; break; }
                yield return null;
            }
            // Allow the ordinary canvas update to run, without forcing layout or
            // depending on WaitForEndOfFrame in the camera-free failure case.
            yield return null;
            var report = Capture(reason, Time.realtimeSinceStartup - started);
            Write(report);
        }

        private Report Capture(string reason, float elapsed)
        {
            var report = new Report { reason = reason, elapsedSeconds = elapsed, frame = Time.frameCount,
                width = Screen.width, height = Screen.height, safeArea = Screen.safeArea,
                graphicsApi = SystemInfo.graphicsDeviceType.ToString(), cameraCount = Camera.allCamerasCount,
                hostActive = gameObject.activeInHierarchy, hostEnabled = enabled, error = observedError };
            try
            {
                var app = GetComponent<StoreAppController>(); report.appPresent = app != null;
                report.flowPresent = app != null && app.Flow != null;
                if (app != null)
                {
                    report.page = app.Flow?.Page.ToString(); report.pageReady = app.PageReady;
                    report.loading = Field<bool>(app, "loading"); report.dirty = Field<bool>(app, "dirty");
                    report.pageRootId = Id(Field<GameObject>(app, "pageRoot"));
                    report.warningRootId = Id(Field<GameObject>(app, "warningRoot"));
                    report.assets = Assets(Field<BoardArt>(app, "art"));
                }
                var canvases = GetComponentsInChildren<Canvas>(true);
                var renderers = GetComponentsInChildren<CanvasRenderer>(true);
                report.canvasCount = canvases.Length; report.rendererCount = renderers.Length;
                report.truncated = canvases.Length > 8 || renderers.Length > 128 || report.cameraCount > 8;
                report.canvases = canvases.Take(8).Select(canvas => new CanvasInfo {
                    id = Id(canvas), rootId = Id(canvas.rootCanvas), node = Node(canvas.transform),
                    active = canvas.gameObject.activeInHierarchy, enabled = canvas.enabled, root = canvas.isRootCanvas,
                    mode = canvas.renderMode.ToString(), order = canvas.sortingOrder, display = canvas.targetDisplay,
                    scaleFactor = canvas.scaleFactor, pixelRect = canvas.pixelRect, transform = RectOf(canvas.transform),
                }).ToArray();
                report.renderers = renderers.Take(128).Select(Renderer).ToArray();
                report.cameras = Camera.allCameras.Take(8).Select(camera => new CameraInfo {
                    id = Id(camera), depth = camera.depth, cullingMask = camera.cullingMask,
                    clearFlags = camera.clearFlags.ToString(), display = camera.targetDisplay, pixelRect = camera.pixelRect,
                }).ToArray();
            }
            catch (Exception error) { report.inspectionError = DescribeError("inspection", error); }
            return report;
        }
        private RendererInfo Renderer(CanvasRenderer value)
        {
            var result = new RendererInfo { id = Id(value), canvasId = Id(value.GetComponentInParent<Canvas>()),
                node = Node(value.transform), active = value.gameObject.activeInHierarchy, culled = value.cull,
                absoluteDepth = value.absoluteDepth, transform = RectOf(value.transform) };
            try
            {
                var mesh = value.GetMesh(); // Borrowed renderer mesh: never mutate or destroy it.
                result.hasMesh = mesh != null; result.vertices = mesh == null ? 0 : mesh.vertexCount;
            }
            catch (Exception error) { result.error = DescribeError("renderer-mesh", error); }
            return result;
        }
        private static AssetInfo Assets(BoardArt art) => art == null ? new AssetInfo() : new AssetInfo {
            present = true, realm = art.RealmId, theme = art.ThemeId, displayFont = art.Display != null,
            bodyFont = art.Body != null, realmRequest = Request(Field<object>(art, "realmLoad")),
            commonRequest = Request(Field<object>(art, "commonLoad")), textures = art.Textures.Take(2).ToArray(),
        };
        private static RequestInfo Request(object lease)
        {
            if (lease == null) return new RequestInfo();
            var request = Field<ResourceRequest>(lease, "Request");
            // Accessing asset before completion can block and disturb the failure.
            return new RequestInfo { exists = true, done = request.isDone, progress = request.progress,
                assetChecked = request.isDone, assetAvailable = request.isDone && request.asset != null };
        }
        private static T Field<T>(object value, string field) => (T)(value.GetType()
            .GetField(field, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
            ?? throw new MissingFieldException(value.GetType().FullName, field)).GetValue(value);
        private static int Id(UnityEngine.Object value) => value == null ? 0 : value.GetInstanceID();
        private static RectInfo RectOf(Transform value) => value is RectTransform rect ? new RectInfo {
            rect = rect.rect, position = rect.position, localScale = rect.localScale, lossyScale = rect.lossyScale,
            anchorMin = rect.anchorMin, anchorMax = rect.anchorMax,
        } : null;
        private string Node(Transform value)
        {
            var indices = new List<int>();
            while (value != null && value != transform && indices.Count < 16)
            { indices.Add(value.GetSiblingIndex()); value = value.parent; }
            indices.Reverse(); return string.Join("/", indices);
        }
        private static ErrorInfo DescribeError(string phase, Exception error) => new ErrorInfo {
            phase = phase, type = error.GetType().FullName, hresult = error.HResult,
            site = error.TargetSite?.DeclaringType?.FullName + "." + error.TargetSite?.Name,
            stack = (error.StackTrace ?? "").Length <= 2048 ? error.StackTrace : error.StackTrace.Substring(0, 2048),
        };
        private void Write(Report report)
        {
            if (written) return; written = true;
            try
            {
                string json = JsonUtility.ToJson(report);
                if (Encoding.UTF8.GetByteCount(json) > MaximumBytes)
                {
                    report.truncated = true; report.renderers = report.renderers.Take(16).ToArray();
                    json = JsonUtility.ToJson(report);
                }
                if (Encoding.UTF8.GetByteCount(json) > MaximumBytes) throw new InvalidOperationException("Diagnostic exceeds its fixed bound");
                File.WriteAllText(Path.Combine(Application.persistentDataPath, FileName), json, new UTF8Encoding(false));
                Debug.Log("Store startup diagnostic: " + report.reason + ", page=" + report.page +
                    ", ready=" + report.pageReady + ", cameras=" + report.cameraCount + ", canvases=" + report.canvasCount +
                    ", renderers=" + report.rendererCount + ", error=" + (report.error?.type ?? report.inspectionError?.type ?? "none"));
            }
            catch (Exception error) { Debug.LogError("Store startup diagnostic write failed: " + error.GetType().Name); }
            enabled = false;
        }
    }
}
#endif
