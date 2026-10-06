using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // An identity page is a utility page and carries no guardian (owner,
    // 2026-10-06): the entry confirmation, this device and its disable
    // confirmation, Kredits, Boards, a page before launch and a page whose read
    // failed say what they have to say in words and figures alone.
    public sealed partial class MoneyOverviewTests
    {
        private void NoGuardian(string panel)
        {
            Assert.That(host.GetComponent<PageViews>().ShownPanel, Is.EqualTo(panel));
            Assert.That(host.GetComponentsInChildren<Image>().Where(image => image.gameObject.activeInHierarchy &&
                (image.name.StartsWith("Screen guardian") || image.name.StartsWith("Guardian bubble"))).Select(image => image.name), Is.Empty, panel);
        }

        [UnityTest] public IEnumerator NoArenaIdentityPageCarriesAGuardian()
        {
            // Before launch, the page says the Arena opens soon in its own words.
            yield return FirstRun("arena-not-open", null);
            Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            NoGuardian("Device"); Assert.That(Says("Arena opens soon"), Is.True); Assert.That(Offers("Play Campaign"), Is.True);
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            NoGuardian("Kredits"); Assert.That(Says("Arena opens soon"), Is.True);
            yield return EndScenario();

            yield return PrepareDeviceScenario("daily-playable", page: "Arena");
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            NoGuardian("Entry");
            Assert.That(Says("This entry is paid and cannot be refunded."), Is.True); Assert.That(Offers("Confirm 1 Kredit"), Is.True);
            yield return SessionClick("Cancel entry"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle(); NoGuardian("Kredits");
            yield return Wait(Adapter.OpenRewards()); yield return Idle(); NoGuardian("Boards");
            yield return OpenDevice(); NoGuardian("Device");
            yield return SessionClick("Disable this device"); yield return Idle(); NoGuardian("Revoke");
            host.GetComponentsInChildren<Button>().Last(button => button.name == "Keep enabled").onClick.Invoke(); yield return Idle();
            // A read that failed: the page says so and why, with the way forward.
            Set("sessionRead", null); Set("failure", "Could not refresh. Try again."); Redraw(); yield return Idle();
            NoGuardian("Device waiting");
            Assert.That(Says("Not loaded"), Is.True); Assert.That(Says("Could not refresh. Try again."), Is.True); Assert.That(Offers("Try again"), Is.True);
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
