using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Integration.Tests
{
    public sealed class DurableSnapshotTests
    {
        private sealed class ChangingReadStore : IPublicClientStore
        {
            public string Current, LaterRead;
            public int Reads, Exchanges;
            public Task<string> Read(string owner, string field) => Task.FromResult(++Reads == 1 || LaterRead == null ? Current : LaterRead);
            public Task Write(string owner, string field, string value) { Current = value; return Task.CompletedTask; }
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                Exchanges++;
                if (Current != expected) return Task.FromResult(false);
                Current = value; return Task.FromResult(true);
            }
            public void Arm(string current, string later) { Current = current; LaterRead = later; Reads = Exchanges = 0; }
        }
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("solana");
        [Test]
        public async Task CompletingOneSignatureCannotClearAnotherCapturedJournalSnapshot()
        {
            var fixture = Fixture(); string owner = (string)fixture["inputs"]["owner"];
            var entries = fixture["transactions"].Where(t => ((string)t["id"]).StartsWith("purchase-")).Take(2)
                .Select(t => new PendingTransaction(owner, (string)t["id"], "https://base.invalid", true,
                    Convert.FromBase64String((string)t["signedTransaction"]), (string)fixture["inputs"]["blockhash"], 500)).ToArray();
            Assert.That(entries.Length, Is.EqualTo(2));
            var storage = new ChangingReadStore(); var journal = new TransactionJournal(storage);
            await journal.Begin(entries[0]); string first = storage.Current;
            storage.Current = null; await journal.Begin(entries[1]); string second = storage.Current;
            storage.Arm(second, first);
            await AsyncAssert.Throws<InvalidOperationException>(() => journal.Complete(entries[0], entries[0].Signature, true, false, 0, true));
            Assert.That(storage.Current, Is.EqualTo(second)); Assert.That(storage.Reads, Is.EqualTo(1)); Assert.That(storage.Exchanges, Is.Zero);
        }
        [Test]
        public async Task SaveAndConsumeValidateTheExactSnapshotUsedByCompareExchange()
        {
            var fixture = Fixture(); string owner = (string)fixture["inputs"]["owner"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var accounts = new AccountBindings(File.ReadAllText(Path.Combine(generated, "solana.json")), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var sessions = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            RunMarker Marker(ulong id)
            {
                using var bytes = new MemoryStream(); using (var writer = new BinaryWriter(bytes, Encoding.UTF8, true)) writer.Write(id);
                string active = SolanaAddress.Derive(accounts.ProgramId, new[] { Encoding.UTF8.GetBytes("run"), Encoding.UTF8.GetBytes("active"), SolanaAddress.Bytes(owner), bytes.ToArray() }, out _);
                return new RunMarker(owner, id, active, null, null, 0);
            }
            var marker = Marker(11); var other = Marker(12);
            var storage = new ChangingReadStore(); var store = new RunStateStore(storage, accounts, sessions);
            await store.Save(marker); string first = storage.Current;
            storage.Arm(null, null); await store.Save(other); string second = storage.Current;
            storage.Arm(second, first);
            await AsyncAssert.Throws<InvalidOperationException>(() => store.Save(marker));
            Assert.That(storage.Current, Is.EqualTo(second)); Assert.That(storage.Reads, Is.EqualTo(1)); Assert.That(storage.Exchanges, Is.Zero);
            var raw = fixture["accounts"].Single(t => (string)t["id"] == "player-valid");
            var player = new AccountEnvelope((string)raw["address"], (string)raw["owner"], false, Convert.FromBase64String((string)raw["data"]));
            storage.Arm(second, first);
            await store.ClearAfterConsumption(marker, player, null, new DelegationPlacement { IsDelegated = false });
            Assert.That(storage.Current, Is.EqualTo(second)); Assert.That(storage.Reads, Is.EqualTo(1)); Assert.That(storage.Exchanges, Is.Zero);
        }
    }
}
