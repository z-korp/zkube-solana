using System.Collections;
using NUnit.Framework;
using UnityEngine.TestTools;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The menu music plays on through the pages a tab page opens, a
    // confirmation without tabs included, and through the way back; it never
    // stops and starts again as the player moves between them.
    public sealed partial class MoneyOverviewTests
    {
        [UnityTest] public IEnumerator TheMenuMusicPlaysOnThroughTheArenasConfirmationsAndBack()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Arena");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            var views = controller.GetComponent<PageViews>(); var music = views.MenuMusic;
            Assert.That(music.isPlaying, Is.True, "The Arena page");
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            Assert.That(controller.ConfirmingDailyEntry, Is.True);
            Assert.That(music.isPlaying, Is.True, "The entry confirmation");
            yield return SessionClick("Cancel entry"); yield return Idle();
            Assert.That(controller.ConfirmingDailyEntry, Is.False);
            Assert.That(music.isPlaying, Is.True, "Back on the Arena page");
            yield return OpenDevice();
            Assert.That(views.ShownPanel, Is.EqualTo("Device")); Assert.That(music.isPlaying, Is.True, "This device");
            yield return SessionClick("Disable this device"); yield return Idle();
            Assert.That(views.ShownPanel, Is.EqualTo("Revoke")); Assert.That(music.isPlaying, Is.True, "The disable confirmation");
            yield return SessionClick("Keep enabled"); yield return Idle();
            Assert.That(views.ShownPanel, Is.EqualTo("Device")); Assert.That(music.isPlaying, Is.True, "Back on This device");
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
