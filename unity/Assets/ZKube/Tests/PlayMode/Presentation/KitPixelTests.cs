using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    // Pixel checks of the kit as it is drawn: each sliced piece rendered from
    // its atlas at twice its size, and the text underpaint.
    public sealed class KitPixelTests
    {
        private BoardArt art;
        [UnitySetUp] public IEnumerator SetUp() { art = new BoardArt(); yield return art.Load(1); }
        [TearDown] public void TearDown() => art.Dispose();

        // Renders one UI image into a texture of the given size on a solid background.
        private static Color32[] Render(int width, int height, Color background, Action<RectTransform> draw)
        {
            var target = new RenderTexture(width, height, 24, RenderTextureFormat.ARGB32);
            var camera = new GameObject("Kit capture camera").AddComponent<Camera>();
            camera.targetTexture = target; camera.clearFlags = CameraClearFlags.SolidColor; camera.backgroundColor = background;
            camera.orthographic = true; camera.cullingMask = 1 << 5;
            var canvas = new GameObject("Kit capture canvas", typeof(RectTransform), typeof(Canvas)).GetComponent<Canvas>();
            canvas.gameObject.layer = 5; canvas.renderMode = RenderMode.ScreenSpaceCamera; canvas.worldCamera = camera; canvas.planeDistance = 1;
            try
            {
                Canvas.ForceUpdateCanvases();
                draw((RectTransform)canvas.transform);
                foreach (var t in canvas.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = 5;
                Canvas.ForceUpdateCanvases();
                camera.Render();
                var previous = RenderTexture.active; RenderTexture.active = target;
                var read = new Texture2D(width, height, TextureFormat.RGBA32, false);
                read.ReadPixels(new Rect(0, 0, width, height), 0, 0); read.Apply();
                RenderTexture.active = previous;
                var pixels = read.GetPixels32(); UnityEngine.Object.Destroy(read);
                return pixels;
            }
            finally
            {
                camera.targetTexture = null; UnityEngine.Object.Destroy(camera.gameObject); UnityEngine.Object.Destroy(canvas.gameObject); target.Release();
            }
        }
        private static Image Place(RectTransform canvas, string name, Rect rect)
        {
            var image = new GameObject(name, typeof(RectTransform), typeof(Image)).GetComponent<Image>();
            image.transform.SetParent(canvas, false);
            var r = image.rectTransform; r.anchorMin = r.anchorMax = r.pivot = Vector2.zero;
            r.anchoredPosition = rect.position; r.sizeDelta = rect.size;
            return image;
        }
        private static int Step(Color32 a, Color32 b) => Mathf.Abs(a.r - b.r) + Mathf.Abs(a.g - b.g) + Mathf.Abs(a.b - b.b);

        [Test] public void NoSlicedKitPieceShowsASeamAtItsSliceLinesAtTwiceItsSize()
        {
            var sliced = PageCatalog.Load().DefaultSkin.ui.Where(slot => slot.border.Any(b => b > 0)).ToArray();
            Assert.That(sliced.Length, Is.GreaterThan(10));
            var failures = new List<string>();
            foreach (var entry in sliced)
            {
                var sprite = art.SkinUi(entry.slot);
                int sw = Mathf.RoundToInt(sprite.rect.width), sh = Mathf.RoundToInt(sprite.rect.height), w = sw * 2, h = sh * 2;
                // The piece drawn at its own size is the reference for the steps the art paints.
                Color32[] Draw(int width, int height) => Render(width, height, new Color(.5f, .5f, .5f, 1), canvas =>
                {
                    var image = Place(canvas, entry.slot, new Rect(0, 0, width, height));
                    image.sprite = sprite; image.type = Image.Type.Sliced; image.pixelsPerUnitMultiplier = 100 / sprite.pixelsPerUnit;
                });
                var authored = Draw(sw, sh);
                // Borders at their own pixels, the stretched bands at twice their length.
                var pixels = Draw(w, h);
                var border = sprite.border;
                // A drawn position along a slice line back to the authored one.
                int Source(int drawn, int size, int low, int high)
                {
                    if (drawn < low) return drawn;
                    if (drawn >= size * 2 - high) return drawn - size;
                    return low + (int)((drawn - low) * (size - low - high) / (float)(size * 2 - low - high));
                }
                // A seam is a step across a slice line that the art does not paint there.
                void Check(bool vertical, int drawnLine, int authoredLine)
                {
                    int length = vertical ? h : w, seams = 0;
                    if (authoredLine < 1 || authoredLine > (vertical ? sw : sh) - 1) return;
                    for (int i = 0; i < length; i++)
                    {
                        Color32 D(int offset) => vertical ? pixels[i * w + drawnLine + offset] : pixels[(drawnLine + offset) * w + i];
                        int along = vertical ? Source(i, sh, (int)border.y, (int)border.w) : Source(i, sw, (int)border.x, (int)border.z);
                        Color32 A(int offset) => vertical ? authored[along * sw + authoredLine + offset] : authored[(authoredLine + offset) * sw + along];
                        if (Step(D(-1), D(0)) > Step(A(-1), A(0)) + 48) seams++;
                    }
                    if (seams > 0) failures.Add($"{entry.slot}: {seams} seam pixels on the {(vertical ? "vertical" : "horizontal")} slice line at {authoredLine}");
                }
                Check(true, (int)border.x, (int)border.x); Check(true, w - (int)border.z, sw - (int)border.z);
                Check(false, (int)border.y, (int)border.y); Check(false, h - (int)border.w, sh - (int)border.w);
            }
            Assert.IsEmpty(failures, string.Join("\n", failures));
        }

        [Test] public void TheUnderpaintFadesOverItsWholeRampWithoutAnEdge()
        {
            const int density = 2, width = 400, height = 160;
            var ui = new SkinUi(art, density, 1);
            try
            {
                var text = new Rect(100, 64, 200, 32);
                var pixels = Render(width, height, Color.white, canvas =>
                {
                    var patch = ui.Underpaint("Shade", text, canvas);
                    var r = patch.rectTransform;
                    r.anchorMin = r.anchorMax = r.pivot = Vector2.zero;
                    r.anchoredPosition = new Vector2(text.x - SkinUi.UnderpaintPadDp * density, text.y - SkinUi.UnderpaintPadDp * .75f * density);
                    r.sizeDelta = new Vector2(text.width + 2 * SkinUi.UnderpaintPadDp * density, text.height + 1.5f * SkinUi.UnderpaintPadDp * density);
                });
                // Across the middle row, from the white page into the patch.
                int y = (int)text.center.y, left = (int)(text.x - SkinUi.UnderpaintPadDp * density);
                var row = Enumerable.Range(left - 4, (int)(text.center.x - left)).Select(x => pixels[y * width + x]).ToArray();
                int biggest = row.Zip(row.Skip(1), Step).Max();
                // The fade from 10% to 90% of the patch's darkness, in dp.
                float plateau = row.Min(p => p.r);
                float Shade(Color32 p) => (255f - p.r) / (255f - plateau);
                int ten = Array.FindIndex(row, p => Shade(p) >= .1f), ninety = Array.FindIndex(row, p => Shade(p) >= .9f);
                Assert.Less(biggest, 3 * 24, "No single pixel step reads as an edge");
                Assert.GreaterOrEqual((ninety - ten) / (float)density, 12, "The fade is wide enough not to read as a box");
                Assert.Greater(ninety + left - 4, (int)text.x, "The fade reaches under the words");
            }
            finally { ui.Dispose(); }
        }
    }
}
