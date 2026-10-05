using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Presentation;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // Every Arena page, in every state the scenarios reach, speaks the
    // player's words: no retired board or star-source names on screen, the two
    // boards named by their one owner, and every pill's label on one line on a
    // compact phone at larger text.
    public sealed partial class MoneyOverviewTests
    {
        private MoneyAppAdapter Adapter => host.GetComponent<MoneyIdentity>().Controller;
        private IEnumerator Words(string page)
        {
            yield return Idle();
            PageText.AssertPlayerWords(host.transform, page);
            PageText.AssertPillLabelsOnOneLine(host.transform, page);
            var art = host.GetComponent<PageShell>().Artwork;
            if (art != null) PageText.AssertRunningTextFigures(host.transform, page, art.Font(SkinUi.Type.Caption), art.Font(SkinUi.Type.Body));
        }
        // The walk is on a compact phone at larger text, where words are tightest.
        private IEnumerator Compact(string scenario)
        {
            yield return PrepareScenario(scenario, 1.3f);
            Phones.Compact(host.GetComponent<PageShell>());
            yield return Wait(Adapter.RefreshOverview()); yield return Idle();
        }
        private void Set(string field, object value) =>
            typeof(MoneyAppAdapter).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(Adapter, value);
        // States no scenario reaches (a failed read, a cancelled wallet, a run's
        // result) are set as the adapter itself would set them.
        private void Redraw() => typeof(MoneyAppAdapter).GetMethod("Present", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(Adapter, null);

        [UnityTest] public IEnumerator EveryArenaPageSpeaksThePlayersWords()
        {
            yield return Compact("public-disconnected"); yield return Words("Connect");
            Refuse("Connect"); yield return Words("Connect refused");
            yield return EndScenario();

            yield return Compact("owner-overview"); Click("Connect"); yield return Words("Arena with a saved run");
            Click("Settings"); yield return Words("Settings");
            Click("Manage"); yield return Words("This device");
            Click("Back"); yield return Idle(); Click("Last operation"); yield return Words("No operation yet");
            yield return Wait(Adapter.OpenKredits()); yield return Words("Kredits");
            yield return Wait(Adapter.OpenRewards()); yield return Words("Results pending");
            yield return Wait(Adapter.OpenCampaign()); yield return Words("Campaign");
            yield return Wait(Adapter.OpenProfile()); yield return Words("Profile");
            Click("Your records"); yield return Words("Your records");
            Assert.That(PageText.Visible(host.transform), Has.Some.Property("text").EqualTo("Objective boards"));
            Click("Back to Profile"); yield return Idle(); Click("Choose a border"); yield return Words("Borders");
            yield return Wait(Adapter.OpenDaily()); yield return Idle();
            Set("dailyRead", null); Set("failure", "Could not refresh. Try again."); Redraw(); yield return Words("No connection");
            yield return Wait(Adapter.OpenDaily()); yield return Idle();
            long now = environment.Clock(); environment.AdvanceClock((long)ZKube.Core.NativeEngine.Daily(ZKube.Core.NativeEngine.DayAt(now)).FreezesAt - now); yield return null;
            yield return Words("Entries closed");
            yield return EndScenario();

            yield return Compact("daily-playable"); Click("Connect"); yield return Words("Arena");
            Click("Enter · 1 Kredit"); yield return Words("Entry confirmation");
            Set("confirmingDaily", false);
            var lobby = ((MoneyRead<MoneyDailyState>)typeof(MoneyAppAdapter).GetField("dailyRead", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(Adapter)).Value.Lobby;
            Set("lastResult", new ResultPageView { HasResult = true, ProductName = Application.productName, Mode = "Daily", PlayerName = environment.Owner,
                Realm = lobby.Realm, Day = lobby.DayId, ObjectiveKind = lobby.ObjectiveKind, ObjectiveValue = lobby.ObjectiveValue, Score = 1840, ObjectiveTotal = 24, Streak = 7 });
            Adapter.Navigate(AppPage.Result); yield return Words("Daily result");
            yield return EndScenario();

            yield return Compact("kredit-pending-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            yield return Wait(Adapter.PurchaseKredits(environment.KreditPack)); yield return Words("Purchase in progress");
            Adapter.Navigate(AppPage.Settings); yield return Idle(); Click("Last operation"); yield return Words("Transaction pending");
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            Refuse("Kredits"); yield return Words("Purchase refused");
            yield return EndScenario();

            yield return Compact("claim-theme-sealed"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay, "theme")); yield return Words("Boards with a reward");
            Assert.That(host.GetComponentsInChildren<UnityEngine.UI.Button>(), Has.Some.Property("name").EqualTo("Collect Objective"));
            yield return Wait(Adapter.CollectReward("theme")); yield return Words("Objective reward claimed");
            StringAssert.Contains("Objective reward received", string.Join("\n", PageText.Visible(host.transform).Select(text => text.text)));
            Click("Score board"); yield return Words("Score board");
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay - 1)); yield return Words("A day nobody played");
            yield return EndScenario();

            yield return Compact("claim-score-expired"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay)); yield return Words("Reward expired");
            yield return EndScenario();

            yield return Compact("session-enable-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Words("Device setup");
            yield return Wait(Adapter.EnsureDeviceSession()); yield return Words("Device active");
            Click("Disable this device"); yield return Words("Revoke confirmation");
            yield return EndScenario();

            yield return Compact("session-refill-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Words("Device fund");
            yield return EndScenario();

            yield return Compact("session-disable-zero"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            yield return Wait(Adapter.DisableDeviceSession()); yield return Words("Device disabled");
            yield return EndScenario();

            yield return Compact("kredit-buy-10"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            environment.FailFirstReadAfterJournalClear();
            yield return Wait(Adapter.PurchaseKredits(10)); yield return Words("Balance unavailable");
            yield return EndScenario();

            yield return Compact("profile-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenProfile()); yield return Idle();
            Click("Emblem 8"); yield return Words("Wear selection");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        private void Refuse(string family)
        { Set("refusal", "Not approved in your wallet."); Set("refusalFamily", family); Set("refusalRetry", (System.Action)(() => { })); Redraw(); }
        // Every SOL amount has one format, with at least two decimals.
        [Test] public void SolAmountsShowAtLeastTwoDecimals()
        {
            Assert.That(MoneyText.Sol(0), Is.EqualTo("0.00 SOL"));
            Assert.That(MoneyText.Sol(10_000_000), Is.EqualTo("0.01 SOL"));
            Assert.That(MoneyText.Sol(100_000_000), Is.EqualTo("0.10 SOL"));
            Assert.That(MoneyText.Sol(5_000_000), Is.EqualTo("0.005 SOL"));
            Assert.That(MoneyText.Sol(262_000_000), Is.EqualTo("0.262 SOL"));
            Assert.That(MoneyText.Sol(2_400_000_000), Is.EqualTo("2.40 SOL"));
            Assert.That(MoneyText.Sol(ulong.MaxValue), Is.EqualTo("18446744073.709551615 SOL"));
            Assert.That(MoneyAppAdapter.KreditPurchaseLabel(10), Is.EqualTo("Buy 10 Kredits · 0.10 SOL"));
        }
        // Stops one scenario's app so the next scenario starts its own.
        private IEnumerator EndScenario()
        {
            yield return Wait(host.GetComponent<AppStartup>().StopAsync());
            Object.Destroy(host); host = null; yield return null;
        }
    }
}
