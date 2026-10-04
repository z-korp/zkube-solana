using System.Collections;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Integration.Presentation;

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
