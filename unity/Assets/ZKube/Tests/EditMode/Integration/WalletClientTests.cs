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
            // The purchase reaches the wallet already signed by the install key.
            using var ownerKey = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray()); using var install = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            byte[] before = install.PartialSign(SolanaWire.UnsignedTransaction(Convert.FromBase64String((string)rows[0]["message"])));
            byte[] signed = Convert.FromBase64String((string)rows[0]["signedTransaction"]);
            var native = new TestNative { Reply = _ => Task.FromResult(new JObject {
                ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = rows[0]["signedTransaction"] }) };
            var wallet = new WalletClient(native);
            Assert.That(await wallet.Sign(owner, before), Is.EqualTo(signed));
            foreach (string output in new[] { (string)rows[1]["signedTransaction"], Convert.ToBase64String(before) })
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = output });
                await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner, before));
            }
            // Every way a wallet can return something else is refused: another
            // message, however it differs and however well it is signed, or the
            // same message with the install signature gone or altered, or without
            // the owner's own signature over those exact bytes.
            var purchase = TransactionSignatures.Describe(before); string blockhash = TransactionSignatures.ReadBlockhash(before);
            var given = purchase.Instructions.ToArray(); var buy = given[given.Length - 1]; var metas = buy.Accounts.ToArray();
            SolanaInstruction Budget(byte kind) => new SolanaInstruction("ComputeBudget111111111111111111111111111111", Array.Empty<AccountMeta>(), new byte[] { kind, 9, 0, 0, 0 });
            SolanaInstruction Buy(AccountMeta[] accounts, byte[] data = null) => new SolanaInstruction(buy.ProgramId, accounts, data ?? buy.Data);
            byte[] Signed(string payer, string hash, params SolanaInstruction[] instructions)
            {
                var bytes = SolanaWire.UnsignedTransaction(SolanaWire.CompileMessage(payer, hash, instructions, true));
                var signers = TransactionSignatures.Describe(bytes).Accounts.Where(account => account.Signer).Select(account => account.Address).ToArray();
                if (signers.Contains(install.Address)) bytes = install.PartialSign(bytes);
                return signers.Contains(owner) ? ownerKey.PartialSign(bytes) : bytes;
            }
            SolanaInstruction[] With(SolanaInstruction last) => given.Take(given.Length - 1).Append(last).ToArray();
            var otherData = buy.Data; otherData[otherData.Length - 1] ^= 1;
            var swapped = metas.ToArray(); (swapped[0], swapped[1]) = (swapped[1], swapped[0]);
            var widened = metas.ToArray(); int readOnly = Array.FindIndex(widened, meta => !meta.Writable && !meta.Signer);
            widened[readOnly] = new AccountMeta(widened[readOnly].Address, false, true);
            var changedMessages = new (string What, byte[] Returned)[] {
                ("a compute budget instruction appended", Signed(owner, blockhash, given.Append(Budget(1)).ToArray())),
                ("an instruction of another program appended", Signed(owner, blockhash, given.Append(
                    new SolanaInstruction("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", Array.Empty<AccountMeta>(), new byte[] { 1 })).ToArray())),
                ("the compute price rewritten", Signed(owner, blockhash, new[] { given[0], Budget(3) }.Concat(given.Skip(2)).ToArray())),
                ("another blockhash", Signed(owner, "11111111111111111111111111111111", given)),
                ("another fee payer", Signed(install.Address, blockhash, given)),
                ("the accounts in another order", Signed(owner, blockhash, With(Buy(swapped)))),
                ("other instruction data", Signed(owner, blockhash, With(Buy(metas, otherData)))),
                ("a wider account privilege", Signed(owner, blockhash, With(Buy(widened)))),
                ("the install signer removed", Signed(owner, blockhash, With(Buy(metas.Take(metas.Length - 1).ToArray())))) };
            foreach (var change in changedMessages)
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = Convert.ToBase64String(change.Returned) });
                await AsyncAssert.Throws<WalletChangedMessageException>(() => wallet.Sign(owner, before), change.What);
            }
            int installSlot = Array.IndexOf(rows[0]["signers"].Values<string>().ToArray(), install.Address), ownerSlot = 1 - installSlot;
            byte[] Slot(int slot, Func<byte, byte> change) { var bytes = signed.ToArray(); for (int i = 0; i < 64; i++) bytes[1 + 64 * slot + i] = change(bytes[1 + 64 * slot + i]); return bytes; }
            foreach (var bytes in new[] { Slot(installSlot, _ => 0), Slot(installSlot, value => (byte)(value ^ 1)), Slot(ownerSlot, _ => 0), Slot(ownerSlot, value => (byte)(value ^ 1)) })
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = Convert.ToBase64String(bytes) });
                var refused = await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner, before));
                Assert.That(refused, Is.Not.InstanceOf<WalletChangedMessageException>());
            }
            // A wallet that answers for another address is not this owner's.
            native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(install.Address)), ["transaction"] = rows[0]["signedTransaction"] });
            Assert.That((await AsyncAssert.Throws<WalletRequestException>(() => wallet.Sign(owner, before))).Code, Is.EqualTo("account-changed"));
            using var disposed = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            disposed.Dispose();
            Assert.Throws<ObjectDisposedException>(() => disposed.PartialSign(new byte[1]));
        }
        // The wallet is never handed a message nothing else has signed. A payload
        // with the owner as its only signer, with the install key's slot empty, with
        // another key's signature in it, or one a disposed key cannot sign, is
        // refused before any native request.
        [Test]
        public async Task OwnerWalletRequiresAnInstallSignatureBeforeNativeApproval()
        {
            const string system = "11111111111111111111111111111111", blockhash = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
            using var ownerKey = new DeviceSigner(Enumerable.Repeat((byte)1, 32).ToArray()); using var install = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray());
            using var stranger = new DeviceSigner(Enumerable.Repeat((byte)3, 32).ToArray());
            string owner = ownerKey.Address;
            var native = new TestNative { Reply = _ => throw new InvalidOperationException("The wallet must not be asked") };
            var wallet = new WalletClient(native);
            SolanaInstruction Transfer(params AccountMeta[] extra) => new SolanaInstruction(system,
                new[] { new AccountMeta(owner, true, true), new AccountMeta(stranger.Address, false, true) }.Concat(extra), new byte[] { 2, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0 });
            byte[] Unsigned(params AccountMeta[] extra) => SolanaWire.UnsignedTransaction(SolanaWire.CompileMessage(owner, blockhash, new[] { Transfer(extra) }, true));
            var ownerOnly = Unsigned();
            Assert.That((await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner, ownerOnly))).Message, Is.EqualTo("Owner-wallet payload carries no install signature"));
            var slotEmpty = Unsigned(new AccountMeta(install.Address, true, false));
            Assert.That((await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner, slotEmpty))).Message, Is.EqualTo("Missing or invalid nonowner partial signature"));
            // Another key's signature copied into the install key's slot.
            var foreign = slotEmpty.ToArray(); var signedElsewhere = stranger.PartialSign(Unsigned(new AccountMeta(stranger.Address, true, false)));
            int slot = Array.IndexOf(TransactionSignatures.Describe(slotEmpty).Accounts.Where(account => account.Signer).Select(account => account.Address).ToArray(), install.Address);
            Array.Copy(signedElsewhere, 1 + 64 * slot, foreign, 1 + 64 * slot, 64);
            await AsyncAssert.Throws<FormatException>(() => wallet.Sign(owner, foreign));
            using (var gone = new DeviceSigner(Enumerable.Repeat((byte)2, 32).ToArray()))
            {
                gone.Dispose();
                Assert.Throws<ObjectDisposedException>(() => gone.PartialSign(slotEmpty));
            }
            Assert.That(native.Calls, Is.Zero, "Nothing reached the wallet");
            // Signed by the install key, the same payload is asked of the wallet.
            var presigned = install.PartialSign(slotEmpty); var both = ownerKey.PartialSign(presigned);
            native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = Convert.ToBase64String(both) });
            Assert.That(await wallet.Sign(owner, presigned), Is.EqualTo(both));
            Assert.That(native.Calls, Is.EqualTo(1));
        }
        // The rule is unchanged: any other message is refused. What the wallet
        // changed travels with the refusal as counts, program IDs and yes/no facts.
        [Test]
        public async Task AChangedMessageIsRefusedWithASafeAccountOfWhatChanged()
        {
            const string system = "11111111111111111111111111111111", budget = "ComputeBudget111111111111111111111111111111",
                added = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95", blockhash = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
            using var payer = new DeviceSigner(Enumerable.Repeat((byte)3, 32).ToArray()); using var other = new DeviceSigner(Enumerable.Repeat((byte)4, 32).ToArray());
            using var install = new DeviceSigner(Enumerable.Repeat((byte)5, 32).ToArray());
            string owner = payer.Address, receiver = other.Address;
            SolanaInstruction Budget(byte kind, byte value) => new SolanaInstruction(budget, Array.Empty<AccountMeta>(), new byte[] { kind, value, 0, 0, 0 });
            var transfer = new SolanaInstruction(system, new[] { new AccountMeta(owner, true, true), new AccountMeta(receiver, false, true),
                new AccountMeta(install.Address, true, false) }, new byte[] { 2, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0 });
            byte[] Message(string hash, params SolanaInstruction[] instructions) => SolanaWire.UnsignedTransaction(SolanaWire.CompileMessage(owner, hash, instructions, true));
            byte[] before = install.PartialSign(Message(blockhash, Budget(2, 1), Budget(3, 1), transfer));
            var native = new TestNative();
            var wallet = new WalletClient(native);
            async Task<string> Changed(byte[] returned)
            {
                native.Reply = _ => Task.FromResult(new JObject { ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner)), ["transaction"] = Convert.ToBase64String(returned) });
                var refused = await AsyncAssert.Throws<WalletChangedMessageException>(() => wallet.Sign(owner, before));
                Assert.That(refused.Message, Is.EqualTo("Wallet changed the message"));
                foreach (string key in new[] { owner, receiver, install.Address, blockhash }) StringAssert.DoesNotContain(key, refused.Summary);
                return refused.Summary;
            }
            // A priority fee rewritten in place and an instruction of another program appended.
            Assert.That(await Changed(Message(blockhash, Budget(2, 1), Budget(3, 7), transfer, new SolanaInstruction(added, Array.Empty<AccountMeta>(), new byte[] { 1 }))),
                Is.EqualTo("instructions 3 to 4; added " + added + "; removed none; rewritten in place 1; fee payer same; blockhash same; signers same; accounts changed (5 to 6); version same"));
            // Its own budget instructions dropped and another blockhash.
            Assert.That(await Changed(Message(system, transfer)),
                Is.EqualTo("instructions 3 to 1; added none; removed " + budget + " x2; rewritten in place 0; fee payer same; blockhash changed; signers same; accounts changed (5 to 4); version same"));
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
