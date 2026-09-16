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
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("solana");
        [Test]
        public async Task CompletingOneSignatureCannotClearAnotherCapturedJournalSnapshot()
        {
            var fixture = Fixture(); string owner = (string)fixture["inputs"]["owner"];
            var entries = fixture["transactions"].Where(t => ((string)t["id"]).StartsWith("purchase-")).Take(2)
                .Select(t => new PendingTransaction(owner, (string)t["id"], "https://base.invalid", true,
                    Convert.FromBase64String((string)t["signedTransaction"]), (string)fixture["inputs"]["blockhash"], 500)).ToArray();
            Assert.That(entries.Length, Is.EqualTo(2));
            var storage = new TestMemory(); var journal = new TransactionJournal(storage);
            await journal.Begin(entries[0]); string first = storage.Peek(owner, "journal");
            await storage.Write(owner, "journal", null); await journal.Begin(entries[1]); string second = storage.Peek(owner, "journal");
            await storage.Write(owner, "journal", second); storage.Reads = storage.Exchanges = 0;
            storage.ReadOverride = (_, __, current) => storage.Reads == 1 ? second : first;
            await AsyncAssert.Throws<InvalidOperationException>(() => journal.Complete(entries[0], entries[0].Signature, true, false, 0, true));
            Assert.That(storage.Peek(owner, "journal"), Is.EqualTo(second)); Assert.That(storage.Reads, Is.EqualTo(1)); Assert.That(storage.Exchanges, Is.Zero);
        }
        [Test]
        public async Task SaveAndConsumeValidateTheExactSnapshotUsedByCompareExchange()
        {
            var fixture = Fixture(); string owner = (string)fixture["inputs"]["owner"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var accounts = new AccountBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson, Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var sessions = new SessionTokenBindings(ZKube.Integration.Tests.TestBootstrap.TokenJson);
            RunMarker Marker(ulong id)
            {
                using var bytes = new MemoryStream(); using (var writer = new BinaryWriter(bytes, Encoding.UTF8, true)) writer.Write(id);
                string active = SolanaAddress.Derive(accounts.ProgramId, new[] { Encoding.UTF8.GetBytes("run"), Encoding.UTF8.GetBytes("active"), SolanaAddress.Bytes(owner), bytes.ToArray() }, out _);
                return new RunMarker(owner, id, active);
            }
            var marker = Marker(11); var other = Marker(12);
            var storage = new TestMemory(); var store = new RunStateStore(storage, accounts);
            await store.Save(marker); string first = storage.Peek(owner, "daily");
            await storage.Write(owner, "daily", null); await store.Save(other); string second = storage.Peek(owner, "daily");
            await storage.Write(owner, "daily", second); storage.Reads = storage.Exchanges = 0;
            storage.ReadOverride = (_, __, current) => storage.Reads == 1 ? second : first;
            await AsyncAssert.Throws<InvalidOperationException>(() => store.Save(marker));
            Assert.That(storage.Peek(owner, "daily"), Is.EqualTo(second)); Assert.That(storage.Reads, Is.EqualTo(1)); Assert.That(storage.Exchanges, Is.Zero);
            var raw = fixture["accounts"].Single(t => (string)t["id"] == "player-valid");
            var player = new AccountEnvelope((string)raw["address"], (string)raw["owner"], false, Convert.FromBase64String((string)raw["data"]));
            await storage.Write(owner, "daily", second); storage.Reads = storage.Exchanges = 0;
            storage.ReadOverride = (_, __, current) => storage.Reads == 1 ? second : first;
            await store.ClearAfterConsumption(marker, player, null, new DelegationPlacement { IsDelegated = false });
            Assert.That(storage.Peek(owner, "daily"), Is.EqualTo(second)); Assert.That(storage.Reads, Is.EqualTo(1)); Assert.That(storage.Exchanges, Is.Zero);
        }
    }
}
