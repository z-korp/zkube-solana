using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Integration.Tests
{
    public sealed class WalletClientTests
    {
        private sealed class Native : INativeWalletTransport
        {
            public Func<JObject, Task<JObject>> Reply;
            public int Calls, Creates; public byte[] Seed;
            public async Task<string> Request(string json)
            {
                Calls++;
                var request = JObject.Parse(json);
                var reply = await Reply(request);
                reply["requestId"] ??= request["requestId"];
                reply["ok"] ??= true;
                return reply.ToString();
            }
            public Task<byte[]> LoadDeviceSeed(bool create)
            {
                if (create && Seed == null) { Seed = Enumerable.Repeat((byte)2, 32).ToArray(); Creates++; }
                return Task.FromResult(Seed?.ToArray());
            }
        }
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("solana");
        [Test]
        public async Task OneInstallKeyIsReusedAcrossWalletsAndRestarts()
        {
            var fixture = Fixture(); var native = new Native();
            string owner = (string)fixture["inputs"]["owner"], other = (string)fixture["inputs"]["device"];
            using var first = await new WalletClient(native).LoadDeviceSigner(owner, create: true);
            using var second = await new WalletClient(native).LoadDeviceSigner(other, create: true);
            using var restored = await new WalletClient(native).LoadDeviceSigner(owner);
            Assert.That(first.Address, Is.EqualTo(second.Address));
            Assert.That(first.Address, Is.EqualTo(restored.Address));
            Assert.That(native.Creates, Is.EqualTo(1));
            Assert.That(native.Calls, Is.Zero);
        }
        [Test]
        public void RustMessagesAcceptSyntheticSignaturesAndRejectUnsignedPackets()
        {
            var fixture = Fixture();
            using var owner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            using var device = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            foreach (var row in fixture["transactions"])
            {
                byte[] bytes = SolanaWire.UnsignedTransaction(Convert.FromBase64String((string)row["message"]));
                Assert.Throws<FormatException>(() => TransactionSignatures.ValidateFullySigned(bytes));
                foreach (string signer in row["signers"].Values<string>()) bytes = (signer == owner.Address ? owner : device).PartialSign(bytes);
                Assert.That(bytes, Is.EqualTo(Convert.FromBase64String((string)row["signedTransaction"])), (string)row["id"]);
                Assert.That(TransactionSignatures.ValidateFullySigned(bytes), Is.EqualTo((string)row["signature"]));
                Assert.That(TransactionSignatures.ReadBlockhash(bytes), Is.EqualTo((string)row["blockhash"]));
            }
        }
        [Test]
        public async Task OwnerWalletRejectsChangedMessagesAndMissingSignatures()
        {
            var fixture = Fixture();
            string owner = (string)fixture["inputs"]["owner"];
            var rows = fixture["transactions"].ToArray();
            byte[] before = SolanaWire.UnsignedTransaction(Convert.FromBase64String((string)rows[0]["message"]));
            var native = new Native { Reply = _ => Task.FromResult(new JObject {
                ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = rows[0]["signedTransaction"] }) };
            var wallet = new WalletClient(native);
            Assert.That(await wallet.Sign(owner, before), Is.EqualTo(Convert.FromBase64String((string)rows[0]["signedTransaction"])));
            foreach (string output in new[] { (string)rows[1]["signedTransaction"], Convert.ToBase64String(before) })
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = output });
                await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner, before));
            }
            using var disposed = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            disposed.Dispose();
            Assert.Throws<ObjectDisposedException>(() => disposed.PartialSign(new byte[1]));
        }
        [Test]
        public async Task DevicePartialSignatureSurvivesOwnerApprovalAndMissingOrChangedSignaturesFail()
        {
            var fixture = Fixture();
            var row = fixture["transactions"].Single(value => (string)value["id"] == "session-refill-0");
            using var owner = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray());
            using var device = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            byte[] unsigned = SolanaWire.UnsignedTransaction(Convert.FromBase64String((string)row["message"]));
            byte[] before = device.PartialSign(unsigned), signed = owner.PartialSign(before);
            var native = new Native { Reply = _ => Task.FromResult(new JObject {
                ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner.Address)), ["transaction"] = Convert.ToBase64String(signed) }) };
            var wallet = new WalletClient(native);
            Assert.That(await wallet.Sign(owner.Address, before), Is.EqualTo(signed));
            Assert.That(device.PartialSign(before), Is.EqualTo(before));
            var corrupted = signed.ToArray();
            int deviceIndex = Array.IndexOf(row["signers"].Values<string>().ToArray(), device.Address);
            corrupted[1 + 64 * deviceIndex] ^= 1;
            foreach (byte[] output in new[] { owner.PartialSign(unsigned), before, corrupted })
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner.Address)),
                    ["transaction"] = Convert.ToBase64String(output) });
                await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner.Address, before));
            }
            int calls = native.Calls;
            await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner.Address, unsigned));
            Assert.That(native.Calls, Is.EqualTo(calls));
        }

        [Test]
        public async Task MissingSecretNeverCreatesReplacementAndAuthorizationSerializesAndPinsIdentity()
        {
            var fixture = Fixture();
            string owner = (string)fixture["inputs"]["owner"], device = (string)fixture["inputs"]["device"];
            var response = new TaskCompletionSource<JObject>();
            var native = new Native { Reply = _ => response.Task };
            var wallet = new WalletClient(native);
            Assert.That(await wallet.LoadDeviceSigner(owner), Is.Null);
            Assert.That(native.Creates, Is.Zero);
            var first = wallet.Authorize(owner);
            await AsyncAssert.Throws<WalletRequestException>(async () => await wallet.Authorize(owner));
            response.SetResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(device)) });
            await AsyncAssert.Throws<WalletRequestException>(async () => await first);
            native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)) });
            Assert.That(await wallet.Authorize(owner), Is.EqualTo(owner));
            native.Reply = _ => Task.FromResult(new JObject { ["requestId"] = "wrong", ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)) });
            await AsyncAssert.Throws<FormatException>(async () => await wallet.Authorize(owner));
        }
    }
}
