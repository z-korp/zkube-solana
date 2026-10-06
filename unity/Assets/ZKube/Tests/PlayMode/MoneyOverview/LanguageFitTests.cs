using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Presentation;
using ZKube.Tests.Presentation;
using Language = ZKube.Core.Generated.Words;

namespace ZKube.Tests.MoneyOverview
{
    // The Arena in every language, on both phones. Each page is reached in
    // English and drawn again in each language (the adapter presents again
    // when the language changes); it then holds that language's words and
    // shows none the catalogue does not hold (LanguageFit). The Arena runs on
    // a physical device only, so with ZKUBE_CAPTURES set these are its captures.
    public sealed partial class MoneyOverviewTests
    {
        [UnityTest] public IEnumerator EveryArenaPageFitsBothPhonesInEveryLanguage()
        {
            var faults = new List<string>(); var strays = new List<string>();
            foreach (string phone in new[] { "compact", "seeker" })
            {
                void Use()
                {
                    var shell = host.GetComponent<PageShell>();
                    if (phone == "seeker") Phones.Seeker(shell); else Phones.Compact(shell);
                }
                IEnumerator Shown(string page)
                {
                    var shell = host.GetComponent<PageShell>();
                    foreach (string code in Language.Codes)
                    {
                        Language.Use(code);
                        yield return Idle(); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                        faults.AddRange(LanguageFit.Faults(shell, 1, phone + " arena " + page));
                        // What the player brought: the product's name and the wallet's address.
                        strays.AddRange(LanguageFit.Unowned(shell, "arena " + page, Application.productName));
                        yield return Captures.Snap(shell, code + " " + phone + " arena " + page);
                    }
                    Language.Use("en"); yield return Idle();
                }
                yield return PrepareScenario("owner-overview"); Use();
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                yield return Shown("landing before connecting");
                Click("Connect"); yield return Shown("landing");
                Click("Settings"); yield return Shown("settings");
                Click("Manage"); yield return Shown("device");
                yield return Wait(Adapter.OpenKredits()); yield return Shown("kredits");
                yield return Wait(Adapter.OpenRewards()); yield return Shown("boards");
                yield return Wait(Adapter.OpenProfile()); yield return Shown("profile");
                Click("Your records"); yield return Shown("records");
                Assert.IsTrue(host.GetComponent<PageViews>().GoBack(), "the back key leaves the records"); yield return Idle();
                Click("Choose a border"); yield return Shown("borders");
                yield return EndScenario();
                yield return PrepareScenario("daily-playable"); Use();
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                Click("Connect"); yield return Shown("landing ready to enter");
                Click("Enter · 1 Kredit"); yield return Shown("entry");
                yield return EndScenario();
                foreach (var (variant, name) in new[] { ("sealed", "reward to claim"), ("claimed", "reward claimed"), ("unsealed", "results pending") })
                {
                    yield return PrepareClaimPage("claim-score-" + variant); Use(); yield return Shown("boards " + name);
                    yield return EndScenario();
                }
            }
            Language.Use("en");
            Assert.That(strays.Distinct(), Is.Empty, "Every word on a page is the catalogue's:\n" + string.Join("\n", strays.Distinct()));
            Assert.That(faults.Distinct(), Is.Empty, "Every language fits every page:\n" + string.Join("\n", faults.Distinct()));
        }
    }
}
