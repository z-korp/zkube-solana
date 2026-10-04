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
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("solana");
        [Test]
        public async Task OneInstallKeyIsReusedAcrossWalletsAndRestarts()
        {
            var fixture = Fixture(); var native = new TestNative { AllowCreation = () => true };
            string owner = (string)fixture["inputs"]["owner"], other = (string)fixture["inputs"]["device"];
            using var first = await new WalletClient(native).LoadDeviceSigner(owner, create: true);
            using var second = await new WalletClient(native).LoadDeviceSigner(other, create: true);
            using var restored = await new WalletClient(native).LoadDeviceSigner(owner);
            Assert.That(first.Address, Is.EqualTo(second.Address));
            Assert.That(first.Address, Is.EqualTo(restored.Address));
            Assert.That(native.Creations, Is.EqualTo(1));
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
            var native = new TestNative { Reply = _ => Task.FromResult(new JObject {
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
        // The rule is unchanged: any other message is refused. What the wallet
        // changed travels with the refusal as counts, program IDs and yes/no facts.
        [Test]
        public async Task AChangedMessageIsRefusedWithASafeAccountOfWhatChanged()
        {
            const string system = "11111111111111111111111111111111", budget = "ComputeBudget111111111111111111111111111111",
                added = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", blockhash = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
            using var payer = new DeviceSigner(Enumerable.Repeat((byte)3, 32).ToArray()); using var other = new DeviceSigner(Enumerable.Repeat((byte)4, 32).ToArray());
            string owner = payer.Address, receiver = other.Address;
            SolanaInstruction Budget(byte kind, byte value) => new SolanaInstruction(budget, Array.Empty<AccountMeta>(), new byte[] { kind, value, 0, 0, 0 });
            var transfer = new SolanaInstruction(system, new[] { new AccountMeta(owner, true, true), new AccountMeta(receiver, false, true) },
                new byte[] { 2, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0 });
            byte[] Message(string hash, params SolanaInstruction[] instructions) => SolanaWire.UnsignedTransaction(SolanaWire.CompileMessage(owner, hash, instructions, true));
            byte[] before = Message(blockhash, Budget(2, 1), Budget(3, 1), transfer);
            var native = new TestNative();
            var wallet = new WalletClient(native);
            async Task<string> Changed(byte[] returned)
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = Convert.ToBase64String(returned) });
                var refused = await AsyncAssert.Throws<WalletChangedMessageException>(() => wallet.Sign(owner, before));
                Assert.That(refused.Message, Is.EqualTo("Wallet changed the message"));
                foreach (string key in new[] { owner, receiver, blockhash }) StringAssert.DoesNotContain(key, refused.Summary);
                return refused.Summary;
            }
            // A priority fee rewritten in place and an instruction of another program appended.
            Assert.That(await Changed(Message(blockhash, Budget(2, 1), Budget(3, 7), transfer, new SolanaInstruction(added, Array.Empty<AccountMeta>(), new byte[] { 1 }))),
                Is.EqualTo("instructions 3 to 4; added " + added + "; removed none; rewritten in place 1; fee payer same; blockhash same; signers same; accounts changed (4 to 5); version same"));
            // Its own budget instructions dropped and another blockhash.
            Assert.That(await Changed(Message(system, transfer)),
                Is.EqualTo("instructions 3 to 1; added none; removed " + budget + " x2; rewritten in place 0; fee payer same; blockhash changed; signers same; accounts changed (4 to 3); version same"));
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
            var native = new TestNative { Reply = _ => Task.FromResult(new JObject {
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
            var native = new TestNative { Reply = _ => response.Task };
            var wallet = new WalletClient(native);
            Assert.That(await wallet.LoadDeviceSigner(owner), Is.Null);
            Assert.That(native.Creations, Is.Zero);
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
