using System;
using System.Collections;
using System.IO;
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
}
