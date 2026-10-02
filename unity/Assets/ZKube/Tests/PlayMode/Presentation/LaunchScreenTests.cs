using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    public sealed class LaunchScreenTests
    {
        private GameObject root;
        private bool reduced, drawn;
        [SetUp] public void SetUp()
        {
            reduced = AppPreferences.ReducedMotion; AppPreferences.SetReducedMotion(false);
            root = new GameObject("Launch test"); drawn = false;
        }
        [TearDown] public void TearDown()
        {
            Object.Destroy(root); AppPreferences.SetReducedMotion(reduced);
        }
        private LaunchScreen Launch() => LaunchScreen.Create(root.transform, () => drawn, 1);
        private T Named<T>(string name) where T : Component => root.GetComponentsInChildren<T>(true).Single(c => c.name == name);
        private static void Near(Rect expected, Rect actual, string what)
        {
            Assert.AreEqual(expected.x, actual.x, .01f, what + " left"); Assert.AreEqual(expected.y, actual.y, .01f, what + " bottom");
            Assert.AreEqual(expected.width, actual.width, .01f, what + " width"); Assert.AreEqual(expected.height, actual.height, .01f, what + " height");
        }

        // The first frame is the launch window's picture: the full scene where the
        // window draws it, then the lockup and the loading line under it, live
        // layers placed on the scene's canvas as the art pack lays them out.
        [Test] public void TheSplashSitsWhereTheLaunchWindowDrawsItWithTheLoadingLineUnderItsLockup()
        {
            var launch = Launch();
            var painting = SkinUi.ScreenRect(launch.Painting.rectTransform);
            Assert.AreEqual(LaunchScreen.Canvas, launch.Painting.sprite.rect.size, "The staged product splash");
            Near(LaunchScreen.WindowRect(LaunchScreen.Canvas, 160, Screen.width, Screen.height), painting, "Where the window draws it");
            var backdrop = SkinUi.ScreenRect(Named<Image>("Launch backdrop").rectTransform);
            Assert.AreEqual(new Rect(0, 0, Screen.width, Screen.height), backdrop); Assert.AreEqual(Color.black, Named<Image>("Launch backdrop").color);
            var lockup = SkinUi.ScreenRect(launch.Lockup.rectTransform);
            Assert.AreEqual(LaunchScreen.OnPainting(painting, LaunchScreen.LockupOnCanvas).x, lockup.x, .01f, "The lockup keeps its place on the scene");
            Assert.AreEqual(LaunchScreen.OnPainting(painting, LaunchScreen.LockupOnCanvas).width, lockup.width, .01f);
            var track = SkinUi.ScreenRect(Named<Image>("Launch track").rectTransform);
            Near(LaunchScreen.OnPainting(painting, LaunchScreen.LineOnCanvas), track, "The loading line keeps its place on the scene");
            Assert.Less(track.yMax, lockup.yMin, "The line sits under the lockup");
            Assert.AreEqual("slider-track", Named<Image>("Launch track").sprite.name.Replace("(Clone)", ""));
            Assert.AreEqual("slider-fill", Named<Image>("Launch progress").sprite.name.Replace("(Clone)", ""));
            Assert.IsFalse(root.GetComponentsInChildren<Graphic>().Any(g => g.raycastTarget), "It never takes input");
        }

        [Test] public void TheWindowGeometryIsAndroidsDensityScaledIntegerCentring()
        {
            // BitmapDrawable scales from xxhdpi with rounding; Gravity.CENTER truncates toward zero.
            Assert.AreEqual(new Rect(0, 0, 1200, 2670), LaunchScreen.WindowRect(new Vector2(1200, 2670), 480, 1200, 2670));
            Assert.AreEqual(new Rect(-10, -4, 1100, 2448), LaunchScreen.WindowRect(new Vector2(1200, 2670), 440, 1080, 2440), "Seeker-class 440 dpi");
            var small = LaunchScreen.WindowRect(new Vector2(1200, 2670), 480, 1080, 1920);
            Assert.AreEqual(new Rect(-60, -375, 1200, 2670), small, "360 x 640 dp crops the painting's edges");
            Assert.AreEqual(new Rect(60, 0, 1200, 2670), LaunchScreen.WindowRect(new Vector2(1200, 2670), 480, 1320, 2670), "A wider screen shows black sides");
        }

        // The loading screen lives, as the old client's did: the scene breathes in
        // a slow zoom from its window size, motes of light rise through it and the
        // lockup rises in over it.
        [UnityTest] public IEnumerator TheSceneBreathesItsMotesRiseAndItsLockupRisesIn()
        {
            var launch = Launch();
            var scene = launch.Painting.rectTransform;
            var motes = root.GetComponentsInChildren<Image>().Where(image => image.name == "Launch mote").ToArray();
            Assert.AreEqual(LaunchScreen.Motes, motes.Length);
            var before = motes.Select(mote => mote.rectTransform.anchoredPosition).ToArray();
            Assert.Less(launch.Lockup.color.a, .5f, "The lockup rises in over the window's picture");
            for (float end = Time.realtimeSinceStartup + LaunchScreen.LockupSeconds + .2f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.AreEqual(1, launch.Lockup.color.a, .001f, "The lockup is in");
            Assert.Greater(scene.localScale.x, 1, "The scene zooms in");
            Assert.LessOrEqual(scene.localScale.x, 1 + LaunchScreen.ZoomLift + .0001f);
            Assert.IsTrue(motes.Where((mote, i) => mote.rectTransform.anchoredPosition.y > before[i].y).Count() > LaunchScreen.Motes / 2, "The motes rise");
            Assert.IsTrue(motes.Any(mote => mote.color.a > 0), "The motes are lit");
        }

        [UnityTest] public IEnumerator TheSegmentSweepsUntilTheFirstPageThenAVeilClosesAndOpensOnThePage()
        {
            var launch = Launch();
            var segment = Named<Image>("Launch progress").rectTransform;
            var track = SkinUi.ScreenRect(Named<Image>("Launch track").rectTransform);
            float first = segment.anchoredPosition.x;
            for (float end = Time.realtimeSinceStartup + .3f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.AreNotEqual(first, segment.anchoredPosition.x, "The segment sweeps");
            Assert.LessOrEqual(SkinUi.ScreenRect(segment).xMax, track.xMax + .01f, "It stays on the track");
            Assert.IsTrue(launch != null && !launch.Leaving, "It waits for the first page");
            drawn = true;
            bool closed = false;
            for (float end = Time.realtimeSinceStartup + LaunchScreen.VeilCloseSeconds + LaunchScreen.VeilOpenSeconds + .5f;
                 launch != null && Time.realtimeSinceStartup < end;)
            {
                yield return null;
                if (launch == null) break;
                bool splash = launch.Painting.gameObject.activeInHierarchy;
                // Never two pictures at once: the splash stays whole under the closing veil, and is gone before it opens.
                Assert.AreEqual(1, launch.Painting.color.a); Assert.AreEqual(1, launch.GetComponent<CanvasGroup>().alpha);
                if (!splash) closed = true;
                if (splash) Assert.IsFalse(closed, "The splash never returns");
                if (closed) Assert.IsFalse(splash);
            }
            Assert.IsTrue(closed, "The veil closed over the splash before opening");
            Assert.IsTrue(launch == null, "It opens on the page and goes");
        }

        [UnityTest] public IEnumerator ReducedMotionHoldsTheSceneTheSegmentAndCuts()
        {
            AppPreferences.SetReducedMotion(true);
            var launch = Launch();
            var segment = Named<Image>("Launch progress").rectTransform;
            for (float end = Time.realtimeSinceStartup + .3f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.AreEqual(0, segment.anchoredPosition.x, .01f);
            Assert.AreEqual(1, launch.Painting.rectTransform.localScale.x, "The scene holds its size");
            Assert.AreEqual(1, launch.Lockup.color.a, "The lockup is there at once");
            Assert.IsTrue(root.GetComponentsInChildren<Image>().Where(image => image.name == "Launch mote").All(mote => mote.color.a == 0), "No motes drift");
            drawn = true; yield return null; yield return null;
            Assert.IsTrue(launch == null, "It goes at once");
        }
    }
}
