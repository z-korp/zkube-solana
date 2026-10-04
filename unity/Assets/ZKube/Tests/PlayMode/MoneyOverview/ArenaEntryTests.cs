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
            Assert.That(Offers("Resume Daily"), Is.True);
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
            Assert.That(Offers("Connect"), Is.False); Assert.That(Offers("Resume Daily"), Is.True);
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
            Assert.That(Offers("Resume Daily"), Is.True);

            Set("dailyRead", null); Set("failure", "Could not refresh. Try again."); Redraw(); yield return Idle(); Home("failed read");
            Assert.That(Text("Daily headline"), Is.EqualTo("Not loaded"));
            Assert.That(Offers("Play Campaign"), Is.True);
            Click("Try again"); yield return Idle(); Home("read again");
            Assert.That(Offers("Resume Daily"), Is.True);
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
                StringAssert.StartsWith("zKube request failed: action=session-renew kind=Busy service=Solana host=base.invalid call=getLatestBlockhash status=429", lines[0]);
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
                Assert.That(Offers("Resume Daily"), Is.True);
            }
            finally { ZKube.Integration.Transport.ClientLog.Sink = sink; }
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
