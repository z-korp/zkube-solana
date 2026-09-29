using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;

namespace ZKube.Presentation.Tests
{
    public sealed class GuardianTalkTests
    {
        private BoardArt art;
        private GameObject root;
        private SkinUi ui;
        private PageCatalog.RealmPage realm;
        private bool reduced;
        [UnitySetUp] public IEnumerator SetUp()
        {
            reduced = AppPreferences.ReducedMotion; AppPreferences.SetReducedMotion(false);
            art = new BoardArt(); yield return art.Load(1);
            realm = PageCatalog.Load().Realm(1);
            root = new GameObject("Talk test canvas", typeof(RectTransform), typeof(Canvas));
            root.GetComponent<Canvas>().renderMode = RenderMode.ScreenSpaceOverlay;
            ui = new SkinUi(art, 1, 1);
        }
        [TearDown] public void TearDown()
        {
            AppPreferences.SetReducedMotion(reduced);
            ui.Dispose(); Object.Destroy(root); art.Dispose();
        }
        private GuardianTalk Talk(System.Action finished, params TalkPage[] pages) =>
            ui.Talk("Talk", 16, 600, 368, realm, pages, finished, root.transform);
        private static IEnumerator Seconds(float seconds)
        {
            for (float end = Time.realtimeSinceStartup + seconds; Time.realtimeSinceStartup < end;) yield return null;
        }

        [UnityTest] public IEnumerator ALineTypesWhileTheMouthFlapsThenRestsOnItsMood()
        {
            bool finished = false;
            var talk = Talk(() => finished = true, new TalkPage("The tide keeps its own time.", "satisfied"), new TalkPage("Again.", "idle"));
            Assert.IsTrue(talk.Typing); Assert.AreEqual("", talk.Shown);
            var faces = new HashSet<string>();
            for (float end = Time.realtimeSinceStartup + .35f; Time.realtimeSinceStartup < end;) { faces.Add(talk.Face); yield return null; }
            Assert.That(talk.Shown.Length, Is.InRange(3, 27), "Letters arrive one by one");
            StringAssert.StartsWith(talk.Shown, "The tide keeps its own time.");
            CollectionAssert.IsSubsetOf(new[] { "talk-open", "talk-mid" }, faces, "The mouth flaps while it types");
            talk.Tap();
            Assert.IsFalse(talk.Typing); Assert.AreEqual("The tide keeps its own time.", talk.Shown, "A tap completes the line");
            Assert.AreEqual("satisfied", talk.Face, "The guardian rests on the page's mood");
            talk.Tap();
            Assert.AreEqual(1, talk.Page); Assert.IsTrue(talk.Typing, "The next tap turns the page");
            talk.Tap(); talk.Tap();
            Assert.IsTrue(finished && talk.Done, "The last tap finishes");
        }

        [UnityTest] public IEnumerator PunctuationHoldsTheLineAndAnEllipsisHoldsOnce()
        {
            Assert.AreEqual(GuardianTalk.CommaHold, GuardianTalk.Hold(','));
            Assert.AreEqual(GuardianTalk.StopHold, GuardianTalk.Hold('.'));
            Assert.AreEqual(0, GuardianTalk.Hold('a'));
            var talk = Talk(null, new TalkPage("Wait... now.", "idle"));
            float start = Time.realtimeSinceStartup;
            while (talk.Typing) yield return null;
            float took = Time.realtimeSinceStartup - start, letters = "Wait... now.".Length * GuardianTalk.LetterSeconds;
            Assert.Greater(took, letters + GuardianTalk.StopHold * .8f, "The ellipsis holds");
            Assert.Less(took, letters + 2 * GuardianTalk.StopHold + .25f, "It holds once, not three times");
        }

        [UnityTest] public IEnumerator ReducedMotionShowsTheLineAtOnceOnItsMood()
        {
            AppPreferences.SetReducedMotion(true);
            var talk = Talk(null, new TalkPage("The current is with you.", "celebrate"));
            Assert.IsFalse(talk.Typing); Assert.AreEqual("The current is with you.", talk.Shown);
            Assert.AreEqual("celebrate", talk.Face);
            yield return Seconds(.3f);
            Assert.AreEqual("celebrate", talk.Face, "No flaps or blinks");
        }

        [UnityTest] public IEnumerator AnIdleGuardianBlinksWhileItWaits()
        {
            var talk = Talk(null, new TalkPage("Hm.", "idle"));
            talk.Tap();
            bool blinked = false;
            for (float end = Time.realtimeSinceStartup + 3; Time.realtimeSinceStartup < end && !blinked;) { blinked = talk.Face == "blink"; yield return null; }
            Assert.IsTrue(blinked);
            yield return Seconds(GuardianTalk.BlinkSeconds + .1f);
            Assert.AreEqual("idle", talk.Face, "The blink is brief");
        }

