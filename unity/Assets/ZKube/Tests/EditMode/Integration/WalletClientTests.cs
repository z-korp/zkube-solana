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
            public int Calls, Creates;
            public async Task<string> Request(string json)
            {
                Calls++;
                var request = JObject.Parse(json);
                var reply = await Reply(request);
                reply["requestId"] ??= request["requestId"];
                reply["ok"] ??= true;
                return reply.ToString();
            }
            public Task<byte[]> LoadDeviceSeed(string owner) => Task.FromResult<byte[]>(null);
            public Task<byte[]> CreateDeviceSeed(string owner) { Creates++; return Task.FromResult(Enumerable.Repeat((byte)2, 32).ToArray()); }
            public Task RemoveDeviceSeed(string owner) => Task.CompletedTask;
        }
        private static JObject Fixture() => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../fixtures/unity-solana-v1.json"))));
        [Test]
        public void BothWireFormatsProduceExactWeb3SignedTransactionsAndRejectUnsignedPackets()
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
        public async Task ActualDeviceSignaturesMatchWeb3BeforeOwnerWalletAndAllAdversarialResponsesFail()
        {
            var fixture = Fixture();
            string owner = (string)fixture["inputs"]["owner"];
            byte[] seed = Enumerable.Repeat((byte)2, 32).ToArray();
            using var signer = new DeviceSigner(seed);
            foreach (var row in fixture["walletCases"])
            {
                byte[] before = Convert.FromBase64String((string)row["before"]);
                var native = new Native { Reply = request => Task.FromResult(new JObject {
                    ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = row["output"] }) };
                var wallet = new WalletClient(native);
                if (!(bool)row["accept"])
                {
                    await AsyncAssert.Throws<FormatException>(async () => await wallet.Sign(owner, before), (string)row["id"]);
                    if (((string)row["id"]).EndsWith("before-wallet", StringComparison.Ordinal)) Assert.That(native.Calls, Is.Zero);
                }
                else
                {
                    Assert.That(signer.PartialSign(before), Is.EqualTo(before));
                    var signed = await wallet.Sign(owner, before);
                    Assert.That(signed, Is.EqualTo(Convert.FromBase64String((string)row["output"])));
                    Assert.That(TransactionSignatures.ValidateFullySigned(signed), Is.EqualTo((string)fixture["walletSignature"]));
                    TransactionSignatures.ValidateSignature((string)fixture["walletSignature"]);
                }
            }
            signer.Dispose();
            Assert.Throws<ObjectDisposedException>(() => signer.PartialSign(new byte[1]));
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
