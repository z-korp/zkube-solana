using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class SkinKitTests
    {
        private BoardArt art;
        private GameObject root;
        private SkinUi ui;
        [UnitySetUp] public IEnumerator SetUp()
        {
            art = new BoardArt(); yield return art.Load(1);
            root = new GameObject("Skin kit test canvas", typeof(RectTransform), typeof(Canvas));
            root.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            ui = new SkinUi(art, 1, 1);
        }
        [TearDown] public void TearDown()
        {
            ui.Dispose(); Object.Destroy(root); art.Dispose();
        }
        private static PointerEventData At(float x, float y) => new PointerEventData(null) { position = new Vector2(x, y) };
        private static float CenterX(Component piece) => SkinUi.ScreenRect((RectTransform)piece.transform).center.x;
        private static Image Part(Component owner, string name) => owner.GetComponentsInChildren<Image>(true).Single(image => image.name == name);

        [Test] public void SliderPressAndDragSetTheValueFromTheTrackAndClampAtBothEnds()
        {
            var reported = new List<float>();
            var slider = ui.Slider("Music", new Rect(20, 100, 200, 48), .5f, reported.Add, root.transform);
            var track = SkinUi.ScreenRect((RectTransform)Part(slider, "Music track").transform);
            Assert.AreEqual(track.x + track.width / 2, CenterX(Part(slider, "Music knob")), .01f, "The knob starts at the value");
            slider.OnPointerDown(At(track.x + track.width * .25f, 120));
            Assert.AreEqual(.25f, slider.Value, 1e-4f);
            Assert.AreEqual(track.x + track.width * .25f, CenterX(Part(slider, "Music knob")), .01f);
            Assert.AreEqual(track.width * .25f, SkinUi.ScreenRect((RectTransform)slider.transform.Find("Music fill")).width, .01f, "The fill ends at the knob");
            slider.OnDrag(At(5000, 120)); Assert.AreEqual(1, slider.Value);
            slider.OnDrag(At(6000, 120)); Assert.AreEqual(1, slider.Value, "An unchanged value is not reported again");
            slider.OnDrag(At(-50, 120)); Assert.AreEqual(0, slider.Value);
            CollectionAssert.AreEqual(new[] { .25f, 1f, 0f }, reported);
            slider.SetWithoutNotify(.75f);
            Assert.AreEqual(.75f, slider.Value); Assert.AreEqual(3, reported.Count);
            Assert.Throws<System.ArgumentOutOfRangeException>(() => slider.SetWithoutNotify(float.NaN));
        }

        [Test] public void ToggleTapFlipsItAndMovesTheKnobToThatSide()
        {
            var reported = new List<bool>();
            var toggle = ui.Toggle("Haptics", new Rect(0, 0, 300, 48), false, reported.Add, root.transform);
            var track = SkinUi.ScreenRect((RectTransform)Part(toggle, "Haptics track").transform);
            float left = CenterX(Part(toggle, "Haptics knob"));
            Assert.IsFalse(Part(toggle, "Haptics on").enabled);
            toggle.OnPointerClick(At(250, 24));
            Assert.IsTrue(toggle.Value); Assert.IsTrue(Part(toggle, "Haptics on").enabled);
            Assert.Greater(CenterX(Part(toggle, "Haptics knob")), left);
            Assert.LessOrEqual(SkinUi.ScreenRect((RectTransform)Part(toggle, "Haptics knob").transform).xMax, track.xMax + .01f);
            toggle.OnPointerClick(At(250, 24));
            CollectionAssert.AreEqual(new[] { true, false }, reported);
            toggle.SetWithoutNotify(true); Assert.IsTrue(toggle.Value); Assert.AreEqual(2, reported.Count);
        }

        [Test] public void TabBarTabsRunTheirActionAndSelectMovesThePlate()
        {
            var opened = new List<string>();
            var bar = ui.TabBar("Tabs", new Rect(0, 0, 360, 64), new (string, string, System.Action)[]
            {
                (SkinSlots.IconCampaign, "Campaign", () => opened.Add("Campaign")),
                (SkinSlots.IconDaily, "Daily", () => opened.Add("Daily")),
                (SkinSlots.IconProfile, "Profile", () => opened.Add("Profile")),
            }, 1, root.transform);
            var plate = (RectTransform)Part(bar, "Tabs selected").transform;
            var daily = (RectTransform)Part(bar, "Tabs Daily").transform;
            Assert.AreEqual(SkinUi.ScreenRect(daily), SkinUi.ScreenRect(plate));
            Part(bar, "Tabs Profile").GetComponent<Button>().onClick.Invoke();
            CollectionAssert.AreEqual(new[] { "Profile" }, opened);
            bar.Select(2);
            Assert.AreEqual(SkinUi.ScreenRect((RectTransform)Part(bar, "Tabs Profile").transform), SkinUi.ScreenRect(plate));
            foreach (var tab in new[] { "Campaign", "Daily", "Profile" })
                Assert.GreaterOrEqual(SkinUi.ScreenRect((RectTransform)Part(bar, "Tabs " + tab).transform).height, BoardLayout.MinimumTouchDp);
            Assert.Throws<System.ArgumentOutOfRangeException>(() => bar.Select(3));
        }

        [Test] public void EarnedStarsAreNeverDrawnLargerThanTheirSource()
        {
            string Name(bool earned, float pixels) => ui.StarSprite(earned, pixels).name.Replace("(Clone)", "");
            Assert.AreEqual("star-on", Name(true, 48));
            Assert.AreEqual("star-on", Name(true, 96));
            Assert.AreEqual("star-big", Name(true, 97));
            Assert.AreEqual("star-off", Name(false, 200));
            Assert.AreEqual("star-big", ui.Star("Result star", new Rect(0, 0, 160, 160), true, root.transform).sprite.name.Replace("(Clone)", ""));
        }

        [Test] public void ListRowAndCardTextFitsTheirPieces()
        {
            ui.ListRow("Best Daily", new Rect(0, 0, 320, 56), SkinSlots.IconTrophy, "Best Daily", "1,248", null, root.transform, out var label, out var value);
            ui.Card("Settings card", new Rect(0, 100, 320, 240), "SETTINGS", root.transform, out var heading);
            foreach (TMP_Text text in new[] { label, value, heading })
            {
                text.ForceMeshUpdate();
                Assert.IsFalse(text.isTextTruncated, text.name);
                Assert.LessOrEqual(text.GetPreferredValues(text.text, text.rectTransform.rect.width, float.PositiveInfinity).y, text.rectTransform.rect.height + .5f, text.name);
            }
            Assert.LessOrEqual(label.rectTransform.rect.xMax + label.rectTransform.anchoredPosition.x, value.rectTransform.anchoredPosition.x, "Label and value do not overlap");
        }
    }
}
