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

        [Test] public void TheSplashCoversTheScreenWithTheLoadingLineUnderItsLockup()
        {
            var launch = Launch();
            var painting = SkinUi.ScreenRect(launch.Painting.rectTransform);
            Assert.AreEqual(new Vector2(1200, 2670), launch.Painting.sprite.rect.size, "The staged product splash");
            Assert.LessOrEqual(painting.xMin, 0.01f); Assert.GreaterOrEqual(painting.xMax, Screen.width - .01f);
            Assert.LessOrEqual(painting.yMin, 0.01f); Assert.GreaterOrEqual(painting.yMax, Screen.height - .01f);
            Assert.AreEqual(painting.width / painting.height, 1200f / 2670, .001f, "The painting keeps its aspect");
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

        [UnityTest] public IEnumerator TheSegmentSweepsUntilTheFirstPageThenTheScreenFades()
        {
            var launch = Launch();
            var segment = Named<Image>("Launch progress").rectTransform;
            var track = SkinUi.ScreenRect(Named<Image>("Launch track").rectTransform);
            float first = segment.anchoredPosition.x;
            for (float end = Time.realtimeSinceStartup + .3f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.AreNotEqual(first, segment.anchoredPosition.x, "The segment sweeps");
            Assert.LessOrEqual(SkinUi.ScreenRect(segment).xMax, track.xMax + .01f, "It stays on the track");
            for (float end = Time.realtimeSinceStartup + .3f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.IsTrue(launch != null, "It waits for the first page");
            drawn = true;
            for (float end = Time.realtimeSinceStartup + LaunchScreen.FadeSeconds + .2f; Time.realtimeSinceStartup < end;) yield return null;
            Assert.IsTrue(launch == null, "It fades out and goes");
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
