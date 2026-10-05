using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // Watches every rendered frame of an app. Each frame either a painting the
    // page shell draws covers the screen whole, or a board under the app has
    // drawn its own: the first frame that has neither is kept, named by the
    // step the test was on. Within a step it also records which paintings the
    // frames showed, in order, how long one faded in over another, how often
    // the page was drawn, and whether a page left before the next was drawn.
    // Each frame is also heard by exactly one listener; the first that is not is
    // kept the same way.
    public sealed class PaintWatch : MonoBehaviour
    {
        public string Failure { get; private set; }
        public string Unheard { get; private set; }
        public int Frames { get; private set; }
        private PageShell shell;
        private string step = "the first page";
        public string Step { get => step; set { step = value; Begin(); } }

        // The paintings this step's frames showed whole, in order, each once.
        public List<string> Paintings { get; } = new List<string>();
        // The seconds this step spent with one painting fading in over another.
        public float FadeSeconds { get; private set; }
        // How many times this step drew a page.
        public int Draws { get; private set; }
        // Frames of this step with no page drawn on the stage: the page before had left, the next was not drawn yet.
        public int Bare { get; private set; }
        private int drawn;
        private float fadeFrom = -1;

        public static PaintWatch On(PageShell shell)
        {
            var watch = shell.gameObject.AddComponent<PaintWatch>(); watch.shell = shell;
            watch.Begin(); watch.StartCoroutine(watch.EveryFrame());
            return watch;
        }
        private void Begin()
        {
            Paintings.Clear(); FadeSeconds = 0; Draws = 0; Bare = 0; fadeFrom = -1;
            if (shell != null) { drawn = PageId(); if (Whole() is string whole) Paintings.Add(whole); }
        }
        private IEnumerator EveryFrame()
        {
            while (true)
            {
                yield return new WaitForEndOfFrame();
                Frames++;
                if (Failure == null && !Covered()) Failure = Step + ": frame " + Frames + " shows no painting";
                if (Unheard == null && Listeners() != 1) Unheard = Step + ": frame " + Frames + " has " + Listeners() + " listeners";
                if (!shell.Root.activeInHierarchy) { fadeFrom = -1; continue; }
                int page = PageId();
                if (page != 0 && page != drawn) Draws++;
                drawn = page;
                if (page == 0) Bare++;
                string whole = Whole();
                if (whole != null && (Paintings.Count == 0 || Paintings[Paintings.Count - 1] != whole)) Paintings.Add(whole);
                var rising = shell.Background;
                bool fading = rising.sprite != null && rising.color.a < .999f && Leaving() != null;
                if (fading && fadeFrom < 0) fadeFrom = Time.unscaledTime;
                if (!fading && fadeFrom >= 0) { FadeSeconds += Time.unscaledTime - fadeFrom; fadeFrom = -1; }
            }
        }
        // The page drawn on the stage: its first piece, or none.
        private int PageId()
        {
            foreach (var layer in new[] { shell.Page, shell.Overlay })
                if (layer != null && layer.childCount > 0) return layer.GetChild(0).GetInstanceID();
            return 0;
        }
        private Image Leaving() => shell.Root.GetComponentsInChildren<Image>().FirstOrDefault(image => image.name == "Leaving painting" && image.sprite != null);
        // The painting a frame shows whole: the one being left while another fades in over it, else the page's own.
        private string Whole()
        {
            var back = shell.Background;
            var whole = back.sprite != null && back.color.a > .999f ? back.sprite : Leaving()?.sprite;
            return whole == null ? null : Name(whole);
        }
        public static string Name(Sprite sprite) => sprite.texture.name + "/" + sprite.name;
        public bool Covered() => Painted(shell) || FindObjectsByType<BoardController>(FindObjectsSortMode.None).Any(board => board.Drawn);
        public static int Listeners() => FindObjectsByType<AudioListener>(FindObjectsSortMode.None).Count(listener => listener.isActiveAndEnabled);
        public void AssertCovered()
        {
            Assert.That(Failure, Is.Null, "A page change showed the clear colour");
            Assert.That(Unheard, Is.Null, "A frame was not heard by exactly one listener");
            Assert.That(Frames, Is.GreaterThan(0));
        }
        // A page change is one change of painting at most: from the one on
        // screen straight to the next page's, the page before staying until then,
        // drawn once (unless a waiting page stands in for a read), and (with
        // motion) the whole cross-fade played. Returns what this step did otherwise.
        public IEnumerable<string> Strays(string from, string to, bool reducedMotion, bool once = true)
        {
            var expected = from == to ? new[] { to } : new[] { from, to };
            if (!expected.SequenceEqual(Paintings)) yield return Step + ": the paintings shown were " + string.Join(" then ", Paintings) + ", not " + string.Join(" then ", expected);
            if (Bare != 0) yield return Step + ": the page left " + Bare + " frames before the next was drawn";
            if (once && Draws != 1) yield return Step + ": the page was drawn " + Draws + " times";
            if (from != to && !reducedMotion && FadeSeconds < PageShell.EnterSeconds * .7f)
                yield return Step + ": the new painting faded in for " + FadeSeconds.ToString("0.00") + " s of " + PageShell.EnterSeconds + " (" + Draws + " draws)";
        }
        public void Stop() => Destroy(this);

        // An opaque painting the page shell draws over the whole screen: the
        // page's own, or the one it is changing from.
        public static bool Painted(PageShell shell)
        {
            if (!shell.Root.activeInHierarchy || shell.Root.GetComponent<CanvasGroup>().alpha < .999f) return false;
            var screen = shell.ScreenArea;
            return shell.Root.GetComponentsInChildren<Image>().Any(image =>
                (image == shell.Background || image.name == "Leaving painting") && image.enabled && image.sprite != null && image.sprite.texture != null &&
                image.color.a > .999f && image.GetComponentsInParent<CanvasGroup>().All(group => group.alpha > .999f) &&
                SkinUi.ScreenRect(image.rectTransform) is Rect drawn && drawn.xMin <= screen.xMin + .5f && drawn.yMin <= screen.yMin + .5f &&
                drawn.xMax >= screen.xMax - .5f && drawn.yMax >= screen.yMax - .5f);
        }
    }
}
