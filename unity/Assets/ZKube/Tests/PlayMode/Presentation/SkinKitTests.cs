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

        [Test] public void TabBarStaysInsideTheGuttersAndAboveTheSafeBottom()
        {
            var safe = new Rect(0, 24, 360, 616);
            var expected = ScreenKit.TabRect(ui, new Rect(0, 0, 360, 640), safe);
            var bar = ui.TabBar("Tabs", expected, .8f, new (string, string, System.Action)[]
            {
                (SkinSlots.IconCampaign, "Campaign", () => { }), (SkinSlots.IconDaily, "Daily", () => { }),
            }, 0, root.transform);
            var drawn = SkinUi.ScreenRect((RectTransform)bar.transform);
            Assert.AreEqual(expected, drawn, "Pages learn the bar's edges from ScreenKit.TabRect");
            Assert.AreEqual(drawn.xMin - safe.xMin, safe.xMax - drawn.xMax, .01f, "The bar sits between equal gutters");
            Assert.Greater(drawn.yMin, safe.yMin, "The bar sits above the bottom safe inset");
            foreach (var image in bar.GetComponentsInChildren<Image>())
            {
                var piece = SkinUi.ScreenRect(image.rectTransform);
                Assert.IsTrue(piece.xMin >= drawn.xMin - .01f && piece.xMax <= drawn.xMax + .01f && piece.yMin >= drawn.yMin - .01f && piece.yMax <= drawn.yMax + .01f,
                    image.name + " stays inside the bar");
            }
        }

        [Test] public void FourTabLabelsFitInsideTheirChipAtBothWidthsAndTextSizes()
        {
            foreach (var (safe, density) in new[] { (new Rect(0, 0, 360, 640), 1f), (new Rect(0, 0, 1200, 2670), 3f) })
            foreach (float scale in new[] { 1f, 1.3f })
            {
                var sized = new SkinUi(art, density, scale);
                string name = "Fit " + density + " " + scale;
                var kit = new ScreenKit(sized, null, safe, safe);
                var bar = sized.TabBar(name, ScreenKit.TabRect(sized, safe, safe), kit.U, new (string, string, System.Action)[]
                {
                    (SkinSlots.IconCampaign, "Campaign", () => { }), (SkinSlots.IconDaily, "Daily", () => { }), (SkinSlots.IconProfile, "Profile", () => { }),
                    (SkinSlots.IconSettings, "Settings", () => { }),
                }, 0, root.transform);
                foreach (var tab in new[] { "Campaign", "Daily", "Profile", "Settings" })
                {
                    var chip = SkinUi.ScreenRect((RectTransform)Part(bar, name + " " + tab).transform);
                    var label = bar.GetComponentsInChildren<TMP_Text>().Single(t => t.name == name + " " + tab + " label");
                    label.ForceMeshUpdate();
                    float room = sized.TabLabelRoom(chip.width), words = label.textBounds.size.x;
                    string at = tab + " at " + safe.width + "px, text " + scale;
                    Assert.AreEqual(chip.width - 20 * density, room, .01f, "The chip's round ends are 10 dp each");
                    Assert.AreEqual(1, label.textInfo.lineCount, at + " stays on one line");
                    Assert.LessOrEqual(words, room + .5f, at + " stays clear of its chip's round ends");
                    Assert.GreaterOrEqual(label.fontSize, SkinUi.TabLabelMinimumDp * density - .01f, at + " is drawn at 9 dp or more");
                    var text = SkinUi.ScreenRect(label.rectTransform);
                    var icon = SkinUi.ScreenRect((RectTransform)Part(bar, name + " " + tab + " icon").transform);
                    Assert.LessOrEqual(text.yMax, icon.yMin - 2 * kit.U + .01f, at + " sits 2u under its icon");
                    Assert.IsTrue(text.xMin >= chip.xMin && text.xMax <= chip.xMax && text.yMin >= chip.yMin, at + " stays inside its chip");
                }
                // The labels shrink only as far as the widest one needs.
                float drawn = bar.GetComponentsInChildren<TMP_Text>().First().fontSize / (density * scale);
                float space = sized.TabLabelRoom(SkinUi.ScreenRect((RectTransform)Part(bar, name + " Campaign").transform).width);
                if (drawn < SkinUi.TabLabelDp - .01f && drawn > SkinUi.TabLabelMinimumDp / scale + .01f)
                    Assert.Greater(sized.TextWidth("Campaign", drawn + .25f, SkinUi.Type.Caption), space, name + " shrank further than it needed");
                sized.Dispose();
            }
        }

        [Test] public void TabBarTabsRunTheirActionAndSelectMovesThePlate()
        {
            var opened = new List<string>();
            var bar = ui.TabBar("Tabs", ScreenKit.TabRect(ui, new Rect(0, 0, 360, 640), new Rect(0, 0, 360, 640)), .8f, new (string, string, System.Action)[]
            {
                (SkinSlots.IconCampaign, "Campaign", () => opened.Add("Campaign")),
                (SkinSlots.IconDaily, "Daily", () => opened.Add("Daily")),
                (SkinSlots.IconProfile, "Profile", () => opened.Add("Profile")),
            }, 1, root.transform);
            var plate = (RectTransform)Part(bar, "Tabs selected").transform;
            var daily = (RectTransform)Part(bar, "Tabs Daily").transform;
            // A tab takes taps over the bar's height; its chip sits inside the bar's 4u padding.
            Rect Chip(RectTransform tab) { var r = SkinUi.ScreenRect(tab); return new Rect(r.x, r.y + 4 * .8f, r.width, r.height - 8 * .8f); }
            void Same(Rect a, Rect b) { Assert.AreEqual(a.x, b.x, .01f); Assert.AreEqual(a.y, b.y, .01f); Assert.AreEqual(a.width, b.width, .01f); Assert.AreEqual(a.height, b.height, .01f); }
            Same(Chip(daily), SkinUi.ScreenRect(plate));
            Part(bar, "Tabs Profile").GetComponent<Button>().onClick.Invoke();
            CollectionAssert.AreEqual(new[] { "Profile" }, opened);
            bar.Select(2);
            Same(Chip((RectTransform)Part(bar, "Tabs Profile").transform), SkinUi.ScreenRect(plate));
            foreach (var tab in new[] { "Campaign", "Daily", "Profile" })
                Assert.GreaterOrEqual(SkinUi.ScreenRect((RectTransform)Part(bar, "Tabs " + tab).transform).height, BoardLayout.MinimumTouchDp);
            Assert.Throws<System.ArgumentOutOfRangeException>(() => bar.Select(3));
        }

        [UnityTest] public IEnumerator ButtonsSquashWhilePressedAndRestAfterReleaseUnlessMotionIsReduced()
        {
            bool reduced = AppPreferences.ReducedMotion;
            try
            {
                foreach (bool reduce in new[] { false, true })
                {
                    AppPreferences.SetReducedMotion(reduce);
                    var button = ui.TextButton("Play " + reduce, new Rect(40, 40, 200, 56), "Play", () => { }, true, root.transform, out _);
                    var squash = button.GetComponent<PressSquash>();
                    var rect = (RectTransform)button.transform;
                    var resting = SkinUi.ScreenRect(rect);
                    squash.OnPointerDown(At(100, 60));
                    for (float end = Time.realtimeSinceStartup + .2f; Time.realtimeSinceStartup < end;) yield return null;
                    if (reduce) Assert.AreEqual(Vector3.one, rect.localScale);
                    else
                    {
                        Assert.AreEqual(PressSquash.Pressed, rect.localScale.x, .001f, "The face sinks to 97%");
                        Assert.AreEqual(resting.center.x, SkinUi.ScreenRect(rect).center.x, .5f, "The squash keeps the button centred");
                    }
                    squash.OnPointerUp(At(100, 60));
                    Assert.AreEqual(1, squash.Glints, "A glint of light answers the release, whatever the motion setting");
                    var glint = button.GetComponentsInChildren<Image>().Single(image => image.name == "Press glint");
                    Assert.AreEqual("fx-press", glint.sprite.name.Replace("(Clone)", ""));
                    if (!reduce)
                    {
                        float peak = 1;
                        for (float end = Time.realtimeSinceStartup + .15f; Time.realtimeSinceStartup < end;) { peak = Mathf.Max(peak, rect.localScale.x); yield return null; }
                        Assert.Greater(peak, 1.01f, "The release overshoots before it rests");
                    }
                    for (float end = Time.realtimeSinceStartup + .8f; Time.realtimeSinceStartup < end;) yield return null;
                    Assert.IsFalse(button.GetComponentsInChildren<Image>().Any(image => image.name == "Press glint"), "The glint is gone");
                    Assert.AreEqual(Vector3.one, rect.localScale);
                    Assert.AreEqual(resting, SkinUi.ScreenRect(rect));
                }
            }
            finally { AppPreferences.SetReducedMotion(reduced); }
        }

        [UnityTest] public IEnumerator EachRealmServesItsOwnTokensBesideTheSkinTokens()
        {
            var skin = PageCatalog.Load().DefaultSkin;
            foreach (var realm in skin.realms)
            {
                yield return art.Load(realm.realmId);
                foreach (var token in realm.tokens.Concat(skin.tokens))
                    Assert.AreEqual(new Color(token.value[0], token.value[1], token.value[2], token.value[3]), art.Token(token.name),
                        "Realm " + realm.realmId + " " + token.name);
                for (int width = 1; width <= SkinSlots.BlockWidths; width++) art.Token(SkinTokens.BlockTint(width));
                art.Token(SkinTokens.LightKey); art.Token(SkinTokens.LightGlow);
            }
            Assert.Throws<System.InvalidOperationException>(() => art.Token(SkinTokens.BlockTint(SkinSlots.BlockWidths + 1)));
        }

        [Test] public void GlowsAreCappedAndOnlyThreeBreathe()
        {
            var lights = new List<Image>();
            for (int i = 0; i < SkinUi.MaxBreathing; i++) lights.Add(ui.Glow("Breathing " + i, new Rect(0, 0, 40, 40), Color.white, root.transform, 2.4f));
            Assert.Throws<System.InvalidOperationException>(() => ui.Glow("One breath too many", new Rect(0, 0, 40, 40), Color.white, root.transform, 2.4f));
            while (ui.LiveGlows < SkinUi.MaxGlows) lights.Add(ui.Glow("Steady", new Rect(0, 0, 40, 40), SkinUi.WithAlpha(Color.white, .4f), root.transform));
            Assert.AreEqual(.4f, lights[lights.Count - 1].color.a, 1e-4f, "A steady glow keeps its strength");
            Assert.AreEqual("fx-glow", lights[0].sprite.name.Replace("(Clone)", ""));
            Assert.Throws<System.InvalidOperationException>(() => ui.Glow("Ninth", new Rect(0, 0, 40, 40), Color.white, root.transform));
            Object.DestroyImmediate(lights[0].gameObject);
            Assert.DoesNotThrow(() => ui.Glow("Freed", new Rect(0, 0, 40, 40), Color.white, root.transform), "A destroyed glow frees its place");
        }

        [Test] public void SelectedTabInkIsDarkOnTheChipAndTheOthersArePale()
        {
            var bar = ui.TabBar("Tabs", ScreenKit.TabRect(ui, new Rect(0, 0, 360, 640), new Rect(0, 0, 360, 640)), .8f, new (string, string, System.Action)[]
            {
                (SkinSlots.IconCampaign, "Campaign", () => { }), (SkinSlots.IconDaily, "Daily", () => { }),
            }, 0, root.transform);
            var dark = art.Token(SkinTokens.TextOnPrimary);
            Assert.AreEqual(dark, bar.Ink(0));
            Assert.AreEqual(.72f * art.Token(SkinTokens.Text).a, bar.Ink(1).a, 1e-4f);
            bar.Select(1);
            Assert.AreEqual(dark, bar.Ink(1)); Assert.AreEqual(dark, Part(bar, "Tabs Daily icon").color);
            var label = bar.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Tabs Daily label");
            // Four tabs carry their words as the composites set them: the caption face, in sentence case.
            Assert.AreEqual(art.Font(SkinUi.Type.Caption), label.font);
            Assert.IsTrue((label.fontStyle & FontStyles.UpperCase) == 0, "Tab labels are words, not capitals");
            Assert.AreEqual(TextWrappingModes.NoWrap, label.textWrappingMode, "A tab label keeps to one line");
            Assert.IsNotNull(art.Sprite(BoardArt.Mark), "The wordmark's mark is a common image");
        }

        [Test] public void PillsTakeALeadingIconAndTheButtonType()
        {
            var button = ui.TextButton("Play", new Rect(20, 20, 240, 56), "Play", () => { }, true, root.transform, out var label, SkinSlots.IconDaily);
            var icon = Part(button, "Play icon");
            var iconRect = SkinUi.ScreenRect(icon.rectTransform);
            Assert.AreEqual(24, iconRect.width, .01f); Assert.AreEqual(36, iconRect.x, .01f, "The icon sits 16 dp in");
            Assert.AreEqual(art.Token(SkinTokens.TextOnPrimary), icon.color);
            Assert.AreEqual(140 + 18, SkinUi.ScreenRect(label.rectTransform).center.x, .01f, "The word starts 6 dp after the icon and centres in the rest");
            Assert.AreEqual(art.Font(SkinUi.Type.Number), label.font);
            Assert.AreEqual(SkinUi.ButtonDp, label.fontSize, .01f);
        }

        [Test] public void MedallionsShowThePortraitMasterThroughTheRingsOpening()
        {
            var portrait = art.Sprite("boss__portrait");
            var image = ui.Medallion("Guardian", new Rect(0, 0, 320, 320), portrait, root.transform);
            Assert.AreEqual(new Rect(0, 0, 320, 320), SkinUi.ScreenRect(image.rectTransform), "The master fills the ring");
            var clip = image.transform.parent.GetComponent<RectTransform>();
            Assert.AreEqual(232, SkinUi.ScreenRect(clip).width, .01f, "The opening is 232/320 of the ring");
            Assert.IsNotNull(clip.GetComponent<Mask>());
        }

        [Test] public void AWornEmblemTakesItsLadderBorderInTheSameRect()
        {
            Image Frame(string name) => root.GetComponentsInChildren<Image>().Single(i => i.name == name + " frame");
            string Sprite(Image image) => image.sprite.name.Replace("(Clone)", "");
            Assert.AreEqual(5, SkinSlots.LadderTiers);
            for (int tier = 0; tier < SkinSlots.LadderTiers; tier++)
            {
                var rect = new Rect(tier * 100, 0, 96, 96);
                var emblem = ui.Medallion("Tier " + tier, rect, art.SkinUi(tier % 2 == 0 ? SkinSlots.Emblem11 : SkinSlots.Emblem12),
                    root.transform, SkinSlots.LadderBorder(tier));
                var frame = Frame("Tier " + tier);
                Assert.AreEqual("ladder-border-" + tier, Sprite(frame));
                Assert.AreEqual(rect, SkinUi.ScreenRect(frame.rectTransform), "The border shares the emblem's rect");
                Assert.AreEqual(rect, SkinUi.ScreenRect(emblem.rectTransform), "The emblem is not shrunk into the opening again");
                Assert.Greater(frame.transform.GetSiblingIndex(), emblem.transform.parent.GetSiblingIndex(), "The border is drawn last");
                Assert.AreEqual("ladder-badge-" + tier, art.SkinUi(SkinSlots.LadderBadge(tier)).name.Replace("(Clone)", ""));
            }
            ui.Medallion("Guardian", new Rect(0, 200, 96, 96), art.Sprite("boss__portrait"), root.transform);
            Assert.AreEqual(SkinSlots.GuardianFrame, Sprite(Frame("Guardian")), "A guardian keeps its ring");
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
