using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Integration.App;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        // The Arena's tabs: every change is one change of painting, from the
        // page left straight to the page opened. The Profile wears its own
        // painting while its read is still out (the emblem the overview's
        // profile account already displays), never today's Daily realm first,
        // and Settings keeps the painting it is opened over.
        [UnityTest] public IEnumerator EveryArenaPageChangeIsOneChangeOfPainting()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyIdentity>().Controller;
            var shell = host.GetComponent<PageShell>();
            bool reduced = AppPreferences.ReducedMotion;
            AppPreferences.SetReducedMotion(false);
            yield return Wait(money.OpenDaily()); yield return Rendered(money, AppPage.Home); yield return Settled(shell);
            var watch = PaintWatch.On(shell); var strays = new List<string>();
            try
            {
                string Painting() => PaintWatch.Name(shell.Background.sprite);
                IEnumerator Step(string at, AppPage page, bool once = true)
                {
                    watch.Step = at; string from = Painting();
                    money.Navigate(page); yield return Rendered(money, page); yield return Settled(shell);
                    strays.AddRange(watch.Strays(from, Painting(), false, once));
                }
                yield return Step("Campaign", AppPage.Campaign);
                // The profile read is held: the page waiting for it already wears the profile's painting.
                string map = Painting();
                watch.Step = "Profile, its read still out";
                delay = environment.HoldNextRead("getAccountInfo");
                try
                {
                    money.Navigate(AppPage.Profile); yield return Wait(delay.Entered);
                    yield return new WaitForSecondsRealtime(.6f); yield return Settled(shell);
                    Assert.That(host.GetComponent<PageViews>().Shown, Is.Null, "The profile is still waiting for its read");
                    string waiting = Painting();
                    delay.Release(); yield return Rendered(money, AppPage.Profile); yield return Settled(shell);
                    Assert.That(Painting(), Is.EqualTo(waiting), "The waiting page already wore the profile's painting");
                    // The waiting page and then the profile are two draws on one painting.
                    strays.AddRange(watch.Strays(map, Painting(), false, once: false));
                }
                finally { delay.Release(); }
                string profile = Painting();
                yield return Step("Settings", AppPage.Settings);
                Assert.That(Painting(), Is.EqualTo(profile), "Settings keeps the painting it is opened over");
                yield return Step("Arcade", AppPage.Home);
                yield return Step("Profile again", AppPage.Profile, once: false);
                yield return Step("Campaign from the profile", AppPage.Campaign);
                watch.AssertCovered();
            }
            finally { watch.Stop(); AppPreferences.SetReducedMotion(reduced); }
            Assert.That(strays, Is.Empty, "Every page change is one change of painting:\n" + string.Join("\n", strays));
        }
        // A page change has ended: nothing is leaving and no painting is fading in.
        private static IEnumerator Settled(PageShell shell)
        {
            float until = Time.realtimeSinceStartup + 10;
            do yield return null;
            while (Time.realtimeSinceStartup < until && (shell.Loading || shell.Background.color.a < .999f ||
                shell.Root.GetComponentsInChildren<Transform>().Any(layer => layer.name.StartsWith("Leaving", StringComparison.Ordinal))));
            yield return null;
        }
    }
}
