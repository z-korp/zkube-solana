using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Integration.Tests
{
    public sealed class DurableStoreTests
    {
        private sealed class Storage : IPublicClientStore
        {
            private readonly Dictionary<string, string> records = new Dictionary<string, string>();
            public bool Fail;
            public Task<string> Read(string owner, string field)
            { lock (records) return Task.FromResult(records.TryGetValue(owner + field, out var value) ? value : null); }
            public Task Write(string owner, string field, string value)
            {
                lock (records) { if (Fail) throw new IOException("Synthetic storage failure"); records[owner + field] = value; }
                return Task.CompletedTask;
            }
            public Task<bool> CompareExchange(string owner, string field, string expected, string value)
            {
                lock (records)
                {
                    if (Fail) throw new IOException("Synthetic storage failure");
                    records.TryGetValue(owner + field, out var prior);
                    if (prior != expected) return Task.FromResult(false);
                    records[owner + field] = value;
                    return Task.FromResult(true);
                }
            }
        }
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("solana");
        private sealed class DiscoveryTransport : IRecoveryTransport
        {
            public AccountEnvelope Player;
            public string Delegation;
            public string BaseEndpoint => "https://base.invalid/";
            public Task<AccountEnvelope> ReadBase(string address) => Task.FromResult(address == Player.Address ? Player :
                new AccountEnvelope(address, Delegation, false, Array.Empty<byte>()));
            public Task<DelegationPlacement> Placement(string activeRun) => Task.FromResult(new DelegationPlacement { IsDelegated = true });
            public Task<AccountEnvelope> ReadEr(string endpoint, string activeRun) => throw new InvalidOperationException("Unexpected ER read");
        }
        [Test]
        public async Task ArcadeSlotIsDiscoveredWithoutADeviceKeyAndRetainedDuringRouterLag()
        {
            var fixture = Fixture();
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var accounts = new AccountBindings(File.ReadAllText(Path.Combine(generated, "solana.json")), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var sessions = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            var raw = fixture["accounts"].Single(row => (string)row["id"] == "player-valid");
            string owner = (string)fixture["inputs"]["owner"], delegation = (string)fixture["inputs"]["delegationProgramId"];
            var transport = new DiscoveryTransport { Player = new AccountEnvelope((string)raw["address"], (string)raw["owner"], false,
                Convert.FromBase64String((string)raw["data"])), Delegation = delegation };
            var store = new RunStateStore(new Storage(), accounts);
            var recovery = new RunRecovery(accounts.ProgramId, delegation, accounts);
            var daily = await store.ResolveOrDiscover(owner, recovery, transport, (long)fixture["inputs"]["nowUnix"]);
            Assert.That(daily.Phase, Is.EqualTo("resolving"));
            Assert.That((await store.Load(owner)).ActiveRun, Is.EqualTo(daily.Marker.ActiveRun));
        }
        [Test]
        public async Task RestartBeforeOrAfterSendRetainsExactBytesAndRequiresObservedOutcome()
        {
            var fixture = Fixture();
            string owner = (string)fixture["inputs"]["owner"];
            byte[] bytes = Convert.FromBase64String((string)fixture["transactions"][0]["signedTransaction"]);
            var entry = new PendingTransaction(owner, "synthetic-purchase", "https://base.invalid", true, bytes,
                (string)fixture["inputs"]["blockhash"], 500);
            var storage = new Storage();
            var first = new TransactionJournal(storage);
            var restored = new TransactionJournal(storage);
            await first.Begin(entry);
            Assert.That((await restored.Load(owner)).Transaction, Is.EqualTo(bytes));
            await AsyncAssert.Throws<InvalidOperationException>(async () => await restored.Begin(entry));
            await AsyncAssert.Throws<InvalidOperationException>(async () => await restored.Complete(entry, entry.Signature, false, false, 999, true));
            await AsyncAssert.Throws<InvalidOperationException>(async () => await restored.Complete(entry, entry.Signature, false, true, 500, true));
            await AsyncAssert.Throws<InvalidOperationException>(async () => await restored.Complete(entry, entry.Signature, true, false, 499, false));
            Assert.That(await restored.Load(owner), Is.Not.Null);
            await restored.Complete(entry, entry.Signature, false, true, 501, true);
            Assert.That(await first.Load(owner), Is.Null);
            await first.Begin(entry);
            await first.Complete(entry, entry.Signature, true, false, 400, true);
            storage.Fail = true;
            await AsyncAssert.Throws<IOException>(async () => await first.Begin(entry));
            storage.Fail = false;
            Assert.That(await first.Load(owner), Is.Null);
        }
        [Test]
        public async Task PublicMarkersSurviveWithoutDeviceSecretsAndRejectTamperedRelationships()
        {
            var fixture = Fixture();
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var accounts = new AccountBindings(File.ReadAllText(Path.Combine(generated, "solana.json")), Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            var sessions = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            string owner = (string)fixture["inputs"]["owner"];
            // The real routing fixtures carry the PDA matching this exact u64.
            string active = null;
            foreach (var pda in fixture["pdas"]) if ((string)pda["id"] == "run-high-u64") active = (string)pda["address"];
            Assert.That(active, Is.Not.Null);
            var marker = new RunMarker(owner, (ulong)fixture["inputs"]["runId"], active);
            var storage = new Storage();
            var store = new RunStateStore(storage, accounts);
            await store.Save(marker);
            var restored = await new RunStateStore(storage, accounts).Load(owner);
            Assert.That(restored.ActiveRun, Is.EqualTo(marker.ActiveRun));
            var fields = JObject.Parse(await storage.Read(owner, "daily"));
            fields["sessionSigner"] = owner; fields["sessionToken"] = owner; fields["validUntil"] = 1;
            await storage.Write(owner, "daily", fields.ToString());
            Assert.That((await store.Load(owner)).RunId, Is.EqualTo(marker.RunId), "The v1 locator ignores retired device metadata");
            fields["activeRun"] = owner;
            await storage.Write(owner, "daily", fields.ToString());
            await AsyncAssert.Throws<FormatException>(async () => await store.Load(owner));
            Assert.That(await storage.Read(owner, "daily"), Is.Not.Null);
        }
    }
}
