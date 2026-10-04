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
            Assert.That(Text("Daily headline"), Is.EqualTo("No connection"));
            Assert.That(Offers("Play Campaign"), Is.True);
            Click("Try again"); yield return Idle(); Home("read again");
            Assert.That(Offers("Resume Daily"), Is.True);
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
