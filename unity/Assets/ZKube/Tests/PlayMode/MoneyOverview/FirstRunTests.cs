using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Execution;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The Arena's first run: connect, set up this device, buy Kredits. Each
    // step asks for one thing, a step that cannot work yet is not offered, and
    // a request that does not go through says why and offers it again.
    public sealed partial class MoneyOverviewTests
    {
        private bool Offers(string button) => host.GetComponentsInChildren<Button>().Any(value => value.name == button);
        private bool Says(string words) => host.GetComponentsInChildren<TMP_Text>().Any(value => value.text.Contains(words));
        private int Asked(string operation) => environment.Calls.Count(call => call.Operation == operation);
        private IEnumerator FirstRun(string scenario, string phone)
        {
            yield return PrepareScenario(scenario);
            var shell = host.GetComponent<PageShell>();
            if (phone == "seeker") Phones.Seeker(shell); else if (phone == "compact") Phones.Compact(shell);
            if (phone != null) { yield return Wait(Adapter.RefreshOverview()); yield return Idle(); }
        }
        private IEnumerator Step(string phone, string step)
        {
            yield return Idle(); yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f); Canvas.ForceUpdateCanvases();
            yield return Captures.Snap(host.GetComponent<PageShell>(), "first-run " + phone + " " + step);
        }

        // The cluster refuses the setup before the wallet is asked: the page
        // says so in place of the action, and the retry reaches the wallet.
        [UnityTest] public IEnumerator ARefusedDeviceSetupSaysWhyAndItsRetryReachesTheWallet()
        {
            yield return FirstRun("session-enable-success", null); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            environment.RefuseNextSimulation();
            yield return SessionClick("Enable device"); yield return Idle();
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Rejected));
            Assert.That(Adapter.LastReceipt.Code, Is.EqualTo("simulation-rejected"));
            Assert.That(Asked("signTransactions"), Is.Zero, "The wallet is never asked for a transaction the cluster refuses");
            Assert.That(Text("Action refused"), Is.EqualTo("Solana refused this request. Check your wallet’s SOL."));
            Assert.That(Offers("Enable device"), Is.False); Assert.That(Offers("View operation"), Is.False);
            yield return SessionClick("Try again"); yield return Idle();
            Assert.That(Asked("signTransactions"), Is.EqualTo(1));
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Text("Device state"), Is.EqualTo("Session active"));
            Assert.That(Offers("Try again"), Is.False); Assert.That(Says("refused"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The program is not on the cluster: the Arcade, this device and the
        // Kredits say the Arena opens soon and lead to the Campaign.
        [UnityTest] public IEnumerator BeforeTheArenaOpensNoPageOffersAnActionThatCannotWork()
        {
            yield return FirstRun("arena-not-open", null);
            Assert.That(Text("Daily headline"), Is.EqualTo("Opens soon")); Assert.That(Text("Daily reason detail"), Is.EqualTo("Campaign is open now."));
            Click("Connect"); yield return Idle();
            Assert.That(Text("Daily headline"), Is.EqualTo("Opens soon"));
            foreach (string action in new[] { "Set up device", "Enter · 1 Kredit", "Kredits", "Rewards" }) Assert.That(Offers(action), Is.False, action);
            Assert.That(Offers("Play Campaign"), Is.True);
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            Assert.That(Offers("Enable device"), Is.False); Assert.That(Says("Arena opens soon"), Is.True);
            // Asked for anyway, the setup opens no wallet and the page keeps saying why.
            yield return Wait(Adapter.EnsureDeviceSession()); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            Assert.That(host.GetComponentsInChildren<Button>().Any(value => value.name.StartsWith("Buy ")), Is.False);
            Assert.That(Says("Arena opens soon"), Is.True);
            yield return SessionClick("Play Campaign"); yield return Idle();
            Assert.That(Adapter.BrowsingCampaign, Is.True);
            Assert.That(Asked("signTransactions") + Asked("simulateTransaction") + Asked("sendTransaction"), Is.Zero);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Nothing remembers that the Arena was closed: each page reads the
        // protocol account, and reads it again while the game has not launched.
        // An initialized protocol without a launch day is still closed; once the
        // launch Daily exists the page in front of the player opens by itself.
        [UnityTest] public IEnumerator TheArenaOpensByItselfOnceItsLaunchDailyExists()
        {
            IEnumerator Later() { environment.AdvanceClock(31); yield return null; yield return Idle(); }
            yield return FirstRun("arena-not-open", null);
            environment.Stage(); yield return Later();
            Assert.That(Text("Daily headline"), Is.EqualTo("Opens soon"), "An initialized protocol has not launched");
            Click("Connect"); yield return Idle();
            Assert.That(Text("Daily headline"), Is.EqualTo("Opens soon")); Assert.That(Offers("Set up device"), Is.False);
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            Assert.That(Says("Arena opens soon"), Is.True);
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            Assert.That(Offers("Enable device"), Is.False); Assert.That(Says("Arena opens soon"), Is.True);
            yield return Later();
            Assert.That(Offers("Enable device"), Is.False, "Reading again finds the same chain state");

            environment.Launch(); yield return Later();
            Assert.That(Offers("Enable device"), Is.True, "The device page opens without being reopened");
            Assert.That(Says("Arena opens soon"), Is.False);
            int reads = Asked("getAccountInfo");
            yield return Later();
            Assert.That(Asked("getAccountInfo"), Is.EqualTo(reads), "A launched Arena is not read again on a timer");
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            Assert.That(host.GetComponentsInChildren<Button>().Any(value => value.name.StartsWith("Buy ")), Is.True);
            yield return Wait(Adapter.OpenDaily()); yield return Idle();
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(value => value.name == "Daily headline" && value.text == "Opens soon"), Is.False);
            Assert.That(Offers("Set up device"), Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // What the wallet puts on a device is a deposit on every page: the amount
        // asked for, what a run costs, that the rest returns, the deposit left on a
        // device in use, and the top-up. No page calls it a fee.
        [UnityTest] public IEnumerator TheDeviceDepositIsADepositOnEveryPageAndNeverAFee()
        {
            string deposit = ZKube.Integration.Presentation.MoneyText.Sol(ZKube.Integration.Planning.DeviceFunding.DepositLamports);
            void NoFee(string page) => Assert.That(host.GetComponentsInChildren<TMP_Text>().Select(value => value.text)
                .Where(text => text.ToLowerInvariant().Contains("fee") || text.ToLowerInvariant().Contains("allowance")), Is.Empty, page);
            yield return FirstRun("session-enable-success", null); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            Assert.That(deposit, Is.EqualTo("0.021 SOL"));
            Assert.That(Text("Deposit"), Is.EqualTo(deposit));
            Assert.That(Text("Device guide"), Is.EqualTo("About 0.0003 SOL per run. The rest returns when you disable this device."));
            NoFee("setup");
            yield return Wait(Adapter.EnsureDeviceSession()); yield return Idle();
            Assert.That(Text("Deposit"), Is.EqualTo(deposit), "A device in use shows the deposit it has left");
            NoFee("in use");
            yield return SessionClick("Disable this device"); yield return Idle();
            Assert.That(Says("The deposit left returns to your wallet."), Is.True); NoFee("disable");
            yield return EndScenario();

            yield return FirstRun("session-refill-success", null); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            Assert.That(Text("Device state"), Is.EqualTo("Deposit low"));
            Assert.That(Text("Deposit"), Is.EqualTo("0.00 SOL"));
            Assert.That(Text("Device guide"), Is.EqualTo("Top up the deposit to continue. Your wallet brings it back to " + deposit + "."));
            NoFee("low");
            yield return SessionClick("Top up deposit"); yield return Idle();
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Text("Deposit"), Is.EqualTo(deposit));
            yield return SessionClick("View operation"); yield return Idle();
            Assert.That(Says("Deposit top-up confirmed"), Is.True); NoFee("receipt");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Connecting and buying are owner-wallet requests like the setup: a
        // refusal stays on the page with its reason, and its retry asks again.
        [UnityTest] public IEnumerator EveryOwnerWalletActionThatFailsShowsItsReasonWithARetry()
        {
            yield return FirstRun("kredit-buy-10", null);
            environment.Native.Reject = true; Click("Connect"); yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            Assert.That(Text("Daily reason"), Is.EqualTo("Not approved in your wallet."));
            Assert.That(Offers("Connect"), Is.False);
            Click("Try again"); yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.EqualTo(environment.Owner));
            Assert.That(Asked("authorize"), Is.EqualTo(2));

            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            environment.RefuseNextSimulation();
            yield return SessionClick(ZKube.Integration.Presentation.MoneyAppAdapter.KreditPurchaseLabel(10)); yield return Idle();
            Assert.That(Text("Action refused"), Is.EqualTo("Solana refused this request. Check your wallet’s SOL."));
            Assert.That(Asked("signTransactions"), Is.Zero);
            Assert.That(host.GetComponentsInChildren<Button>().Any(value => value.name.StartsWith("Buy ")), Is.False);
            yield return SessionClick("Try again"); yield return Idle();
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Asked("signTransactions"), Is.EqualTo(1));
            Assert.That(Offers("Try again"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Each first-run screen on the Seeker and a 360 x 640 phone: one thing
        // to do, no sentence repeating its button, nothing to scroll for.
        [UnityTest] public IEnumerator EachFirstRunStepAsksForOneThingOnBothPhones()
        {
            foreach (string phone in new[] { "seeker", "compact" })
            {
                yield return FirstRun("public-disconnected", phone); yield return Step(phone, "1 connect");
                Assert.That(host.GetComponentsInChildren<Button>().Select(value => value.name), Is.EqualTo(new[] { "Connect" }));
                yield return EndScenario();

                yield return FirstRun("arena-not-open", phone); Click("Connect"); yield return Step(phone, "2 arcade not open");
                yield return Wait(Adapter.OpenSession()); yield return Step(phone, "3 device not open");
                yield return EndScenario();

                // An address with no player yet: the Arcade's one action is the setup.
                yield return FirstRun("public-disconnected", phone); Click("Connect"); yield return Step(phone, "5 arcade set up");
                Assert.That(Offers("Set up device"), Is.True);
                Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(value => value.name == "Daily reason"), Is.False, "The button says what to do");
                yield return EndScenario();

                yield return FirstRun("session-enable-success", phone); Click("Connect"); yield return Idle();
                yield return Wait(Adapter.OpenSession()); yield return Step(phone, "6 device setup");
                Assert.That(Offers("Enable device"), Is.True); Assert.That(Offers("Back to Campaign"), Is.False);
                environment.RefuseNextSimulation();
                yield return Wait(Adapter.EnsureDeviceSession()); yield return Step(phone, "4 device refused");
                yield return Wait(Adapter.EnsureDeviceSession()); yield return Step(phone, "7 device active");
                Click("Disable this device"); yield return Step(phone, "10 disable confirmation");
                yield return EndScenario();

                yield return FirstRun("session-refill-success", phone); Click("Connect"); yield return Idle();
                yield return Wait(Adapter.OpenSession()); yield return Step(phone, "11 deposit low");
                yield return EndScenario();

                yield return FirstRun("session-owner-decline", phone); Click("Connect"); yield return Idle();
                yield return Wait(Adapter.OpenSession()); yield return Idle();
                yield return Wait(Adapter.EnsureDeviceSession()); yield return Step(phone, "8 device declined");
                yield return EndScenario();

                yield return FirstRun("kredit-buy-10", phone); Click("Connect"); yield return Idle();
                yield return Wait(Adapter.OpenKredits()); yield return Step(phone, "9 kredits");
                var shell = host.GetComponent<PageShell>();
                Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Viewport.rect.height + .5f), phone + " Kredits fits without scrolling");
                yield return EndScenario();
            }
        }
    }
}
