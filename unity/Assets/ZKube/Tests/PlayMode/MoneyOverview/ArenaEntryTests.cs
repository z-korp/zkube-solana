using System.Collections;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.Presentation;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // Entering the Arena with an address, however the address arrived, and the
    // rule under it: a page never waits on a read nobody is making.
    public sealed partial class MoneyOverviewTests
    {
        private object Field(string name) =>
            typeof(MoneyAppAdapter).GetField(name, BindingFlags.Instance | BindingFlags.NonPublic).GetValue(Adapter);
        private IEnumerator Until(System.Func<bool> met, string what)
        {
            float limit = Time.realtimeSinceStartup + 15;
            while (!met() && Time.realtimeSinceStartup < limit) yield return null;
            Assert.That(met(), Is.True, what);
        }

        // On a phone the wallet comes to the front for its request. That pauses
        // the app, which retires the operation that asked, and the app resumes
        // before the wallet's answer arrives. The address is entered all the same.
        [UnityTest] public IEnumerator TheArenaLoadsAfterConnectingThroughAWalletThatPausedTheApp()
        {
            yield return PrepareScenario("owner-overview");
            environment.Native.Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            environment.Native.Release = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            Click("Connect"); yield return Wait(environment.Native.Entered.Task);
            Adapter.SendMessage("OnApplicationPause", true);
            Adapter.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            environment.Native.Release.TrySetResult(true);
            yield return Until(() => environment.Services.Identity.Owner != null, "The wallet answered");
            yield return Until(() => Field("dailyRead") != null, "The Arena is read without a tap"); yield return Idle();
            Assert.That(Adapter.BrowsingDaily, Is.True);
            Assert.That(Offers("Resume run"), Is.True);
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.text.Contains("Checking")), Is.False);
            Assert.That(Asked("authorize"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A start on a device that kept its wallet authorization enters with that
        // address and asks no wallet. Disconnecting ends it for this start too.
        [UnityTest] public IEnumerator ARestartWithASavedAuthorizationEntersWithItsAddressWithoutAskingTheWallet()
        {
            yield return PrepareScenario("restart-saved");
            yield return Until(() => Field("dailyRead") != null, "The Arena is read for the saved address"); yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.EqualTo(environment.Owner));
            Assert.That(Asked("authorize"), Is.Zero, "No wallet is asked at start");
            Assert.That(Offers("Connect"), Is.False); Assert.That(Offers("Resume run"), Is.True);
            Click("Settings"); yield return Idle(); Click("Disconnect"); yield return Idle();
            yield return Wait(Adapter.RefreshOverview()); yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.Null, "A disconnected address is not restored by a refresh");
            Assert.That(Offers("Connect"), Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A saved authorization is proven by the next wallet request. A wallet that
        // answers for another account ends it: the page is Connect again, with no
        // address, receipt or device page left from the stale one, and the wallet is
        // not asked to deauthorize what it already refused.
        [UnityTest] public IEnumerator AWalletThatNoLongerAnswersForTheSavedAddressFallsBackToConnect()
        {
            yield return PrepareScenario("session-owner-decline"); environment.WalletError = "account-changed";
            Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            yield return SessionClick("Enable device");
            yield return Until(() => environment.Services.Identity.Owner == null, "The stale address is dropped"); yield return Idle();
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Home));
            Assert.That(Text("Daily reason"), Is.EqualTo("The wallet account changed. Connect again."));
            Assert.That(Adapter.LastReceipt, Is.Null); Assert.That(Adapter.BrowsingSession, Is.False);
            Assert.That(Asked("disconnect"), Is.Zero);
            Assert.That(environment.SentSignature, Is.Null);
            Click("Try again"); yield return Idle();
            Assert.That(environment.Services.Identity.Owner, Is.EqualTo(environment.Owner));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The Arena has one home page, the one under the wordmark. It carries the
        // connect request, a refused connection, the wait for its read, a failed
        // read and the Arena itself; no titled panel stands in for it, and its
        // tab is named Arena.
        [UnityTest] public IEnumerator TheArenaHasOneHomePageInEveryState()
        {
            void Home(string state)
            {
                var views = host.GetComponent<PageViews>();
                Assert.That(views.Shown, Is.EqualTo(AppPage.Home), state); Assert.That(views.ShownPanel, Is.Null, state);
                Assert.That(host.GetComponentsInChildren<Image>().Count(image => image.name == "Wordmark"), Is.EqualTo(1), state);
            }
            yield return PrepareScenario("owner-overview"); Home("no address");
            Assert.That(host.GetComponentsInChildren<Button>().Select(button => button.name), Is.EqualTo(new[] { "Connect" }), "One action and no tabs before an address");
            Assert.That(Text("Daily reason detail"), Is.EqualTo("Connecting is free."));

            environment.Native.Reject = true; Click("Connect"); yield return Idle(); Home("refused");
            Assert.That(Text("Daily reason"), Is.EqualTo("Not approved in your wallet."));

            delay = environment.HoldNextRead("getMultipleAccounts"); Click("Try again"); yield return Wait(delay.Entered); yield return Drawn();
            yield return Until(() => host.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Daily headline"), "The waiting page is drawn");
            Home("waiting for its read");
            Assert.That(Text("Daily headline"), Is.EqualTo("Checking…"));
            Assert.That(Find("Arena"), Is.Not.Null, "The tab is named Arena");
            delay.Release(); yield return Idle(); Home("read");
            Assert.That(Offers("Resume run"), Is.True);

            Set("dailyRead", null); Set("failure", "Could not refresh. Try again."); Redraw(); yield return Idle(); Home("failed read");
            Assert.That(Text("Daily headline"), Is.EqualTo("Not loaded"));
            Assert.That(Offers("Play Campaign"), Is.True);
            Click("Try again"); yield return Idle(); Home("read again");
            Assert.That(Offers("Resume run"), Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A request that fails says what failed, on the page and in one log line:
        // a busy endpoint, a timeout and a network that cannot be reached are told
        // apart, the wallet is never asked for a transaction that was not prepared,
        // and the line carries the action, the host and the call, never a path.
        [UnityTest] public IEnumerator AFailedRequestSaysWhatFailedOnThePageAndInTheLog()
        {
            yield return PrepareScenario("session-enable-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            var lines = new System.Collections.Generic.List<string>(); var sink = ZKube.Integration.Transport.ClientLog.Sink;
            ZKube.Integration.Transport.ClientLog.Sink = lines.Add;
            try
            {
                environment.Http.FailNext("getLatestBlockhash", new ZKube.Integration.Transport.HttpStatusException(429));
                yield return SessionClick("Enable device"); yield return Idle();
                Assert.That(Text("Action refused"), Is.EqualTo("Solana is busy. Try again in a moment."));
                Assert.That(lines.Count, Is.EqualTo(1), string.Join("\n", lines));
                StringAssert.StartsWith("zKube request failed: action=session-renew outcome=Rejected code=preparation-failed kind=Busy service=Solana host=base.invalid call=getLatestBlockhash status=429", lines[0]);
                StringAssert.DoesNotContain("base.invalid/", lines[0]); StringAssert.DoesNotContain(environment.Owner, lines[0]);

                environment.Http.FailNext("simulateTransaction", new System.TimeoutException("No answer within 30 s"));
                yield return SessionClick("Try again"); yield return Idle();
                Assert.That(Text("Action refused"), Is.EqualTo("Solana took too long to answer."));
                Assert.That(Asked("signTransactions"), Is.Zero);

                lines.Clear();
                environment.Http.FailNext("getMultipleAccounts", new System.Net.Http.HttpRequestException("An error occurred while sending the request",
                    new System.Net.WebException("Error: NameResolutionFailure", System.Net.WebExceptionStatus.NameResolutionFailure)));
                yield return Wait(Adapter.OpenDaily()); yield return Idle();
                Assert.That(Text("Daily headline"), Is.EqualTo("Not loaded"));
                Assert.That(Text("Daily reason"), Is.EqualTo("The network could not be reached."));
                Assert.That(lines.Count(line => line.StartsWith("zKube request failed: action=read Daily kind=NoNetwork service=Solana host=base.invalid call=getMultipleAccounts")), Is.EqualTo(1), string.Join("\n", lines));
                Click("Try again"); yield return Idle();
                Assert.That(Offers("Resume run"), Is.True);
            }
            finally { ZKube.Integration.Transport.ClientLog.Sink = sink; }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A sent transaction is followed by the client: the page reaches the
        // outcome without a tap. A round of the wait that runs out says it is
        // still checking and the next one starts by itself; no round signs or
        // sends again.
        [UnityTest] public IEnumerator ASentTransactionIsFollowedToItsOutcomeWithoutATap()
        {
            yield return PrepareScenario("session-enable-pending-success"); Follow(.02f, 10);
            Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            environment.Http.ConfirmAfter = 4;
            yield return SessionClick("Enable device"); yield return Idle();
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess));
            Assert.That(Text("Device state"), Is.EqualTo("Session active"));
            Assert.That(Asked("getSignatureStatuses"), Is.GreaterThanOrEqualTo(4));
            Assert.That(Offers("Try again"), Is.False);
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.text.Contains("Checked the existing transaction")), Is.False,
                "An action's own transaction is not reported as a recovered one");
            Assert.That(Asked("signTransactions"), Is.EqualTo(1)); Assert.That(Asked("sendTransaction"), Is.EqualTo(1));
            yield return EndScenario();

            // The cluster stays silent: each round is bounded, and the next only follows.
            yield return PrepareScenario("session-enable-pending-success"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenSession()); yield return Idle();
            yield return SessionClick("Enable device"); yield return Idle();
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.Pending));
            Assert.That(Says("Still checking."), Is.True); Assert.That(Offers("Action progress"), Is.True, "The loader stays on the page");
            Assert.That(Offers("Enable device"), Is.False); Assert.That(Offers("Try again"), Is.False, "Nobody is asked to check");
            Follow(.02f, 10); environment.Http.ConfirmAfter = 3;
            yield return Until(() => Adapter.LastReceipt.Outcome == ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess, "A later round finds the outcome"); yield return Idle();
            Assert.That(Text("Device state"), Is.EqualTo("Session active"));
            Assert.That(Asked("signTransactions"), Is.EqualTo(1)); Assert.That(Asked("sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A wallet that returns another message than it was given is refused as
        // before, and what it changed is kept: on the page and in one log line,
        // as counts, program IDs and yes/no facts, with no other key in it.
        [UnityTest] public IEnumerator AMessageTheWalletChangedIsNotSentAndSaysWhatChanged()
        {
            const string added = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
            yield return PrepareScenario("kredit-buy-10"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            var lines = new System.Collections.Generic.List<string>(); var sink = ZKube.Integration.Transport.ClientLog.Sink;
            ZKube.Integration.Transport.ClientLog.Sink = lines.Add;
            try
            {
                environment.WalletAdds = added;
                yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(10)); yield return Idle();
                Assert.That(Adapter.LastReceipt.Code, Is.EqualTo("wallet-changed-message"));
                Assert.That(Asked("sendTransaction"), Is.Zero);
                string summary = "instructions 3 to 4; added " + added + "; removed none; rewritten in place 0; fee payer same; blockhash same; signers same; accounts changed (";
                StringAssert.StartsWith("Your wallet changed this request, so it was not sent. (" + summary, Text("Action refused"));
                Assert.That(lines.Count, Is.EqualTo(1), string.Join("\n", lines));
                StringAssert.StartsWith("zKube request failed: action=purchase-kredits outcome=Rejected code=wallet-changed-message evidence=\"" + summary, lines[0]);
                StringAssert.DoesNotContain(environment.Owner, lines[0]); StringAssert.DoesNotContain(environment.Owner, Text("Action refused"));
                environment.WalletAdds = null;
                yield return SessionClick("Try again"); yield return Idle();
                Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess));
            }
            finally { ZKube.Integration.Transport.ClientLog.Sink = sink; }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The wallet comes to the front for the purchase, which pauses the app and
        // retires the page's reads. That must not cancel the request the player is
        // approving: the approved purchase is sent and confirmed, and the page
        // shows the new balance when the app is back, without a tap.
        [UnityTest] public IEnumerator APurchaseApprovedWhileTheWalletPausedTheAppIsSentAndConfirmed()
        {
            yield return PrepareScenario("kredit-buy-10"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            var hold = environment.HoldNextWallet();
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(10));
            try
            {
                yield return Wait(hold.Entered);
                Adapter.SendMessage("OnApplicationPause", true);
                Adapter.SendMessage("OnApplicationPause", false); yield return null;
                hold.Release();
                yield return Until(() => !Adapter.EconomyActionPending, "The purchase finished"); yield return null; yield return Idle();
                yield return Until(() => Field("kreditRead") != null, "The page read its balance again"); yield return Idle();
                Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess), Adapter.LastReceipt.Code);
                yield return Until(() => Text("Kredit balance") == "35", "The balance counts up to the confirmed figure");
                Assert.That(Asked("signTransactions"), Is.EqualTo(1)); Assert.That(Asked("sendTransaction"), Is.EqualTo(1));
                Assert.That(Offers("Try again"), Is.False);
            }
            finally { hold.Release(); }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A request refused after the wallet paused the app still says why, with
        // its retry, on the page it was asked from; it writes its one log line; and
        // the last operation states the same cause, never a generic sentence.
        [UnityTest] public IEnumerator ARefusalAfterTheWalletPausedTheAppStillSaysWhyAndLogsIt()
        {
            yield return PrepareScenario("kredit-owner-decline"); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            var lines = new System.Collections.Generic.List<string>(); var sink = ZKube.Integration.Transport.ClientLog.Sink;
            ZKube.Integration.Transport.ClientLog.Sink = lines.Add;
            var hold = environment.HoldNextWallet();
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(environment.KreditPack));
            try
            {
                yield return Wait(hold.Entered);
                Adapter.SendMessage("OnApplicationPause", true);
                Adapter.SendMessage("OnApplicationPause", false); yield return null;
                hold.Release();
                yield return Until(() => !Adapter.EconomyActionPending, "The request finished"); yield return null; yield return Idle();
                yield return Until(() => Field("kreditRead") != null, "The page read again"); yield return Idle();
                Assert.That(Text("Action refused"), Is.EqualTo("Not approved in your wallet."));
                Assert.That(Offers("Try again"), Is.True);
                Assert.That(lines, Is.EqualTo(new[] { "zKube request failed: action=purchase-kredits outcome=Rejected code=wallet-rejected" }));
                Assert.That(Asked("sendTransaction"), Is.Zero);
                Click("Settings"); yield return Idle(); Click("Last operation"); yield return Idle();
                Assert.That(host.GetComponent<PageViews>().ShownPanel, Is.EqualTo("Operation"));
                Assert.That(Text("Transaction receipt"), Is.EqualTo("Not approved in your wallet."));
            }
            finally { hold.Release(); ZKube.Integration.Transport.ClientLog.Sink = sink; }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A run that was entered and delegated but never got its opening VRF (the
        // rollup refused a call the client should not have made) is offered as
        // Resume on the home page; resuming asks the rollup for the opening VRF,
        // with only calls a rollup answers, and opens the board.
        [UnityTest] public IEnumerator ResumingAnEnteredRunRequestsItsOpeningVrfAndOpensTheBoard()
        {
            yield return PrepareScenario("daily-entered"); Click("Connect"); yield return Idle();
            Assert.That(Offers("Resume run"), Is.True);
            Assert.That(Asked("sendTransaction"), Is.Zero);
            yield return SessionClick("Resume run");
            yield return BoardReady();
            Assert.That(PlayedBoard().Session.Daily, Is.True);
            Assert.That(Asked("sendTransaction"), Is.EqualTo(1), "The opening VRF request");
            Assert.That(Asked("signTransactions"), Is.Zero, "The device asks; the wallet is not needed");
            var rollup = environment.Http.Transport.AskedOfTheRollup;
            Assert.That(rollup, Does.Contain("sendTransaction"));
            Assert.That(rollup, Is.SubsetOf(ZKube.Integration.Transport.SolanaRpcTransport.RollupMethods));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // On a phone the wallet's pause retires the page's operation. A purchase
        // that confirms after the executor's first looks is then followed by the
        // page itself when the app is back: no wait declared over, no tap, the
        // balance updates, and the log carries its timing to the page showing it.
        [UnityTest] public IEnumerator APausedPurchaseThatConfirmsLateIsFollowedByThePageItself()
        {
            yield return PrepareScenario("kredit-pending-success"); Follow(.02f, 10);
            Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenKredits()); yield return Idle();
            var lines = new System.Collections.Generic.List<string>(); var sink = ZKube.Integration.Transport.ClientLog.Sink;
            ZKube.Integration.Transport.ClientLog.Sink = line => { lock (lines) lines.Add(line); };
            var hold = environment.HoldNextWallet();
            environment.Http.ConfirmAfter = 4 + ZKube.Integration.Execution.TransactionExecutor.PromptChecks;
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(environment.KreditPack));
            try
            {
                yield return Wait(hold.Entered);
                Adapter.SendMessage("OnApplicationPause", true);
                Adapter.SendMessage("OnApplicationPause", false); yield return null;
                hold.Release();
                yield return Until(() => Adapter.LastReceipt?.Outcome == ZKube.Integration.Execution.ExecutionOutcome.ConfirmedSuccess, "The page followed the purchase to its confirmation");
                yield return Idle(); yield return Until(() => Field("kreditRead") != null, "The page read its balance"); yield return Idle();
                yield return Until(() => Text("Kredit balance") == (25 + environment.KreditPack).ToString(), "The balance counts up to the confirmed figure");
                Assert.That(Offers("Try again"), Is.False);
                Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.text.Contains("has not confirmed")), Is.False);
                Assert.That(Asked("signTransactions"), Is.EqualTo(1)); Assert.That(Asked("sendTransaction"), Is.EqualTo(1));
                yield return null; yield return null;
                string[] timing; lock (lines) timing = lines.Where(line => line.StartsWith("zKube timing: action=purchase-kredits ")).ToArray();
                Assert.That(timing.Select(line => line.Split(' ')[3].Split('=')[0]), Is.EqualTo(new[] { "sent", "first-status", "settled", "shown" }), string.Join(" | ", lines));
            }
            finally { hold.Release(); ZKube.Integration.Transport.ClientLog.Sink = sink; }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Every read an Arena page waits on: with the read gone and no reason
        // shown for it, the page reads again by itself.
        [UnityTest] public IEnumerator APageWhoseReadIsAbsentReadsItWithoutATap()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            var pages = new (string Read, System.Func<Task> Open)[] {
                ("dailyRead", () => Adapter.OpenDaily()), ("kreditRead", () => Adapter.OpenKredits()), ("rewardRead", () => Adapter.OpenRewards()),
                ("sessionRead", () => Adapter.OpenSession()), ("profileRead", () => Adapter.OpenProfile()) };
            foreach (var page in pages)
            {
                yield return Wait(page.Open()); yield return Idle();
                Assert.That(Field(page.Read), Is.Not.Null, page.Read);
                Set(page.Read, null); Redraw(); yield return null;
                yield return Until(() => Field(page.Read) != null, page.Read + " is read again"); yield return Idle();
                Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.text.Contains("Checking")), Is.False, page.Read);
            }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
