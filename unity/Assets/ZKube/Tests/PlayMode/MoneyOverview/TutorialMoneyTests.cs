using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The tutorial under Arena: the Arcade's first visit and How to play.
    public sealed partial class MoneyOverviewTests
    {
        private Transform LessonScene => host.GetComponent<PageShell>().Chrome.Find("Lesson");
        private string[] Words() => host.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy).Select(text => text.text).ToArray();

        [UnityTest] public IEnumerator TheFirstArcadeVisitTeachesTheArenaDailyWithoutTouchingEntry()
        {
            yield return PrepareScenario("campaign-playable");
            int bits = ~(1 << (int)Lesson.ArenaDaily); Lessons.Device = new Lessons(() => bits, value => bits = value);
            Click("Connect"); yield return Idle();
            Assert.That(LessonScene, Is.Not.Null, "The Arcade teaches its Daily on the first visit");
            Assert.That(Words(), Does.Contain(Lessons.ArenaDaily[0].Line));
            var talk = LessonScene.GetComponentInChildren<GuardianTalk>();
            for (int i = 0; i < Lessons.ArenaDaily.Length; i++)
            {
                Assert.That(talk.Current.Line, Is.EqualTo(Lessons.ArenaDaily[i].Line)); talk.Complete();
                yield return ZKube.Tests.Presentation.LessonEvidence.Snap(host.transform, "arena daily " + (i + 1));
                talk.Tap(); yield return null;
            }
            Assert.That(LessonScene, Is.Null); Assert.That(Lessons.Device.Taught(Lesson.ArenaDaily), Is.True);
            Assert.That(environment.SentSignature, Is.Null, "Teaching signs and sends nothing");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.ConfirmingDailyEntry, Is.False, "Teaching never opens the entry sheet");
            Click("Campaign"); yield return Idle(); Click("Arcade"); yield return Idle();
            Assert.That(LessonScene, Is.Null, "Taught once");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator HowToPlayReplaysEveryLessonWithTheArenaDaily()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            Click("Settings"); yield return Idle();
            Click("How to play"); yield return null;
            var pages = Lessons.HowToPlay(arena: true);
            var talk = LessonScene.GetComponentInChildren<GuardianTalk>();
            var card = LessonScene.GetComponentsInChildren<Image>(true).Single(image => image.name == "Lesson card");
            for (int i = 0; i < pages.Length; i++)
            {
                Assert.That(talk.Current.Line, Is.EqualTo(pages[i].Line), "page " + i);
                Assert.That(card.sprite.name, Does.StartWith(pages[i].Picture), "page " + i);
                talk.Complete(); talk.Tap(); yield return null;
            }
            Assert.That(LessonScene, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
