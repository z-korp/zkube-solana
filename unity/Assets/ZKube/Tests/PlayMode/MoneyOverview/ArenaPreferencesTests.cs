using System.Collections;
using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        // The settings have one owner, the saved preferences. A board's pause
        // changes them for the pages and for the next board; a page's Settings
        // changes them for a board kept from an earlier run. Entering a Daily
        // rewrites none of them.
        [UnityTest] public IEnumerator SettingsChangedOnABoardOrAPageReachEveryPageAndTheNextBoard()
        {
            string[] flags = { "zkube.motion.reduced", "zkube.sound.muted", "zkube.haptics.enabled", "zkube.text.larger" };
            string[] levels = { AudioPolicy.MusicKey, AudioPolicy.EffectsKey };
            var savedFlags = flags.ToDictionary(key => key, key => PlayerPrefs.HasKey(key) ? PlayerPrefs.GetInt(key) : (int?)null);
            var savedLevels = levels.ToDictionary(key => key, key => PlayerPrefs.HasKey(key) ? PlayerPrefs.GetFloat(key) : (float?)null);
            foreach (string key in flags.Concat(levels)) PlayerPrefs.DeleteKey(key);
            try
            {
                // The saved text size, not a test's explicit one, sizes these pages.
                var startup = Create(); solana = new TextAsset(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
                session = new TextAsset(ZKube.Integration.Tests.TestBootstrap.TokenJson);
                var build = ZKube.Integration.App.Tests.MoneyTestEnvironment.Create("daily-entered"); yield return Wait(build);
                environment = build.GetAwaiter().GetResult();
                ((MoneyIdentity)startup.Configuration.Identity).Configuration = new MoneyConfiguration {
                    SolanaSchema = solana, SessionSchema = session, Services = environment.Services, Clock = environment.Clock };
                host.SetActive(true); yield return null; Follow(.02f, .2f);
                int greeted = ~0; host.GetComponent<PageViews>().Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
                yield return Idle();
                Click("Connect"); yield return Idle();
                float PageSize() => host.GetComponentsInChildren<TMP_Text>().First(text => text.name == "Daily reason" || text.text == "Resume run").fontSize;
                float standard = PageSize();

                // A Campaign run: its pause makes the text larger, then Home.
                Click("Campaign"); yield return Idle(); Click("Trial 1"); yield return Idle();
                Click("Play"); yield return BoardReady();
                var campaign = PlayedBoard(); Assert.That(campaign.TextScale, Is.EqualTo(1f));
                Click("Pause"); yield return null; Click("Dialog Text size: standard"); yield return null; yield return null;
                Assert.That(AppPreferences.TextScale, Is.EqualTo(1.3f));
                Click(PauseDialog.Home); yield return Idle();
                Assert.That(PageSize(), Is.GreaterThan(standard), "The pages follow the size the pause set");

                // The Daily's board is made with it, and entering rewrites nothing.
                yield return SessionClick("Resume run"); yield return BoardReady();
                var daily = PlayedBoard(); Assert.That(daily, Is.Not.SameAs(campaign));
                Assert.That(daily.TextScale, Is.EqualTo(1.3f)); Assert.That(AppPreferences.TextScale, Is.EqualTo(1.3f));
                // Its pause turns reduced motion and haptics on, then Home.
                Click("Pause"); yield return null; Click("Dialog Reduced motion: off"); yield return null; yield return null;
                Click("Dialog Haptics: off"); yield return null; yield return null;
                Click(PauseDialog.Home); yield return Idle();

                // The Settings page lowers the music and puts the text back.
                var controller = host.GetComponent<MoneyIdentity>().Controller;
                controller.Navigate(AppPage.Settings); yield return Idle();
                var settings = controller.SettingsPage();
                Assert.That(settings.ReducedMotion, Is.True); Assert.That(settings.Haptics, Is.True); Assert.That(settings.LargeText, Is.True);
                settings.SetMusic(.25); settings.ToggleText(); yield return Idle();
                Assert.That(controller.SettingsPage().LargeText, Is.False);

                // The Campaign's board was kept from its first run: it plays the next with all of it.
                Click("Campaign"); yield return Idle(); Click("Trial 1"); yield return Idle();
                Click("Resume run"); yield return BoardReady();
                Assert.That(PlayedBoard(), Is.SameAs(campaign), "The Campaign's board is kept between runs");
                Assert.That(campaign.ReducedMotion, Is.True); Assert.That(campaign.Haptics, Is.True);
                Assert.That(campaign.TextScale, Is.EqualTo(1f)); Assert.That(campaign.MusicVolume, Is.EqualTo(.25).Within(1e-6));
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally
            {
                foreach (var pair in savedFlags) if (pair.Value.HasValue) PlayerPrefs.SetInt(pair.Key, pair.Value.Value); else PlayerPrefs.DeleteKey(pair.Key);
                foreach (var pair in savedLevels) if (pair.Value.HasValue) PlayerPrefs.SetFloat(pair.Key, pair.Value.Value); else PlayerPrefs.DeleteKey(pair.Key);
                PlayerPrefs.Save();
            }
        }
    }
}
