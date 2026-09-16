using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using ZKube.Integration.Client;

namespace ZKube.Integration.Tests
{
    public sealed class SessionRecordTests
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
        internal sealed class Native : INativeWalletTransport
        {
            public byte[] Seed = Enumerable.Repeat((byte)2, 32).ToArray();
            public Task<string> Request(string json) => throw new InvalidOperationException("No wallet launch allowed");
            public Task<byte[]> LoadDeviceSeed(bool create)
            {
                if (create) throw new InvalidOperationException("No key creation during recovery");
                return Task.FromResult(Seed?.ToArray());
            }
        }
        [Test]
        public async Task SessionRecordCompareExchangeRejectsStaleStateAndRetainsItOnStorageFailure()
        {
            var fixture = ProgramScenarios.Load("device"); string owner = (string)fixture["inputs"]["owner"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var protocol = new ProtocolBindings(File.ReadAllText(Path.Combine(generated, "solana.json")));
            var tokens = new SessionTokenBindings(File.ReadAllText(Path.Combine(generated, "session.json")));
            var storage = new Store(); var records = new SessionRecordStore(storage, tokens, protocol.ProgramId);
            var empty = await records.Load(owner);
            var active = new SessionRecord(owner, (string)fixture["inputs"]["device"],
                (string)fixture["renewedToken"]["address"], (long)fixture["renewedToken"]["validUntil"]);
            storage.FailBeforeCommit = true;
            await AsyncAssert.Throws<IOException>(() => records.Replace(empty, new SessionRecords(owner, active)));
            Assert.That((await records.Load(owner)).Active, Is.Null);
            storage.FailBeforeCommit = false;
            await records.Replace(empty, new SessionRecords(owner, active));
            await AsyncAssert.Throws<InvalidOperationException>(() => records.Replace(empty, new SessionRecords(owner, null)));
            Assert.That((await records.Load(owner)).Active.ValidUntil, Is.EqualTo(active.ValidUntil));
        }
    }
}
