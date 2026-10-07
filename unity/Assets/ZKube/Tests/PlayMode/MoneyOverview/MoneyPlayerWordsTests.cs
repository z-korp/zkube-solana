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
            PageText.AssertPlayerWords(host.transform, page);
            PageText.AssertPillLabelsOnOneLine(host.transform, page);
            var art = host.GetComponent<PageShell>().Artwork;
            if (art != null) PageText.AssertRunningTextFigures(host.transform, page, art.Font(SkinUi.Type.Caption), art.Font(SkinUi.Type.Body));
            yield break;
        }
        private void Set(string field, object value) =>
            typeof(MoneyAppAdapter).GetField(field, BindingFlags.Instance | BindingFlags.NonPublic).SetValue(Adapter, value);
        // States no scenario reaches (a failed read, a cancelled wallet, a run's
        // result) are set as the adapter itself would set them.
        private void Redraw() => typeof(MoneyAppAdapter).GetMethod("Present", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(Adapter, null);

        // The walk is on a compact phone at larger text, where words are tightest.
        [UnityTest] public IEnumerator EveryArenaPageSpeaksThePlayersWords()
        { yield return EveryArenaPage(shell => Phones.Compact(shell), 1.3f, Words); }

        // One walk of every Arena page, in every state the scenarios reach, on the
        // phone and at the text size its caller names; at is run on each page as
        // it stands. The words and the placement guard both take it.
        private IEnumerator EveryArenaPage(System.Action<PageShell> phone, float scale, System.Func<string, IEnumerator> at)
        {
            IEnumerator Open(string scenario)
            {
                yield return PrepareScenario(scenario, scale);
                phone(host.GetComponent<PageShell>());
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
            }
            IEnumerator Page(string page) { yield return Idle(); yield return at(page); }
            yield return Open("public-disconnected"); yield return Page("Connect");
            Refuse("Connect"); yield return Page("Connect refused");
            yield return EndScenario();

            yield return Open("owner-overview"); Click("Connect"); yield return Page("Arena with a saved run");
            Click("Settings"); yield return Page("Settings");
            Click("Manage"); yield return Page("This device");
            // A refused action on each page that can hold one: its reason is on the page once, whoever draws it.
            Refuse("Device"); yield return Page("This device refused"); Unrefuse();
            Click(LitTab); yield return Idle(); Click("Last operation"); yield return Page("No operation yet");
            yield return Wait(Adapter.OpenKredits()); yield return Page("Kredits");
            yield return Wait(Adapter.OpenRewards()); yield return Page("Results pending");
            Refuse("Rewards"); yield return Page("Boards refused"); Unrefuse();
            yield return Wait(Adapter.OpenCampaign()); yield return Page("Campaign");
            yield return Wait(Adapter.OpenProfile()); yield return Page("Profile");
            Refuse("Profile"); yield return Page("Profile refused"); Unrefuse();
            Click("Your records"); yield return Page("Your records");
            Assert.That(PageText.Visible(host.transform), Has.Some.Property("text").EqualTo("Objective boards"));
            Click(LitTab); yield return Idle(); Click("Choose a border"); yield return Page("Borders");
            yield return Wait(Adapter.OpenDaily()); yield return Idle();
            Set("dailyRead", null); Set("failure", "Could not refresh. Try again."); Redraw(); yield return Page("No connection");
            yield return Wait(Adapter.OpenDaily()); yield return Idle();
            long now = environment.Clock(); environment.AdvanceClock((long)ZKube.Core.NativeEngine.Daily(ZKube.Core.NativeEngine.DayAt(now)).FreezesAt - now); yield return null;
            yield return Page("Entries closed");
            yield return EndScenario();

            yield return Open("daily-playable"); Click("Connect"); yield return Page("Arena");
            Refuse("Daily"); yield return Page("Arena refused"); Unrefuse(); yield return Idle();
            Click("Enter · 1 Kredit"); yield return Page("Entry confirmation");
            Set("confirmingDaily", false);
            var lobby = ((MoneyRead<MoneyDailyState>)typeof(MoneyAppAdapter).GetField("dailyRead", BindingFlags.Instance | BindingFlags.NonPublic)
                .GetValue(Adapter)).Value.Lobby;
            Set("lastResult", new ResultPageView { HasResult = true, ProductName = Application.productName, Mode = "Daily", PlayerName = environment.Owner,
                Realm = lobby.Realm, Day = lobby.DayId, ObjectiveKind = lobby.ObjectiveKind, ObjectiveValue = lobby.ObjectiveValue, Score = 1840, ObjectiveTotal = 24, Streak = 7 });
            Adapter.Navigate(AppPage.Result); yield return Page("Daily result");
            yield return EndScenario();

            yield return Open("kredit-pending-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            yield return Wait(Adapter.PurchaseKredits(environment.KreditPack)); yield return Page("Purchase in progress");
            Adapter.Navigate(AppPage.Settings); yield return Idle(); Click("Last operation"); yield return Page("Transaction pending");
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            Refuse("Kredits"); yield return Page("Purchase refused");
            yield return EndScenario();

            yield return Open("claim-theme-sealed"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay, "theme")); yield return Page("Boards with a reward");
            Assert.That(host.GetComponentsInChildren<UnityEngine.UI.Button>(), Has.Some.Property("name").EqualTo("Collect Objective"));
            yield return Wait(Adapter.CollectReward("theme")); yield return Page("Objective reward claimed");
            StringAssert.Contains("Objective reward received", string.Join("\n", PageText.Visible(host.transform).Select(text => text.text)));
            Click("Score board"); yield return Page("Score board");
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay - 1)); yield return Page("A day nobody played");
            yield return EndScenario();

            yield return Open("claim-score-expired"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay)); yield return Page("Reward expired");
            yield return EndScenario();

            yield return Open("session-enable-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Page("Device setup");
            yield return Wait(Adapter.EnsureDeviceSession()); yield return Page("Device active");
            Click("Disable this device"); yield return Page("Revoke confirmation");
            yield return EndScenario();

            yield return Open("session-refill-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Page("Device fund");
            yield return EndScenario();

            yield return Open("session-disable-zero"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            yield return Wait(Adapter.DisableDeviceSession()); yield return Page("Device disabled");
            yield return EndScenario();

            yield return Open("kredit-buy-10"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            environment.FailFirstReadAfterJournalClear();
            yield return Wait(Adapter.PurchaseKredits(10)); yield return Page("Balance unavailable");
            yield return EndScenario();

            yield return Open("profile-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenProfile()); yield return Idle();
            Click("Emblem 8"); yield return Page("Wear selection");
            Refuse("Profile"); yield return Page("Wear selection refused"); Unrefuse();
            Assert.That(environment.ForbiddenCalls, Is.Zero);
            yield return EndScenario();
        }
        private void Refuse(string family)
        { Set("refusal", "Not approved in your wallet."); Set("refusalFamily", family); Set("refusalRetry", (System.Action)(() => { })); Redraw(); }
        private void Unrefuse() { Set("refusal", null); Set("refusalFamily", null); Set("refusalRetry", null); Redraw(); }
        // Every SOL amount has one format: its figure with at least two decimals, then the Solana mark.
        // Only a sentence says the word.
        [Test] public void SolAmountsShowAtLeastTwoDecimals()
        {
            Assert.That(MoneyText.Sol(0), Is.EqualTo("0.00" + CurrencyMark.Tag));
            Assert.That(MoneyText.Sol(10_000_000), Is.EqualTo("0.01" + CurrencyMark.Tag));
            Assert.That(MoneyText.Sol(100_000_000), Is.EqualTo("0.10" + CurrencyMark.Tag));
            Assert.That(MoneyText.Sol(5_000_000), Is.EqualTo("0.005" + CurrencyMark.Tag));
            Assert.That(MoneyText.Sol(262_000_000), Is.EqualTo("0.262" + CurrencyMark.Tag));
            Assert.That(MoneyText.Sol(2_400_000_000), Is.EqualTo("2.40" + CurrencyMark.Tag));
            Assert.That(MoneyText.Sol(ulong.MaxValue), Is.EqualTo("18446744073.709551615" + CurrencyMark.Tag));
            Assert.That(MoneyAppAdapter.KreditPurchaseLabel(10), Is.EqualTo("Buy 10 Kredits · 0.10" + CurrencyMark.Tag));
            Assert.That(MoneyText.SolInWords(300_000), Is.EqualTo("0.0003 SOL"));
        }
        // Stops one scenario's app so the next scenario starts its own.
        private IEnumerator EndScenario()
        {
            NoStrayOpens();
            yield return Wait(host.GetComponent<AppStartup>().StopAsync());
            Object.Destroy(host); host = null; yield return null;
        }
    }
}
