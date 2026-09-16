using System;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;

namespace ZKube.Integration.Tests
{
    public sealed class TestBootstrap
    {
        private static readonly Lazy<string> protocol = new Lazy<string>(() => File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
        private static readonly Lazy<string> token = new Lazy<string>(() => File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
        public static string ProtocolJson => protocol.Value;
        public static string TokenJson => token.Value;
        public readonly ProtocolBindings Protocol = new ProtocolBindings(ProtocolJson);
        public readonly AccountBindings Accounts = new AccountBindings(ProtocolJson, Core.Generated.Protocol.PlayerStateAccountVersion, Core.Generated.Protocol.ProtocolAccountVersion);
        public readonly SessionTokenBindings Tokens = new SessionTokenBindings(TokenJson);
        public readonly TransactionPlanner Planner;
        public TestBootstrap() { Planner = new TransactionPlanner(Protocol, Tokens); }
        public static async Task SeedSession(SessionRecordStore records, string owner, string signer, string address, long validUntil)
        {
            await records.Replace(await records.Load(owner), new SessionRecords(owner, new SessionRecord(owner, signer, address, validUntil)));
        }
    }
}
