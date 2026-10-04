using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Integration;
using ZKube.Integration.Android;
using ZKube.Integration.Transport;

namespace ZKube.Tests.MoneyOverview
{
    // The boundary to the Android plugin. JNI finds the application's classes
    // only on the application thread, and the executor asks for the owner's
    // signature from a pool thread: on a phone that request built its Java
    // callback there and failed as a bare null pointer before any wallet opened.
    public sealed class PluginBoundaryTests
    {
        private const string Owner = "11111111111111111111111111111111";
        private sealed class Plugin : IAndroidPlugin
        {
            public readonly List<(string Member, int Thread)> Calls = new List<(string, int)>();
            public Exception Failure;
            public Action<string> Complete;
            private void Note(string member)
            {
                lock (Calls) Calls.Add((member, Thread.CurrentThread.ManagedThreadId));
                if (Failure != null) throw Failure;
            }
            public void Start(string requestJson, Action<string> complete) { Note("start"); Complete = complete; }
            public string LoadDeviceSeed(bool create) { Note("loadDeviceSeed"); return Convert.ToBase64String(new byte[32]); }
            public string SavedOwner() { Note("savedOwner"); return null; }
            public string Read(string key, string field) { Note("read"); return "value"; }
            public bool CompareExchange(string key, string field, string expected, string value) { Note("compareExchange"); return true; }
        }
        private static IEnumerator Settled(Task task)
        {
            float limit = Time.realtimeSinceStartup + 15;
            while (!task.IsCompleted && Time.realtimeSinceStartup < limit) yield return null;
            Assert.That(task.IsCompleted, Is.True, "The plugin call did not finish");
        }

        [UnityTest] public IEnumerator EveryPluginCallIsMadeOnTheApplicationThreadWhicheverThreadAsked()
        {
            int main = Thread.CurrentThread.ManagedThreadId; var plugin = new Plugin(); var transport = new AndroidWalletTransport(plugin);
            Task<string> request = null; int asker = main;
            var asked = Task.Run(async () => {
                asker = Thread.CurrentThread.ManagedThreadId;
                request = transport.Request("{\"operation\":\"signTransactions\"}");
                await transport.LoadDeviceSeed(true).ConfigureAwait(false);
                await transport.LoadAuthorizedOwner().ConfigureAwait(false);
                await transport.Read(Owner, "field").ConfigureAwait(false);
                await transport.CompareExchange(Owner, "field", null, "value").ConfigureAwait(false);
            });
            yield return Settled(asked);
            Assert.That(asked.IsFaulted, Is.False, asked.Exception?.ToString());
            Assert.That(asker, Is.Not.EqualTo(main), "The request came from a pool thread, as the executor's does");
            Assert.That(plugin.Calls.Select(call => call.Member), Is.EqualTo(new[] { "start", "loadDeviceSeed", "savedOwner", "read", "compareExchange" }));
            Assert.That(plugin.Calls.Select(call => call.Thread), Is.All.EqualTo(main), "Every Java object is made on the application thread");
            // One wallet request at a time; the wallet answers from its own thread.
            Assert.That(() => transport.Request("{}"), Throws.InstanceOf<WalletRequestException>().With.Property("Code").EqualTo("wallet-busy"));
            Assert.That(request.IsCompleted, Is.False);
            var answered = Task.Run(() => plugin.Complete("{\"ok\":true}")); yield return Settled(answered); yield return Settled(request);
            Assert.That(request.Result, Is.EqualTo("{\"ok\":true}"));
        }

        [UnityTest] public IEnumerator APluginCallThatFailsNamesTheJavaMemberInTheLog()
        {
            var plugin = new Plugin { Failure = new Exception("JNI: Init'd AndroidJavaObject with null ptr!") };
            var transport = new AndroidWalletTransport(plugin);
            var calls = new (string Member, Func<Task> Ask)[] {
                ("UnityWalletBridge.start", () => transport.Request("{}")),
                ("UnityWalletBridge.loadDeviceSeed", () => transport.LoadDeviceSeed(true)),
                ("UnityWalletBridge.savedOwner", () => transport.LoadAuthorizedOwner()),
                ("ClientStore.read", () => transport.Read(Owner, "field")),
                ("ClientStore.compareExchange", () => transport.CompareExchange(Owner, "field", null, "value")) };
            foreach (var call in calls)
            {
                var asked = Task.Run(call.Ask); yield return Settled(asked);
                Assert.That(asked.IsFaulted, Is.True, call.Member);
                var error = asked.Exception.InnerException as PluginCallException;
                Assert.That(error, Is.Not.Null, call.Member + ": " + asked.Exception.InnerException);
                Assert.That(error.Member, Is.EqualTo(call.Member));
                var failure = RequestFailure.Of(error);
                Assert.That(failure.Kind, Is.EqualTo(FailureKind.Local));
                Assert.That(failure.Line("session-renew"), Is.EqualTo("zKube request failed: action=session-renew kind=Local type=PluginCallException>Exception message=\"" +
                    "Android plugin call " + call.Member + " failed: Exception: JNI: Init'd AndroidJavaObject with null ptr!\""));
            }
            // A failed request leaves the wallet free for the next one.
            plugin.Failure = null;
            var next = transport.Request("{}"); yield return null;
            Assert.That(plugin.Complete, Is.Not.Null);
            plugin.Complete("{}"); yield return Settled(next);
            Assert.That(next.Result, Is.EqualTo("{}"));
        }
    }
}
