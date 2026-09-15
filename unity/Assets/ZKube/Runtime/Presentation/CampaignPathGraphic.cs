using System;
using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class CampaignPathGraphic : MaskableGraphic
    {
        // Keep the authored normalized path; stretch only its scroll height where
        // physical touch targets would otherwise overlap. Horizontal separation
        // already resolves same-height pairs in the published paths.
        public static float RequiredMapHeight(PageCatalog.RealmPage page, float width, float size, float preferred)
        {
            if (width <= 0 || size <= 0) throw new ArgumentOutOfRangeException("map size");
            float height = preferred;
            for (int i = 0; i < page.campaignPath.Length; i++)
            {
                var a = page.campaignPath[i];
                if (Mathf.Min(a.x, 1 - a.x) * width < size / 2)
                    throw new InvalidOperationException("The Campaign path needs a wider view.");
                float edge = Mathf.Min(a.y, 1 - a.y);
                if (edge <= 0) throw new InvalidOperationException("The Campaign path needs room around each trial.");
                height = Mathf.Max(height, size / (2 * edge));
                for (int j = i + 1; j < page.campaignPath.Length; j++)
                {
                    var b = page.campaignPath[j];
                    if (Mathf.Abs(a.x - b.x) * width >= size) continue;
                    float dy = Mathf.Abs(a.y - b.y);
                    if (dy == 0) throw new InvalidOperationException("The Campaign path needs a wider view.");
                    height = Mathf.Max(height, size / dy);
                }
            }
            return Mathf.Ceil(height);
        }
        private PageCatalog.RealmPage realm;
        private PageCatalog.PathStyle pathStyle;
        private string[] states;
        public void Configure(PageCatalog.RealmPage page, string[] nodeStates, PageCatalog.PathStyle publishedStyle = null)
        {
            if (page?.campaignPath?.Length != 10 || nodeStates?.Length != 10) throw new ArgumentException("Campaign path requires ten nodes");
            realm = page; pathStyle = publishedStyle ?? page.map; states = (string[])nodeStates.Clone(); raycastTarget = false; SetVerticesDirty();
        }
        public static string EdgeState(string from, string to) => from == "cleared" && to == "cleared" ? "cleared" :
            from == "cleared" && (to == "current" || to == "playing") ? "active" : "locked";
        // Exact cubic controls from MapPage: C fromX,midY toX,midY toX,toY.
        public static Vector2 Curve(Vector2 from, Vector2 to, float t)
        {
            float u = 1 - t, middle = (from.y + to.y) / 2;
            return u * u * u * from + 3 * u * u * t * new Vector2(from.x, middle) +
                3 * u * t * t * new Vector2(to.x, middle) + t * t * t * to;
        }
        protected override void OnPopulateMesh(VertexHelper mesh)
        {
            mesh.Clear(); if (realm == null) return;
            var rect = rectTransform.rect; float scale = rect.width / 60;
            for (int edge = 0; edge < 9; edge++)
            {
                string state = EdgeState(states[edge], states[edge + 1]);
                var style = pathStyle; float[] rgba = state == "cleared" ? style.clearedRgba : state == "active" ? style.activeRgba : style.lockedRgba;
                var ink = new Color(rgba[0], rgba[1], rgba[2], rgba[3] * (state == "locked" ? .5f : .85f));
                float width = state == "locked" ? style.lockedStrokeWidth : style.strokeWidth;
                string dash = state == "locked" ? style.lockedDash : style.pathStyle == "dashed" ? "8 4" : style.pathStyle == "dotted" ? "2 3" : null;
                var a = realm.campaignPath[edge]; var b = realm.campaignPath[edge + 1];
                var from = new Vector2(rect.xMin + a.x * rect.width, rect.yMax - a.y * rect.height);
                var to = new Vector2(rect.xMin + b.x * rect.width, rect.yMax - b.y * rect.height);
                if (style.pathStyle == "double") Stroke(mesh, from, to, (width + 1.6f) * scale, new Color(ink.r, ink.g, ink.b, ink.a * .35f), dash, scale);
                Stroke(mesh, from, to, width * scale, ink, dash, scale);
            }
        }
        private static void Stroke(VertexHelper mesh, Vector2 from, Vector2 to, float width, Color ink, string dash, float scale)
        {
            float on = float.PositiveInfinity, off = 0, distance = 0;
            if (!string.IsNullOrEmpty(dash))
            {
                var pieces = dash.Split(' '); on = float.Parse(pieces[0], System.Globalization.CultureInfo.InvariantCulture) * scale;
                off = float.Parse(pieces[1], System.Globalization.CultureInfo.InvariantCulture) * scale;
            }
            Vector2 previous = from;
            for (int step = 1; step <= 96; step++)
            {
                var next = Curve(from, to, step / 96f); float length = Vector2.Distance(previous, next);
                if (distance % (on + off) < on && length > 0)
                {
                    var normal = new Vector2(-(next - previous).y, (next - previous).x).normalized * width / 2;
                    int index = mesh.currentVertCount;
                    mesh.AddVert(previous - normal, ink, Vector2.zero); mesh.AddVert(previous + normal, ink, Vector2.zero);
                    mesh.AddVert(next + normal, ink, Vector2.zero); mesh.AddVert(next - normal, ink, Vector2.zero);
                    mesh.AddTriangle(index, index + 1, index + 2); mesh.AddTriangle(index, index + 2, index + 3);
                }
                distance += length; previous = next;
            }
        }
    }
}
