using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The Arena's screens as the v3 composites draw them, on the Seeker and a
    // 360 x 640 phone: the Arcade home, entering the Daily, Kredits, rewards,
    // this device and the profile. Every word fits its place and every action
    // is 48 dp to touch. The Arena runs on a physical device only, so these
    // are its captures.
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator ArenaScreen(string phone, string page)
        {
            yield return Idle(); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f); Canvas.ForceUpdateCanvases();
            var shell = host.GetComponent<PageShell>();
            float d = shell.SafeArea.height / (phone == "Seeker" ? Phones.SeekerScreen.height - Phones.SeekerTopInsetDp
                : Phones.CompactScreen.height - Phones.CompactTopInsetDp);
            string at = phone + " " + page;
            foreach (var text in host.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text)))
            {
                text.ForceMeshUpdate();
                var rect = SkinUi.ScreenRect(text.rectTransform);
                Assert.That(text.GetPreferredValues(text.text, rect.width, float.PositiveInfinity).y, Is.LessThanOrEqualTo(rect.height + .5f),
                    at + ": '" + text.text + "' fits its height");
                if (text.textWrappingMode == TextWrappingModes.NoWrap)
                    Assert.That(text.GetPreferredValues(text.text, float.PositiveInfinity, float.PositiveInfinity).x, Is.LessThanOrEqualTo(rect.width + 1),
                        at + ": '" + text.text + "' fits its width");
                Assert.That(rect.xMin >= shell.SafeArea.xMin - .5f && rect.xMax <= shell.SafeArea.xMax + .5f, Is.True, at + ": '" + text.text + "' stays on screen");
            }
            foreach (var button in host.GetComponentsInChildren<Button>().Where(button => button.gameObject.activeInHierarchy && button.GetComponentsInChildren<TMP_Text>().Any()))
            {
                var rect = SkinUi.ScreenRect((RectTransform)button.transform);
                if (rect.width <= 0) continue;
                Assert.That(Mathf.Max(rect.height, rect.width) / d, Is.GreaterThanOrEqualTo(48 - .01f), at + ": " + button.name + " is 48 dp to touch");
            }
            yield return Captures.Snap(shell, "arena " + at);
        }

        [UnityTest] public IEnumerator EveryArenaScreenFitsAndTouchesOnBothPhones()
        {
            foreach (string phone in new[] { "Seeker", "360 x 640" })
            {
                void Use() { var shell = host.GetComponent<PageShell>(); if (phone == "Seeker") Phones.Seeker(shell); else Phones.Compact(shell); }
                yield return PrepareScenario("owner-overview"); Use();
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                Click("Connect"); yield return ArenaScreen(phone, "arcade");
                Click("Settings"); yield return ArenaScreen(phone, "settings");
                Click("Manage"); yield return ArenaScreen(phone, "device");
                yield return Wait(Adapter.OpenKredits()); yield return ArenaScreen(phone, "kredits");
                yield return Wait(Adapter.OpenRewards()); yield return ArenaScreen(phone, "rewards");
                yield return Wait(Adapter.OpenProfile()); yield return ArenaScreen(phone, "profile");
                yield return EndScenario();
                yield return PrepareScenario("daily-playable"); Use();
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                Click("Connect"); yield return Idle();
                Click("Enter · 1 Kredit"); yield return ArenaScreen(phone, "entry");
                yield return EndScenario();
            }
        }
    }
}
