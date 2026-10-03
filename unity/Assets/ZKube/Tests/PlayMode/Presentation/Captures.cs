using System;
using System.Collections;
using System.IO;
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
            yield return Captures.Snap(screen, name);
        }
    }
}
