using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.Client;

namespace ZKube.Integration.Tests
{
    public sealed class SessionHandoffTests
    {
        internal sealed class Store : IPublicClientStore
        {
            private readonly Dictionary<string, string> values = new Dictionary<string, string>();
            public bool FailBeforeCommit;
            public Task<string> Read(string owner, string field) { values.TryGetValue(owner + field, out var value); return Task.FromResult(value); }
            public Task Write(string owner, string field, string value) { values[owner + field] = value; return Task.CompletedTask; }
            public async Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                if (FailBeforeCommit) throw new IOException("Synthetic durable commit failure");
                if (await Read(owner, field) != expected) return false;
                values[owner + field] = value; return true;
            }
        }
        internal sealed class Native : INativeDeviceKeyLifecycle
        {
            public byte[] Active = Enumerable.Repeat((byte)2, 32).ToArray(), Candidate = Enumerable.Repeat((byte)3, 32).ToArray();
            public int Promotions;
            public bool FailBeforeCommit;
            public Task<string> Request(string json) => throw new InvalidOperationException("No wallet launch allowed");
            public Task<byte[]> LoadDeviceSeed(string owner) => Task.FromResult(Active?.ToArray());
            public Task<byte[]> LoadCandidateSeed(string owner) => Task.FromResult(Candidate?.ToArray());
            public Task<byte[]> CreateDeviceSeed(string owner) => throw new InvalidOperationException("No active key creation allowed");
            public Task<byte[]> CreateCandidateSeed(string owner) => throw new InvalidOperationException("No candidate creation allowed");
            public Task RemoveDeviceSeed(string owner) => throw new InvalidOperationException("No deletion allowed");
            public async Task PromoteCandidateSeed(string owner, byte[] oldHash, byte[] nextHash)
            {
                await Task.Yield();
                bool Match(byte[] seed, byte[] hash)
                { if (seed == null || hash == null) return seed == null && hash == null; using var sha = SHA256.Create(); return sha.ComputeHash(seed).SequenceEqual(hash); }
                if (Candidate == null && Match(Active, nextHash)) return;
                if (FailBeforeCommit) throw new IOException("Synthetic native commit failure");
                if (!Match(Active, oldHash) || !Match(Candidate, nextHash)) throw new InvalidOperationException("Changed native snapshot");
                Active = Candidate; Candidate = null; Promotions++;
            }
        }
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("device");
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        [Test]
        public async Task EachNativePublicAndJournalCrashGapResumesWithoutReplacingEitherSigner()
        {
            var fixture = Fixture(); var input = fixture["inputs"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(generated, "solana.json")));
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            string owner = (string)input["owner"];
            var old = new SessionRecord(owner, (string)input["previous"], (string)fixture["cases"][0]["oldToken"]["address"], (long)input["now"] - 1);
            var candidate = new SessionRecord(owner, (string)input["candidate"], (string)fixture["candidateToken"]["address"], (long)fixture["candidateToken"]["validUntil"]);
            var storage = new Store(); var native = new Native(); var records = new SessionRecordStore(storage, tokens, protocol.ProgramId);
            await records.Replace(await records.Load(owner), new SessionRecords(owner, old, candidate));
            var pending = new PendingTransaction(owner, "session-renew", "https://base.invalid/", true,
                Convert.FromBase64String((string)fixture["cases"][0]["signedTransaction"]), (string)input["blockhash"], 500);
            var journal = new TransactionJournal(storage); await journal.Begin(pending);
            SessionHandoff Restart() => new SessionHandoff(new SessionRecordStore(storage, tokens, protocol.ProgramId), new DeviceKeyLifecycle(native), tokens, protocol.ProgramId);
            native.FailBeforeCommit = true;
            await AsyncAssert.Throws<IOException>(() => Restart().Accept(candidate, Envelope(fixture["candidateToken"])));
            Assert.That(native.Promotions, Is.Zero); Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(old.Signer));
            native.FailBeforeCommit = false; storage.FailBeforeCommit = true;
            await AsyncAssert.Throws<IOException>(() => Restart().Accept(candidate, Envelope(fixture["candidateToken"])));
            Assert.That(native.Promotions, Is.EqualTo(1)); Assert.That((await records.Load(owner)).Candidate.Signer, Is.EqualTo(candidate.Signer));
            storage.FailBeforeCommit = false;
            await Restart().Accept(candidate, Envelope(fixture["candidateToken"]));
            Assert.That((await records.Load(owner)).Active.Signer, Is.EqualTo(candidate.Signer)); Assert.That((await records.Load(owner)).Candidate, Is.Null);
            Assert.That(await journal.Load(owner), Is.Not.Null);
            await Restart().Accept(candidate, Envelope(fixture["candidateToken"]));
            Assert.That(native.Promotions, Is.EqualTo(1));
            await journal.Complete(pending, pending.Signature, true, false, 0, true);
            Assert.That(await journal.Load(owner), Is.Null);
        }
        [Test]
        public async Task WrongTokenAndConcurrentPublicRecordChangeCannotPromoteAnotherCandidate()
        {
            var fixture = Fixture(); var input = fixture["inputs"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(generated, "solana.json")));
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            string owner = (string)input["owner"];
            var candidate = new SessionRecord(owner, (string)input["candidate"], (string)fixture["candidateToken"]["address"], (long)fixture["candidateToken"]["validUntil"]);
            var storage = new Store(); var native = new Native(); var records = new SessionRecordStore(storage, tokens, protocol.ProgramId);
            var handoff = new SessionHandoff(records, new DeviceKeyLifecycle(native), tokens, protocol.ProgramId);
            await AsyncAssert.Throws<FormatException>(() => handoff.Accept(candidate, Envelope(fixture["cases"][0]["oldToken"])));
            await AsyncAssert.Throws<InvalidOperationException>(() => handoff.Accept(candidate, Envelope(fixture["candidateToken"])));
            Assert.That(native.Promotions, Is.Zero);
            var stale = await records.Load(owner);
            await records.Replace(stale, new SessionRecords(owner, null, candidate));
            await AsyncAssert.Throws<InvalidOperationException>(() => records.Replace(stale, new SessionRecords(owner, candidate, null)));
        }
    }
}
