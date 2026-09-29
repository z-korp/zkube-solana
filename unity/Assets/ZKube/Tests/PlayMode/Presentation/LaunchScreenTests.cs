using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
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

        [Test] public void TheSplashSitsWhereTheLaunchWindowDrawsItWithTheLoadingLineUnderItsLockup()
        {
            var launch = Launch();
            var painting = SkinUi.ScreenRect(launch.Painting.rectTransform);
            Assert.AreEqual(new Vector2(1200, 2670), launch.Painting.sprite.rect.size, "The staged product splash");
            Assert.AreEqual(LaunchScreen.WindowRect(new Vector2(1200, 2670), 160, Screen.width, Screen.height), painting, "Where the window draws it");
            var backdrop = SkinUi.ScreenRect(Named<Image>("Launch backdrop").rectTransform);
            Assert.AreEqual(new Rect(0, 0, Screen.width, Screen.height), backdrop); Assert.AreEqual(Color.black, Named<Image>("Launch backdrop").color);
            var opening = Named<TMP_Text>("Launch opening"); var preparing = Named<TMP_Text>("Launch preparing");
            Assert.AreEqual(LaunchScreen.Opening, opening.text); Assert.AreEqual(LaunchScreen.Preparing, preparing.text);
            float Top(Component c) => SkinUi.ScreenRect((RectTransform)c.transform).yMax;
            float FromTop(float dp) => painting.yMax - dp / 890 * painting.height;
            Assert.AreEqual(FromTop(650), Top(opening), .01f, "The line keeps its place on the painting");
            Assert.AreEqual(FromTop(704), Top(Named<Image>("Launch track")), .01f);
            Assert.AreEqual(FromTop(740), Top(preparing), .01f);
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

        [UnityTest] public IEnumerator ReducedMotionHoldsTheSegmentAndCuts()
        {
            AppPreferences.SetReducedMotion(true);
            var launch = Launch();
            var segment = Named<Image>("Launch progress").rectTransform;
            yield return null; yield return null;
            Assert.AreEqual(0, segment.anchoredPosition.x, .01f);
            drawn = true; yield return null; yield return null;
            Assert.IsTrue(launch == null, "It goes at once");
        }
    }
}
