using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Local.App;
using ZKube.Presentation;
using ZKube.Presentation.Tests;

namespace ZKube.Tests
{
    // The tutorial on the Realms pages (build/tutorial/design.txt): the first
    // preview's stars, the guardian level's chip, the first Daily and How to play.
    public sealed partial class StoreAppPageJourneyTests
    {
        // A lesson over the page: the talk scene in the chrome, with its card.
        private Transform PageLesson => app.GetComponent<PageShell>().Chrome.Find("Lesson");
        private IEnumerator ReadPageLesson()
        {
            for (int i = 0; i < 60 && PageLesson != null; i++)
            { Click(app, "Continue"); yield return null; }
            Assert.That(PageLesson, Is.Null, "The lesson finished");
            yield return null;
        }
        private static Lessons Untaught(params Lesson[] untaught)
        {
            int bits = ~untaught.Aggregate(0, (mask, lesson) => mask | 1 << (int)lesson);
            return new Lessons(() => bits, value => bits = value);
        }

        [UnityTest] public IEnumerator TheFirstTikiPreviewTeachesItsStarsOnce()
        {
            Lessons.Device = Untaught(Lesson.Stars);
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            Assert.That(PageLesson, Is.Not.Null, "The stars are taught over the first preview");
            Assert.That(Texts(), Does.Contain(Lessons.Stars[0].Line));
            var card = PageLesson.GetComponentsInChildren<Image>().Single(image => image.name == "Lesson card");
            Assert.That(card.sprite.name, Does.StartWith(SkinSlots.LessonStars));
            yield return ZKube.Tests.Presentation.LessonEvidence.Snap(app, "preview stars");
            yield return ReadPageLesson();
            Assert.That(Lessons.Device.Taught(Lesson.Stars), Is.True);
            Click(app, "Back to map"); yield return Page(StorePage.Campaign);
            Click(app, "Trial 1"); yield return Page(StorePage.Level);
            Assert.That(PageLesson, Is.Null, "Taught once");
        }

        [UnityTest] public IEnumerator EveryGuardianLevelPreviewNamesTheRealmItOpens()
        {
            product.Write(state => { for (int level = 0; level < 9; level++) state.Stars[level] = 1; return state; });
            app.Flow.Campaign.Preview(1, 10); yield return Page(StorePage.Level);
            Assert.That(Texts(), Does.Contain(Lessons.Opens(PageCatalog.Load().Realm(2).realmName)));
            Assert.That(app.GetComponentsInChildren<Image>().Single(image => image.name == "Opens key").sprite.name, Does.StartWith(SkinSlots.IconKey));
            yield return ZKube.Tests.Presentation.LessonEvidence.Snap(app, "guardian level opens");
            app.Flow.Campaign.Preview(1, 9); yield return Page(StorePage.Level);
            Assert.That(Texts().Any(text => text != null && text.StartsWith("Opens ")), Is.False, "Only a guardian's level opens a realm");
        }

        [UnityTest] public IEnumerator TheFirstRealmsDailyIsTaughtBeforeItsBoard()
        {
            Lessons.Device = Untaught(Lesson.RealmsDaily);
            Click(app, app.Flow.DailyAction);
            yield return null;
            Assert.That(PageLesson, Is.Not.Null); Assert.That(board.gameObject.activeSelf, Is.False, "The board waits for the lesson");
            Assert.That(Texts(), Does.Contain(Lessons.RealmsDaily(false)[0].Line));
            yield return ZKube.Tests.Presentation.LessonEvidence.Snap(app, "realms daily");
            yield return ReadPageLesson();
            yield return BoardReady();
            Assert.That(board.Session.Daily, Is.True); Assert.That(Lessons.Device.Taught(Lesson.RealmsDaily), Is.True);
            Assert.That(Coach.Said, Is.Empty, "A Daily run is never taught on the board");
        }

        [UnityTest] public IEnumerator HowToPlayReplaysEveryLessonFromSettings()
        {
            Click(app, "Settings"); yield return Page(StorePage.Settings);
            Click(app, "How to play"); yield return null;
            var pages = Lessons.HowToPlay(arena: false);
            Assert.That(PageLesson, Is.Not.Null);
            var talk = PageLesson.GetComponentInChildren<GuardianTalk>();
            var card = PageLesson.GetComponentsInChildren<Image>(true).Single(image => image.name == "Lesson card");
            for (int i = 0; i < pages.Length; i++)
            {
                Assert.That(talk.Current.Line, Is.EqualTo(pages[i].Line), "page " + i);
                Assert.That(card.sprite.name, Does.StartWith(pages[i].Picture), "page " + i);
                talk.Complete(); yield return ZKube.Tests.Presentation.LessonEvidence.Snap(app, "how to play " + (i + 1).ToString("00"));
                talk.Complete(); talk.Tap(); yield return null;
            }
            Assert.That(PageLesson, Is.Null, "The last page finishes");
            Click(app, "How to play"); yield return null;
            Click(app, "Skip lesson"); yield return null;
            Assert.That(PageLesson, Is.Null, "Skip finishes at once");
        }
    }
}
