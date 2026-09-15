using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    // One 24-unit, round-stroke family for all board actions. Icons never own
    // input: the enclosing 48 dp or larger button supplies the hit rectangle.
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class BoardActionIcon : MaskableGraphic
    {
        public enum Symbol { Hammer, Totem, Wave, Reroll, Pause }
        private Symbol symbol;
        public Symbol Shape
        {
            get => symbol;
            set { if (symbol != value) { symbol = value; SetVerticesDirty(); } }
        }
        protected override void Awake() { base.Awake(); raycastTarget = false; }
        protected override void OnPopulateMesh(VertexHelper mesh)
        {
            mesh.Clear();
            switch (symbol)
            {
                case Symbol.Hammer:
                    Path(mesh, new Vector2(5, 17), new Vector2(10, 22), new Vector2(17, 15), new Vector2(12, 10), new Vector2(5, 17));
                    Path(mesh, new Vector2(12, 11), new Vector2(19, 4), new Vector2(21, 6), new Vector2(14, 13));
                    break;
                case Symbol.Totem:
                    Path(mesh, new Vector2(5, 21), new Vector2(19, 21), new Vector2(18, 4), new Vector2(12, 2), new Vector2(6, 4), new Vector2(5, 21));
                    Stroke(mesh, new Vector2(8, 15), new Vector2(10, 14));
                    Stroke(mesh, new Vector2(14, 14), new Vector2(16, 15));
                    Path(mesh, new Vector2(9, 8), new Vector2(12, 7), new Vector2(15, 8));
                    break;
                case Symbol.Wave:
                    for (int row = 0; row < 3; row++)
                    {
                        var previous = new Vector2(3, 6 + row * 6);
                        for (int i = 1; i <= 16; i++)
                        {
                            var point = new Vector2(3 + i * 18f / 16, 6 + row * 6 + 1.7f * Mathf.Sin(i * Mathf.PI / 8));
                            Stroke(mesh, previous, point); previous = point;
                        }
                    }
                    break;
                case Symbol.Reroll:
                    var last = new Vector2(12, 4);
                    for (int i = 1; i <= 28; i++)
                    {
                        float angle = (-90 - i * 280f / 28) * Mathf.Deg2Rad;
                        var point = new Vector2(12 + 8 * Mathf.Cos(angle), 12 + 8 * Mathf.Sin(angle));
                        Stroke(mesh, last, point); last = point;
                    }
                    Path(mesh, last + new Vector2(-4, 2), last, last + new Vector2(2, 4));
                    break;
                case Symbol.Pause:
                    Stroke(mesh, new Vector2(8, 4), new Vector2(8, 20));
                    Stroke(mesh, new Vector2(16, 4), new Vector2(16, 20));
                    break;
            }
        }
        private void Path(VertexHelper mesh, params Vector2[] points)
        { for (int i = 1; i < points.Length; i++) Stroke(mesh, points[i - 1], points[i]); }
        private void Stroke(VertexHelper mesh, Vector2 from, Vector2 to)
        {
            const float radius = 1;
            Vector2 normal = new Vector2(-(to - from).y, (to - from).x).normalized * radius;
            int start = mesh.currentVertCount;
            Vertex(mesh, from - normal); Vertex(mesh, from + normal);
            Vertex(mesh, to + normal); Vertex(mesh, to - normal);
            mesh.AddTriangle(start, start + 1, start + 2); mesh.AddTriangle(start, start + 2, start + 3);
            Cap(mesh, from, radius); Cap(mesh, to, radius);
        }
        private void Cap(VertexHelper mesh, Vector2 center, float radius)
        {
            int start = mesh.currentVertCount; Vertex(mesh, center);
            const int sides = 12;
            for (int i = 0; i < sides; i++)
            {
                float angle = i * Mathf.PI * 2 / sides;
                Vertex(mesh, center + new Vector2(Mathf.Cos(angle), Mathf.Sin(angle)) * radius);
            }
            for (int i = 0; i < sides; i++) mesh.AddTriangle(start, start + 1 + i, start + 1 + (i + 1) % sides);
        }
        private void Vertex(VertexHelper mesh, Vector2 point)
        {
            Rect rect = GetPixelAdjustedRect();
            float scale = Mathf.Min(rect.width, rect.height) / 24;
            Vector2 position = rect.center + (point - Vector2.one * 12) * scale;
            mesh.AddVert(position, color, Vector2.zero);
        }
    }
}
