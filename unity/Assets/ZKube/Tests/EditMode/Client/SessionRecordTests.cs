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
        [Test]
        public async Task SessionRecordCompareExchangeRejectsStaleStateAndRetainsItOnStorageFailure()
        {
            var fixture = ProgramScenarios.Load("device"); string owner = (string)fixture["inputs"]["owner"];
            string generated = Path.Combine(Application.dataPath, "ZKube/Integration/Generated");
            var protocol = new ProtocolBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
            var tokens = new SessionTokenBindings(ZKube.Integration.Tests.TestBootstrap.TokenJson);
            var storage = new TestMemory(); var records = new SessionRecordStore(storage, tokens, protocol.ProgramId);
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
