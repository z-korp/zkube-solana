using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // Watches every rendered frame of an app for the bare clear colour: each
    // frame either a painting the page shell draws covers the screen whole, or
    // a board under the app has drawn its own. The first frame that has neither
    // is kept, named by the step the test was on.
    public sealed class PaintWatch : MonoBehaviour
    {
        public string Step = "the first page";
        public string Failure { get; private set; }
        public int Frames { get; private set; }
        private PageShell shell;

        public static PaintWatch On(PageShell shell)
        {
            var watch = shell.gameObject.AddComponent<PaintWatch>(); watch.shell = shell;
            watch.StartCoroutine(watch.EveryFrame());
            return watch;
        }
        private IEnumerator EveryFrame()
        {
            while (true)
            {
                yield return new WaitForEndOfFrame();
                Frames++;
                if (Failure == null && !Covered()) Failure = Step + ": frame " + Frames + " shows no painting";
            }
        }
        public bool Covered() => Painted(shell) || FindObjectsByType<BoardController>(FindObjectsSortMode.None).Any(board => board.Drawn);
        public void AssertCovered() { Assert.That(Failure, Is.Null, "A page change showed the clear colour"); Assert.That(Frames, Is.GreaterThan(0)); }
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
