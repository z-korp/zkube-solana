using System;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Integration.Execution;

namespace ZKube.Integration.App.Tests
{
    public sealed class MoneyAppLifecycleTests
    {
        private static TaskCompletionSource<bool> Signal() => new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        [TestCase(false)]
        [TestCase(true)]
        public async Task ThrowingCancellationStillCancelsBothReadsDrainsAndRunsRequiredCleanup(bool stop)
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); await e.ReadySession();
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending); e.Http.Confirmation = "processed";
            e.Http.ThrowOnCancellation = true; e.Http.DelayMethod = "getMultipleAccounts";
            e.Http.Entered = Signal(); e.Http.Release = Signal();
            var publicRead = e.Flow.RefreshPublic(); await e.Http.Entered.Task;
            e.Http.Entered = Signal(); e.Http.DelayMethod = "getSignatureStatuses";
            var ownerRead = e.Flow.RefreshOwner(); await e.Http.Entered.Task;
            var cleanup = stop ? e.Flow.StopAsync() : e.Flow.Disconnect();
            Assert.That(e.Http.CancellationCallbacks, Is.EqualTo(2), "A first throwing callback cannot skip cancellation of the other read");
            Assert.That(e.Flow.Public, Is.Null); Assert.That(e.Flow.Owner, Is.Null);
            Assert.That(cleanup.IsCompleted, Is.False, "The reporting error must wait for pending read/executor cleanup");
            if (!stop) Assert.That(e.Services.Identity.Owner, Is.Null, "Disconnect must invalidate identity despite callback failures");
            e.Http.Release.SetResult(true);
            await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await publicRead);
            await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await ownerRead);
            var error = await MoneyTestEnvironment.Fails<AggregateException>(() => cleanup);
            Assert.That(error.Flatten().InnerExceptions.Count(x => x.Message.StartsWith("Injected cancellation callback:")), Is.EqualTo(2));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Native.Seed, Is.Not.Null);
            Assert.That(e.Native.Calls, Is.EqualTo(stop ? 1 : 2), "Explicit disconnect still reaches the wallet bridge; Stop borrows it");
            if (stop)
            {
                foreach (string name in new[] { "publicReads", "ownerReads" })
                {
                    var resource = (SemaphoreSlim)typeof(MoneyAppFlow).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance).GetValue(e.Flow);
                    Assert.Throws<ObjectDisposedException>(() => _ = resource.AvailableWaitHandle, name);
                }
                var lifetime = (CancellationTokenSource)typeof(MoneyAppFlow).GetField("lifetime", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(e.Flow);
                Assert.Throws<ObjectDisposedException>(() => _ = lifetime.Token);
            }
            else await e.Flow.StopAsync();
            Assert.That(e.Native.Disposed || e.Http.Disposed || e.Store.Disposed, Is.False); e.AssertReadOnly();
        }
        [Test]
        public async Task DisconnectInvalidatesReadBeforeLateAuthorizationCanPublish()
        {
            var e = new MoneyTestEnvironment(); e.Native.Entered = Signal(); e.Native.Release = Signal();
            var connecting = e.Flow.Connect(e.Owner); await e.Native.Entered.Task;
            await e.Flow.Disconnect(); e.Native.Release.SetResult(true);
            await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await connecting);
            Assert.That(e.Services.Identity.Owner, Is.Null); Assert.That(e.Flow.Owner, Is.Null);
            await e.Flow.StopAsync();
        }
        [Test]
        public async Task NewPublicGenerationRejectsAnOldCallbackAndRetainedPublication()
        {
            var e = new MoneyTestEnvironment(); var retained = await e.Flow.RefreshPublic();
            e.Http.DelayMethod = "getMultipleAccounts"; e.Http.Entered = Signal(); e.Http.Release = Signal();
            var old = e.Flow.RefreshPublic(); await e.Http.Entered.Task;
            Assert.That(retained.IsCurrent, Is.False);
            var newer = e.Flow.RefreshPublic(); e.Http.Release.SetResult(true);
            await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await old);
            var current = await newer; Assert.That(current.IsCurrent, Is.True); Assert.That(e.Flow.Public, Is.SameAs(current));
            await e.Flow.StopAsync(); Assert.That(current.IsCurrent, Is.False);
            Assert.Throws<OperationCanceledException>(() => _ = current.Value);
        }
        [Test]
        public async Task AccountSwitchSuppressesOldOwnerReadWithoutDiscardingArcadeMarker()
        {
            var e = new MoneyTestEnvironment(); e.UseDailyRun(); await e.Flow.Connect(e.Owner);
            var retained = await e.Flow.RefreshOwner();
            var daily = await e.Services.RunMarkers.Load(e.Owner);
            e.Http.DelayMethod = "getAccountInfo"; e.Http.Entered = Signal(); e.Http.Release = Signal();
            var old = e.Flow.RefreshOwner(); await e.Http.Entered.Task; await e.Flow.Disconnect();
            e.Native.Owner = (string)e.Plans["inputs"]["device"]; var next = await e.Flow.Connect(e.Native.Owner);
            e.Http.Release.SetResult(true); await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await old);
            Assert.That(next.Value, Is.EqualTo(e.Native.Owner)); Assert.That(retained.IsCurrent, Is.False); Assert.That(e.Flow.Owner, Is.Null);
            Assert.That((await e.Services.RunMarkers.Load(e.Owner)).ActiveRun, Is.EqualTo(daily.ActiveRun));
            await e.Flow.StopAsync();
        }
        [Test]
        public async Task DisconnectWhileReconciliationIsDelayedPreservesTheJournalAndKey()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner); await e.ReadySession();
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending); e.Http.Confirmation = "processed";
            e.Http.DelayMethod = "getSignatureStatuses"; e.Http.Entered = Signal(); e.Http.Release = Signal();
            var read = e.Flow.RefreshOwner(); await e.Http.Entered.Task;
            var disconnect = e.Flow.Disconnect(); Assert.That(e.Flow.Owner, Is.Null); Assert.That(e.Services.Identity.Owner, Is.Null);
            e.Http.Release.SetResult(true); await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await read); await disconnect;
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            Assert.That(e.Native.Seed, Is.Not.Null); e.AssertReadOnly(); await e.Flow.StopAsync();
        }
        [Test]
        public async Task StopDrainsOutstandingReadsRejectsNewWorkAndBorrowsAllPlatformDependencies()
        {
            var e = new MoneyTestEnvironment(); e.Http.DelayMethod = "getMultipleAccounts"; e.Http.Entered = Signal(); e.Http.Release = Signal();
            var read = e.Flow.RefreshPublic(); await e.Http.Entered.Task;
            var stop = e.Flow.StopAsync(); Assert.That(stop.IsCompleted, Is.False); Assert.That(e.Flow.StopAsync(), Is.SameAs(stop));
            Assert.Throws<ObjectDisposedException>(() => e.Flow.RefreshPublic());
            e.Http.Release.SetResult(true); await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await read); await stop;
            Assert.That(e.Http.Disposed || e.Native.Disposed || e.Store.Disposed, Is.False); Assert.That(e.Flow.Public, Is.Null);
        }
        [Test]
        public async Task StopWaitsForAnUncancelableNativeAuthorizationWithoutPublishingItsOwner()
        {
            var e = new MoneyTestEnvironment(); e.Native.Entered = Signal(); e.Native.Release = Signal();
            var connecting = e.Flow.Connect(e.Owner); await e.Native.Entered.Task;
            var stop = e.Flow.StopAsync(); Assert.That(stop.IsCompleted, Is.False);
            e.Native.Release.SetResult(true); await MoneyTestEnvironment.Fails<OperationCanceledException>(async () => await connecting); await stop;
            Assert.That(e.Flow.Owner, Is.Null); Assert.That(e.Native.Disposed, Is.False);
            // Stop detaches the host. Only explicit Disconnect changes wallet
            // authorization; the platform still owns the borrowed native bridge.
            Assert.That(e.Services.Identity.Owner, Is.EqualTo(e.Owner)); Assert.That(e.Native.Calls, Is.EqualTo(1));
        }
        [Test]
        public async Task ExplicitResumeExposesBusyAndNoPendingWithoutClearingAnExistingIntent()
        {
            var e = new MoneyTestEnvironment(); await e.Flow.Connect(e.Owner);
            Assert.That((await e.Flow.ResumePending()).Value.Code, Is.EqualTo("no-pending-transaction"));
            var pending = e.Purchase(); await e.Services.Journal.Begin(pending);
            var entered = Signal(); var release = Signal();
            var holder = e.Services.Executor.WithIdle(async () => { entered.SetResult(true); await release.Task; }); await entered.Task;
            var busy = (await e.Flow.ResumePending()).Value;
            Assert.That(busy.Outcome, Is.EqualTo(ExecutionOutcome.Rejected)); Assert.That(busy.Code, Is.EqualTo("execution-busy"));
            Assert.That((await e.Services.Journal.Load(e.Owner)).Signature, Is.EqualTo(pending.Signature));
            release.SetResult(true); await holder; e.AssertReadOnly(); await e.Flow.StopAsync();
        }
    }
}