        [Test] public void TheGuardianLeansOnTheRailOverTheBox()
        {
            var talk = Talk(null, new TalkPage("One line.", "idle", "EARN WAVE", "Clear 2+ lines in a move"));
            Image Part(string name) => root.GetComponentsInChildren<Image>(true).Single(i => i.name == name);
            var box = SkinUi.ScreenRect((RectTransform)talk.transform);
            var rail = SkinUi.ScreenRect(Part("Talk rail").rectTransform);
            var body = Part("Talk guardian"); var paws = Part("Talk paws");
            Assert.AreEqual(box.yMax, rail.yMax, .01f, "The ledge is the box's top");
            Assert.AreEqual(box.xMin - 2, rail.xMin, .01f, "The rail overhangs the box");
            var frame = SkinUi.ScreenRect(body.rectTransform);
            Assert.AreEqual(box.yMax, frame.yMax - art.GuardianRailY * frame.height, .01f, "Its rail line sits on the ledge");
            Assert.AreEqual(box.center.x, frame.center.x, .01f);
            int Order(Component c) => c.transform.GetSiblingIndex();
            Assert.Less(Order(body), Order(talk), "The body is behind the box");
            Assert.Greater(Order(paws), Order(Part("Talk rail")), "The paws rest in front of the rail");
            Assert.AreEqual("boss__paws", paws.sprite.name.Replace("(Clone)", ""));
            Assert.AreEqual(Image.Type.Sliced, Part("Talk rail").type);
            var name = root.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Talk name");
            Assert.AreEqual(realm.guardianName, name.text); Assert.AreEqual(art.Font(SkinUi.Type.Title), name.font);
            var title = root.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Talk title");
            Assert.AreEqual(realm.guardianTitle, title.text);
            Assert.IsTrue((title.fontStyle & FontStyles.UpperCase) != 0, "Labels render in capitals");
            var line = root.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Talk line");
            Assert.AreEqual(TextAlignmentOptions.TopLeft, title.alignment);
            Assert.AreEqual(SkinUi.ScreenRect(line.rectTransform).xMin, SkinUi.ScreenRect(title.rectTransform).xMin, .01f, "The title shares the line's left edge");
            Assert.LessOrEqual(SkinUi.ScreenRect(title.rectTransform).yMax, SkinUi.ScreenRect(Part("Talk name tag").rectTransform).yMin + .01f, "It sits under the tag");
            talk.Complete();
            Assert.AreEqual("EARN WAVE", root.GetComponentsInChildren<TMP_Text>().Single(t => t.name == "Talk rule heading").text);
        }

        [Test] public void TheBoxFitsItsLinesWithTwoAtLeastAndCanHideItsHint()
        {
            Rect Box(GuardianTalk talk) => SkinUi.ScreenRect((RectTransform)talk.transform);
            var shortLine = Talk(null, new TalkPage("Again.", "idle"));
            float twoLines = 42 + 2 * SkinUi.TalkLeadingDp + 32;
            Assert.AreEqual(twoLines, Box(shortLine).height, .01f, "A short line gets a compact box two lines tall");
            Object.Destroy(shortLine.gameObject);
            var ruled = Talk(null, new TalkPage("One line.", "idle", "EARN WAVE", "Clear 2+ lines in a move"));
            Assert.Greater(Box(ruled).height, twoLines, "The rule adds its block");
            Assert.IsTrue(root.GetComponentsInChildren<TMP_Text>().Any(t => t.name == "Talk hint"));
            var quiet = ui.Talk("Quiet", 16, 300, 368, realm, new[] { new TalkPage("Hm.", "idle") }, null, root.transform, hint: false);
            Assert.IsFalse(root.GetComponentsInChildren<TMP_Text>().Any(t => t.name == "Quiet hint"), "A dialog with its own buttons hides the hint");
        }

        [Test] public void EveryMomentSpeaksItsAuthoredLine()
        {
            var lines = realm.guardianLines;
            Assert.AreEqual((lines.greeting, "greeting"), Said(TalkPage.For(lines, TalkMoment.Greeting)));
            Assert.AreEqual((lines.respectLine, "satisfied"), Said(TalkPage.For(lines, TalkMoment.Passage)));
            Assert.AreEqual((lines.dailyGreeting, "greeting"), Said(TalkPage.For(lines, TalkMoment.Daily)));
            Assert.AreEqual((lines.trialIntro, "idle"), Said(TalkPage.For(lines, TalkMoment.TrialIntro)));
            Assert.AreEqual((lines.twoStar, "satisfied"), Said(TalkPage.For(lines, TalkMoment.Win, 2)));
            Assert.AreEqual((lines.threeStar, "celebrate"), Said(TalkPage.For(lines, TalkMoment.Win, 3)));
            Assert.AreEqual((lines.incomplete, "defeated"), Said(TalkPage.For(lines, TalkMoment.Ended)));
            Assert.AreEqual((lines.defeatLine, "defeated"), Said(TalkPage.For(lines, TalkMoment.GuardianDefeated)));
            Assert.AreEqual((lines.newBestLine, "surprised"), Said(TalkPage.For(lines, TalkMoment.NewBest)));
            var rule = PageCatalog.Load().guardianRules[0];
            var first = TalkPage.MapGreeting(realm, rule, false);
            Assert.AreEqual(1, first.Length); Assert.AreEqual(lines.greeting, first[0].Line);
            Assert.AreEqual(HudLayout.GuardianCaption(rule.bonus), first[0].RuleHeading); Assert.AreEqual(rule.description, first[0].Rule);
            var passage = TalkPage.MapGreeting(realm, rule, true);
            Assert.AreEqual(new[] { lines.respectLine, lines.greeting }, passage.Select(p => p.Line).ToArray(),
                "A realm opened by beating its predecessor's guardian first grants passage");
        }
        private static (string, string) Said(TalkPage page) => (page.Line, page.Mood);
    }
}
