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
            var bar = ui.TabBar("Tabs", safe, new (string, string, System.Action)[]
            {
                (SkinSlots.IconCampaign, "Campaign", () => { }), (SkinSlots.IconDaily, "Daily", () => { }),
            }, 0, root.transform);
            var drawn = SkinUi.ScreenRect((RectTransform)bar.transform);
            Assert.AreEqual(ui.TabBarRect(safe), drawn, "Pages learn the bar's edges from TabBarRect");
            Assert.GreaterOrEqual(drawn.xMin, safe.xMin + 16); Assert.LessOrEqual(drawn.xMax, safe.xMax - 16);
            Assert.Greater(drawn.yMin, safe.yMin, "The bar sits above the bottom safe inset");
            foreach (var image in bar.GetComponentsInChildren<Image>())
            {
                var piece = SkinUi.ScreenRect(image.rectTransform);
                Assert.IsTrue(piece.xMin >= drawn.xMin - .01f && piece.xMax <= drawn.xMax + .01f && piece.yMin >= drawn.yMin - .01f && piece.yMax <= drawn.yMax + .01f,
                    image.name + " stays inside the bar");
            }
        }

        [Test] public void TabCapitalsFitInsideTheirChipAtBothWidths()
        {
            foreach (var (safe, density) in new[] { (new Rect(0, 0, 360, 640), 1f), (new Rect(0, 0, 1200, 2670), 3f) })
            {
                var sized = new SkinUi(art, density, 1);
                var bar = sized.TabBar("Fit " + density, safe, new (string, string, System.Action)[]
                {
                    (SkinSlots.IconCampaign, "Campaign", () => { }), (SkinSlots.IconDaily, "Daily", () => { }), (SkinSlots.IconProfile, "Profile", () => { }),
                }, 0, root.transform);
                foreach (var tab in new[] { "Campaign", "Daily", "Profile" })
                {
                    var chip = SkinUi.ScreenRect((RectTransform)Part(bar, "Fit " + density + " " + tab).transform);
                    var label = bar.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Fit " + density + " " + tab + " label");
                    label.ForceMeshUpdate();
                    float room = sized.TabLabelRoom(chip.width), words = label.textBounds.size.x;
                    string at = tab + " at " + safe.width + "px";
                    Assert.AreEqual(chip.width - 40 * density, room, .01f, "The chip's round ends are 20 dp each");
                    Assert.LessOrEqual(words, room + .5f, at + " stays clear of its chip's round ends");
                    Assert.GreaterOrEqual(label.fontSize, SkinUi.TabLabelMinimumDp * density - .01f, at);
                    var text = SkinUi.ScreenRect(label.rectTransform);
                    Assert.AreEqual(chip.yMax - SkinUi.TabLabelLine * chip.height, text.center.y, .5f, at + " sits on the chip's label line");
                    Assert.IsTrue(text.xMin >= chip.xMin && text.xMax <= chip.xMax && text.yMin >= chip.yMin, at + " stays inside its chip");
                }
                if (density == 3) Assert.AreEqual(SkinUi.TabLabelDp * 3, bar.GetComponentsInChildren<TMP_Text>().First().fontSize, .01f, "The drawn width keeps 11 dp");
                sized.Dispose();
            }
        }

        [Test] public void TabBarTabsRunTheirActionAndSelectMovesThePlate()
        {
            var opened = new List<string>();
            var bar = ui.TabBar("Tabs", new Rect(0, 0, 360, 640), new (string, string, System.Action)[]
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
            var bar = ui.TabBar("Tabs", new Rect(0, 0, 360, 640), new (string, string, System.Action)[]
            {
                (SkinSlots.IconCampaign, "Campaign", () => { }), (SkinSlots.IconDaily, "Daily", () => { }),
            }, 0, root.transform);
            var dark = art.Token(SkinTokens.TextOnPrimary);
            Assert.AreEqual(dark, bar.Ink(0));
            Assert.AreEqual(.72f * art.Token(SkinTokens.Text).a, bar.Ink(1).a, 1e-4f);
            bar.Select(1);
            Assert.AreEqual(dark, bar.Ink(1)); Assert.AreEqual(dark, Part(bar, "Tabs Daily icon").color);
            var label = bar.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Tabs Daily label");
            Assert.AreEqual(art.Font(SkinUi.Type.Label), label.font);
            Assert.IsTrue((label.fontStyle & FontStyles.UpperCase) != 0, "Tab labels are capitals");
            Assert.AreEqual(SkinUi.LabelTracking, label.characterSpacing, "with +9% tracking");
            Assert.IsNotNull(art.Sprite(BoardArt.Mark), "The wordmark's mark is a common image");
        }

        [Test] public void PillsTakeALeadingIconAndTheButtonType()
        {
            var button = ui.TextButton("Play", new Rect(20, 20, 240, 56), "Play", () => { }, true, root.transform, out var label, SkinSlots.IconDaily);
            var icon = Part(button, "Play icon");
            var iconRect = SkinUi.ScreenRect(icon.rectTransform);
            Assert.AreEqual(24, iconRect.width, .01f); Assert.AreEqual(42, iconRect.x, .01f);
            Assert.AreEqual(art.Token(SkinTokens.TextOnPrimary), icon.color);
            Assert.AreEqual(140 + 12, SkinUi.ScreenRect(label.rectTransform).center.x, .01f, "The word centres 12 dp right of the pill's centre");
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
