using System;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration.Client;

namespace ZKube.Integration.Tests
{
    public sealed class ClientIdentityTests
    {
        private sealed class Native : INativeWalletTransport
        {
            public string Owner;
            public TaskCompletionSource<bool> Hold;
            public TaskCompletionSource<bool> Started = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            public int Disconnects;
            public bool RejectDisconnect;
            public async Task<string> Request(string json)
            {
                var request = JObject.Parse(json); string operation = (string)request["operation"];
                if (operation == "disconnect")
                {
                    Disconnects++;
                    if (RejectDisconnect) return new JObject { ["requestId"] = request["requestId"], ["ok"] = false, ["error"] = "wallet-rejected" }.ToString();
                }
                else { Started.TrySetResult(true); if (Hold != null) await Hold.Task; }
                return new JObject { ["requestId"] = request["requestId"], ["ok"] = true,
                    ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(Owner)) }.ToString();
            }
            public Task<byte[]> LoadDeviceSeed(bool create) => Task.FromResult<byte[]>(null);
        }
        [Test]
        public async Task DisconnectDuringAuthorizationRejectsLateSuccessAndAllowsExplicitOtherOwner()
        {
            using var first = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            using var second = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            var native = new Native { Owner = first.Address, Hold = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously) };
            var identity = new ClientIdentity(new WalletClient(native));
            var connect = identity.Connect(first.Address);
            await native.Started.Task; await identity.Disconnect();
            native.Hold.SetResult(true);
            await AsyncAssert.Throws<OperationCanceledException>(async () => await connect);
            Assert.That(identity.Owner, Is.Null); Assert.That(native.Disconnects, Is.EqualTo(1));
            native.Hold = null; native.Owner = second.Address;
            Assert.That(await identity.Connect(second.Address), Is.EqualTo(second.Address));
        }
        [Test]
        public async Task DisconnectCancelsLeasesOutsideLockAndOldConfirmationCannotPublishToAnotherOwner()
        {
            using var first = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            using var second = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            var native = new Native { Owner = first.Address }; var identity = new ClientIdentity(new WalletClient(native));
            await identity.Connect(); var lease = identity.Lease();
            bool callback = false;
            using var registration = lease.Cancellation.Register(() =>
            {
                // Another thread taking the identity lock must complete while this
                // callback runs; this would deadlock if Cancel held that lock.
                var read = Task.Run(() => identity.IsCurrent(lease));
                if (!read.Wait(TimeSpan.FromSeconds(2))) throw new InvalidOperationException("Identity lock held during cancellation");
                callback = true;
            });
            var confirmation = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            string published = null;
            async Task Observe() { await confirmation.Task; if (identity.IsCurrent(lease)) published = lease.Owner; }
            var observing = Observe();
            await identity.Disconnect(); native.Owner = second.Address; await identity.Connect(second.Address);
            confirmation.SetResult(true); await observing;
            Assert.That(callback, Is.True); Assert.That(lease.Cancellation.IsCancellationRequested, Is.True);
            Assert.That(published, Is.Null); Assert.That(identity.Owner, Is.EqualTo(second.Address));
        }
        [Test]
        public async Task ThrowingCancellationSubscriberCannotSkipWalletAndDeviceCleanup()
        {
            using var owner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            var native = new Native { Owner = owner.Address }; var identity = new ClientIdentity(new WalletClient(native));
            await identity.Connect(); var lease = identity.Lease(); bool cleaned = false;
            using var registration = lease.Cancellation.Register(() => throw new InvalidOperationException("Synthetic subscriber failure"));
            await AsyncAssert.Throws<AggregateException>(() => identity.Disconnect(previous => { Assert.That(previous, Is.EqualTo(owner.Address)); cleaned = true; return Task.CompletedTask; }));
            Assert.That(identity.Owner, Is.Null); Assert.That(cleaned, Is.True); Assert.That(native.Disconnects, Is.EqualTo(1));
            Assert.That(await identity.Connect(), Is.EqualTo(owner.Address));
        }
        [Test]
        public async Task RejectedExternalDisconnectStillRunsLocalCleanupAndRetainsTheFailure()
        {
            using var owner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            var native = new Native { Owner = owner.Address, RejectDisconnect = true }; var identity = new ClientIdentity(new WalletClient(native));
            await identity.Connect(); bool cleaned = false;
            var error = await AsyncAssert.Throws<WalletRequestException>(() => identity.Disconnect(previous => { cleaned = true; return Task.CompletedTask; }));
            Assert.That(error.Code, Is.EqualTo("wallet-rejected")); Assert.That(cleaned, Is.True); Assert.That(identity.Owner, Is.Null);
            Assert.That(await identity.Connect(), Is.EqualTo(owner.Address));
        }
    }
}
