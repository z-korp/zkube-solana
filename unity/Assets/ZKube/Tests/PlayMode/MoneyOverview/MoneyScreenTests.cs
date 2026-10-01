using System.Collections;
using System.Collections.Generic;
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
            PageText.AssertRunningTextFigures(host.transform, at, shell.Artwork.Font(SkinUi.Type.Caption), shell.Artwork.Font(SkinUi.Type.Body));
            yield return Captures.Snap(shell, "arena " + at);
        }

        // The Arena's pages on the wireframe's Seeker frame: each page's pieces
        // where the scenario's state is the wireframe's (the Kredits page, the
        // entry and the Arcade throughout; the title, tiles and tabs of rewards,
        // this device and the profile, whose states differ), and every page's
        // fixed words at most the spec's. The spec counts the wireframe's words
        // (arcade 29, entry 27, Kredits 35, rewards 46, this device 45, profile
        // 36); the words that vary with the day or the player (the guardian and
        // its realm, the objective, the title's subtitle, the profile's
        // standing) and the guardian's line are counted on neither side.
        private static readonly System.Text.RegularExpressions.Regex Word = new System.Text.RegularExpressions.Regex("[A-Za-z][A-Za-z'’-]*");
        private static readonly Dictionary<string, int> SpecWords = new Dictionary<string, int> {
            ["arcade"] = 29 - 5, ["entry"] = 27 - 2, ["kredits"] = 35 - 5, ["rewards"] = 46 - 2, ["device"] = 45 - 2, ["aprofile"] = 36 - 4 };
        private static readonly string[] DaysWords = { "Guardian line", "Talk", "Daily guardian name", "Daily line", "Screen subtitle", "Standing line" };
        private IEnumerator Wireframe(string page, params string[] roles)
        {
            yield return Idle(); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f); Canvas.ForceUpdateCanvases();
            var shell = host.GetComponent<PageShell>();
            var pieces = WireframeGeometryTests.Pieces(host.transform, shell.ScreenArea, 1);
            WireframeGeometryTests.Dump("arena " + page, pieces);
            yield return Captures.Snap(shell, "wireframe arena " + page);
            WireframeGeometryTests.Match(page, pieces, shell.ScreenArea, 1.1f, roles);
            int words = PageText.Visible(host.transform).Where(text => !DaysWords.Contains(text.name))
                .Sum(text => Word.Matches(System.Text.RegularExpressions.Regex.Replace(text.text, "<[^>]+>", "")).Count);
            Assert.That(words, Is.LessThanOrEqualTo(SpecWords[page]), page + " speaks at most the spec's words: " +
                string.Join(" | ", PageText.Visible(host.transform).Select(text => text.text)));
        }
        [UnityTest] public IEnumerator EveryArenaPageMatchesItsWireframeAndItsWords()
        {
            yield return PrepareScenario("daily-playable"); Phones.WireframeSeeker(host.GetComponent<PageShell>());
            yield return Wait(Adapter.RefreshOverview()); yield return Idle();
            Click("Connect"); yield return Wireframe("arcade", "lockup", "cards", "primaries", "quiet", "tabs");
            Click("Enter · 1 Kredit"); yield return Wireframe("entry", "titles", "guardians", "cards", "primaries");
            yield return EndScenario();
            yield return PrepareScenario("owner-overview"); Phones.WireframeSeeker(host.GetComponent<PageShell>());
            yield return Wait(Adapter.RefreshOverview()); yield return Idle();
            Click("Connect"); yield return Idle();
            Click("Settings"); yield return Idle(); Click("Manage"); yield return Wireframe("device", "titles", "tabs");
            yield return Wait(Adapter.OpenKredits()); yield return Wireframe("kredits", "titles", "cards", "primaries", "quiet", "tabs");
            yield return Wait(Adapter.OpenRewards()); yield return Wireframe("rewards", "titles", "tabs");
            yield return EndScenario();
            yield return PrepareScenario("profile-success"); Phones.WireframeSeeker(host.GetComponent<PageShell>());
            yield return Wait(Adapter.RefreshOverview()); yield return Idle();
            Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenProfile()); yield return Wireframe("aprofile", "titles", "stats", "tabs");
            yield return EndScenario();
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
