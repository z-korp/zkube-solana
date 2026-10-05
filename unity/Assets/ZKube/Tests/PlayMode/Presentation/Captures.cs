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
            foreach (var piece in UnityEngine.Object.FindObjectsByType<RectTransform>(FindObjectsSortMode.None).Where(rect => rect.gameObject.activeInHierarchy && Pieces.Contains(rect.name)))
            {
                var rect = SkinUi.ScreenRect(piece);
                Assert.That(rect.xMin >= -1 && rect.yMin >= -1 && rect.xMax <= screen.xMax + 1 && rect.yMax <= screen.yMax + 1, Is.True,
                    name + ": " + piece.name + " " + rect + " stands on the " + screen.width + " x " + screen.height + " screen");
            }
            // On the board each line stands by the rule of its kind, drawn in the
            // board's own interface: what a device draws, whatever hosts the board.
            var coach = UnityEngine.Object.FindObjectsByType<BoardCoach>(FindObjectsSortMode.None).FirstOrDefault(value => value.isActiveAndEnabled && value.Tips.Count > 0);
            if (coach != null) Board(coach, name);
            // Every lesson line is at least the pages' readable caption size.
            foreach (var line in UnityEngine.Object.FindObjectsByType<TMPro.TMP_Text>(FindObjectsSortMode.None).Where(text => text.gameObject.activeInHierarchy && text.name == "Lesson line"))
                Assert.That(line.fontSize, Is.GreaterThanOrEqualTo(13 - .01f), name + ": a lesson line is at least 13 dp");
            yield return Captures.Snap(screen, name);
        }

        // A callout stands beside its piece with its tail's tip on the piece's
        // edge while the piece pulses; the guardian's own speech has its tail at
        // the guardian's mouth, off its eyes, and never says "here" or "this". No
        // bubble covers a pulsing piece, a cell the hand points at, the guardian's
        // face, the crown, a plate, the next row or a control, or another bubble.
        public static void Board(BoardCoach coach, string name)
        {
            var board = UnityEngine.Object.FindObjectsByType<BoardController>(FindObjectsSortMode.None).Single(value => value.isActiveAndEnabled && value.View != null && value.State != null);
            var view = board.View; var layout = view.Layout; var hud = view.Hud; float u = hud.K * layout.Density;
            var host = view.Interface;
            RectTransform[] Named(string piece) => host.GetComponentsInChildren<RectTransform>().Where(rect => rect.gameObject.activeInHierarchy && rect.name == piece).ToArray();
            Assert.That(Named("Lesson bubble").Length, Is.EqualTo(coach.Tips.Count), name + ": every line is drawn in the board's interface");
            var pulses = host.Find("Guardian pulses"); var lessons = host.Find("Guardian lessons");
            Assert.That(pulses.GetSiblingIndex(), Is.Zero, name + ": the pulses are drawn behind the interface's pieces");
            Assert.That(lessons.GetSiblingIndex(), Is.EqualTo(host.childCount - 1), name + ": the lessons are drawn over them");
            var lit = Named("Lesson glow").Select(glow => { var halo = SkinUi.ScreenRect(glow); float w = halo.width / 1.4f, h = halo.height / 1.4f;
                return new Rect(halo.x + .2f * w, halo.y + .2f * h, w, h); }).ToArray();
            bool Same(Rect a, Rect b) => Mathf.Abs(a.x - b.x) < 1 && Mathf.Abs(a.y - b.y) < 1 && Mathf.Abs(a.width - b.width) < 1 && Mathf.Abs(a.height - b.height) < 1;
            var needed = new List<(string what, Rect rect)> { ("the guardian's face", view.Kit.Art.FaceIn(hud.Guardian)), ("the crown", hud.Crown), ("the next row", layout.Tray),
                ("pause", layout.PauseButton), ("the bonus", layout.GuardianButton), ("the reroll", layout.RerollButton) };
            needed.AddRange(hud.Plates.Select(plate => ("a goal plate", plate)));
            needed.AddRange(coach.Hinted.Select(cell => ("a cell the hand points at", cell)));
            needed.AddRange(coach.Tips.Where(tip => tip.About.HasValue).Select(tip => ("a piece a callout is about", tip.About.Value)));
            for (int i = 0; i < coach.Tips.Count; i++)
            {
                var tip = coach.Tips[i]; string at = name + ": \"" + tip.Line + "\"";
                var point = SkinUi.TailTip(tip.Tail);
                Assert.That(tip.Tail.GetComponent<UnityEngine.UI.Image>().preserveAspect, Is.False, at + ": the tail is drawn to its tip");
                if (tip.About is Rect piece)
                {
                    var grown = new Rect(piece.x - 1, piece.y - 1, piece.width + 2, piece.height + 2);
                    var inside = new Rect(piece.x + 1, piece.y + 1, piece.width - 2, piece.height - 2);
                    Assert.That(grown.Contains(point) && !inside.Contains(point), Is.True, at + ": the tail's tip " + point + " is on its piece's edge " + piece);
                    float apart = Mathf.Max(Mathf.Max(piece.xMin - tip.Body.xMax, tip.Body.xMin - piece.xMax), Mathf.Max(piece.yMin - tip.Body.yMax, tip.Body.yMin - piece.yMax));
                    Assert.That(apart, Is.InRange(BoardCoach.CalloutTailU * u - 1, (BoardCoach.CalloutTailU + BoardCoach.CalloutReachU) * u + 1), at + ": the callout stands by its piece");
                    Assert.That(lit.Any(glow => Same(glow, piece)), Is.True, at + ": its piece pulses");
                }
                else
                {
                    var mouth = view.Kit.Art.MouthIn(hud.Guardian); var eyes = view.Kit.Art.EyesIn(hud.Guardian);
                    Assert.That(Vector2.Distance(point, mouth), Is.LessThanOrEqualTo(.12f * hud.Guardian.width), at + ": the tail's tip " + point + " is at the guardian's mouth " + mouth);
                    Assert.That(eyes.Contains(point), Is.False, at + ": the tail stays off the eyes");
                    Assert.That(System.Text.RegularExpressions.Regex.IsMatch(tip.Line, @"\b(here|this)\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase), Is.False,
                        at + ": only a callout says here or this");
                }
                foreach (var (what, rect) in needed)
                    if (!(tip.About is Rect own && Same(own, rect)))
                        Assert.That(tip.Body.Overlaps(rect), Is.False, at + ": the bubble " + tip.Body + " covers " + what + " " + rect);
                for (int j = i + 1; j < coach.Tips.Count; j++)
                    Assert.That(tip.Body.Overlaps(coach.Tips[j].Body), Is.False, at + ": two bubbles overlap");
            }
        }
    }
}
