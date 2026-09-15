using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Integration.Tests
{
    public sealed class BoardAccountTests
    {
        [Test]
        public void BoardRewardsValidateActualAnchorAccountsAndKeepClaimedPositionsVisible()
        {
            var fixture = ZKube.Integration.Tests.ProgramScenarios.Load("plans");
            var bindings = new AccountBindings(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")),
                Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            string owner = (string)fixture["inputs"]["owner"];
            foreach (var board in fixture["boards"])
            {
                var raw = board["envelope"];
                AccountEnvelope account = raw.Type == JTokenType.Null ? null : new AccountEnvelope((string)raw["address"],
                    (string)raw["owner"], (bool)raw["executable"], Convert.FromBase64String((string)raw["data"]));
                string id = (string)board["id"];
                if (id == "wrong-program")
                {
                    Assert.Throws<FormatException>(() => bindings.BoardRewards(account, (uint)board["day"], (string)board["kind"], owner));
                    continue;
                }
                var rewards = bindings.BoardRewards(account, (uint)board["day"], (string)board["kind"], owner);
                bool absent = id == "missing" || id == "unsealed" || id == "other-owner";
                Assert.That(rewards.Count, Is.EqualTo(absent ? 0 : 1), id);
                if (absent) continue;
                Assert.That(rewards[0].Claimed, Is.EqualTo(id == "claimed"), id);
                Assert.That(rewards[0].Position, Is.Zero);
                Assert.That(rewards[0].BoardAddress, Is.EqualTo(account.Address));
                var invalidBits = account.Data;
                invalidBits[invalidBits.Length - 1] |= 128;
                Assert.Throws<FormatException>(() => bindings.BoardRewards(new AccountEnvelope(account.Address, account.Owner, false, invalidBits),
                    (uint)board["day"], (string)board["kind"], owner));
                var changedClaim = account.Data;
                changedClaim[changedClaim.Length - 1] ^= 1;
                Assert.Throws<FormatException>(() => bindings.BoardRewards(new AccountEnvelope(account.Address, account.Owner, false, changedClaim),
                    (uint)board["day"], (string)board["kind"], owner));
                foreach (var bytes in new[] { account.Data.Take(account.Data.Length - 1).ToArray(), account.Data.Concat(new byte[1]).ToArray() })
                    Assert.Throws<FormatException>(() => bindings.BoardRewards(new AccountEnvelope(account.Address, account.Owner, false, bytes),
                        (uint)board["day"], (string)board["kind"], owner));
                Assert.Throws<FormatException>(() => bindings.BoardRewards(account, (uint)board["day"] + 1, (string)board["kind"], owner));
                Assert.Throws<FormatException>(() => bindings.BoardRewards(account, (uint)board["day"], (string)board["kind"] == "score" ? "theme" : "score", owner));
            }
        }
    }
}
