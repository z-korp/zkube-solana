using System;
using System.Collections;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // Evidence captures of a page as a test draws it: with ZKUBE_CAPTURES set to
    // a folder, Snap writes the simulated screen there as raw RGBA rows, bottom
    // row first; without it, Snap does nothing.
    public static class Captures
    {
        public static IEnumerator Snap(PageShell shell, string name) => Snap(shell.ScreenArea, name);
        public static IEnumerator Snap(Rect area, string name)
        {
            string folder = Environment.GetEnvironmentVariable("ZKUBE_CAPTURES");
            if (string.IsNullOrEmpty(folder)) yield break;
            Directory.CreateDirectory(folder);
            yield return new WaitForEndOfFrame();
            var texture = new Texture2D((int)area.width, (int)area.height, TextureFormat.RGBA32, false);
            try
            {
                texture.ReadPixels(new Rect(area.x, area.y, area.width, area.height), 0, 0); texture.Apply();
                File.WriteAllBytes(Path.Combine(folder, name.Replace(' ', '-').Replace('/', '-') + "-" + (int)area.width + "x" + (int)area.height + ".rgba"),
                    texture.GetRawTextureData());
            }
            finally { UnityEngine.Object.Destroy(texture); }
        }
    }

    // A lesson's evidence: every piece the guardian teaches with stands on the
    // screen, and with ZKUBE_CAPTURES set the screen is captured.
    public static class LessonEvidence
    {
        private static readonly string[] Pieces = { "Lesson bubble", "Lesson card", "Guardian hand", "Lesson talk", "Skip lesson", "Skip tips", "Opens chip" };
        public static IEnumerator Snap(Component scope, string name)
        {
            yield return null; Canvas.ForceUpdateCanvases();
            var screen = new Rect(0, 0, Screen.width, Screen.height);
            foreach (var piece in scope.GetComponentsInChildren<RectTransform>().Where(rect => rect.gameObject.activeInHierarchy && Pieces.Contains(rect.name)))
            {
                var rect = SkinUi.ScreenRect(piece);
                Assert.That(rect.xMin >= -1 && rect.yMin >= -1 && rect.xMax <= screen.xMax + 1 && rect.yMax <= screen.yMax + 1, Is.True,
                    name + ": " + piece.name + " " + rect + " stands on the " + screen.width + " x " + screen.height + " screen");
            }
            // No lesson bubble covers another.
            var bubbles = scope.GetComponentsInChildren<RectTransform>().Where(rect => rect.gameObject.activeInHierarchy && rect.name == "Lesson bubble")
                .Select(SkinUi.ScreenRect).ToArray();
            for (int i = 0; i < bubbles.Length; i++)
                for (int j = i + 1; j < bubbles.Length; j++)
                    Assert.That(bubbles[i].Overlaps(bubbles[j]), Is.False, name + ": two lesson bubbles overlap");
            // On the board a bubble leaves visible every piece it pulses (the glow's
            // own piece, 1/1.4 of it), the stack with the row about to rise, and the
            // next row with everything under it.
            var board = scope.GetComponentsInChildren<BoardController>().FirstOrDefault(value => value.isActiveAndEnabled && value.View != null && value.State != null);
            if (board != null && bubbles.Length > 0)
            {
                var layout = board.View.Layout; var grid = board.State.Grid;
                int height = Enumerable.Range(0, 10).Where(row => Enumerable.Range(0, 8).Any(column => grid[row * 8 + column] != 0)).Select(row => row + 1).DefaultIfEmpty(0).Max();
                var clear = new List<(string what, Rect rect)> {
                    ("the stack", new Rect(layout.Board.x, layout.Board.y, layout.Board.width, Mathf.Min(10, height + 1) * layout.Cell)),
                    ("the next row and the controls", new Rect(0, 0, Screen.width, Mathf.Max(layout.Tray.yMax, board.View.Hud.NextLabel.yMax))) };
                foreach (var glow in scope.GetComponentsInChildren<RectTransform>().Where(rect => rect.gameObject.activeInHierarchy && rect.name == "Lesson glow"))
                {
                    var halo = SkinUi.ScreenRect(glow); float w = halo.width / 1.4f, h = halo.height / 1.4f;
                    clear.Add(("a pulsing piece", new Rect(halo.x + .2f * w, halo.y + .2f * h, w, h)));
                }
                foreach (var bubble in bubbles)
                    foreach (var (what, rect) in clear)
                        Assert.That(bubble.Overlaps(rect), Is.False, name + ": a lesson bubble " + bubble + " covers " + what + " " + rect);
            }
            // Every lesson line is at least the pages' readable caption size.
            foreach (var line in scope.GetComponentsInChildren<TMPro.TMP_Text>().Where(text => text.gameObject.activeInHierarchy && text.name == "Lesson line"))
                Assert.That(line.fontSize, Is.GreaterThanOrEqualTo(13 - .01f), name + ": a lesson line is at least 13 dp");
            yield return Captures.Snap(screen, name);
        }
    }
}
