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
            var bindings = new AccountBindings(ZKube.Integration.Tests.TestBootstrap.ProtocolJson,
                Protocol.PlayerStateAccountVersion, Protocol.ProtocolAccountVersion);
            string owner = (string)fixture["inputs"]["owner"];
            foreach (var board in fixture["boards"])
            {
                var raw = board["envelope"];
                AccountEnvelope account = raw.Type == JTokenType.Null ? null : new AccountEnvelope((string)raw["address"],
                    (string)raw["owner"], (bool)raw["executable"], Convert.FromBase64String((string)raw["data"]));
                string id = (string)board["id"];
                var dailyRow = board["daily"];
                var daily = new AccountEnvelope((string)dailyRow["address"], (string)dailyRow["owner"], (bool)dailyRow["executable"],
                    Convert.FromBase64String((string)dailyRow["data"]));
                if (id == "wrong-program")
                {
                    Assert.Throws<FormatException>(() => bindings.BoardRewards(account, daily, (uint)board["day"], (string)board["kind"], owner));
                    continue;
                }
                var rewards = bindings.BoardRewards(account, daily, (uint)board["day"], (string)board["kind"], owner);
                bool absent = id == "missing" || id == "unsealed" || id == "other-owner";
                Assert.That(rewards.Count, Is.EqualTo(absent ? 0 : 1), id);
                if (id == "unsealed")
                {
                    // A running Daily's board is live standings: rows to show, nothing to claim.
                    var live = bindings.ArenaBoard(account, bindings.ArenaDaily(daily, (uint)board["day"]), (uint)board["day"], (string)board["kind"]);
                    Assert.That(live.Sealed, Is.False); Assert.That(live.SealedAt, Is.Zero);
                    Assert.That(live.Rows.Single().Player, Is.EqualTo(owner)); Assert.That(live.Rows.Single().Claimed, Is.False);
                }
                if (absent) continue;
                Assert.That(rewards[0].Claimed, Is.EqualTo(id == "claimed"), id);
                Assert.That(rewards[0].Position, Is.Zero);
                Assert.That(rewards[0].BoardAddress, Is.EqualTo(account.Address));
                // The one claim clock is the Daily's finalization.
                Assert.That(rewards[0].SealedAt, Is.EqualTo((long)bindings.ArenaDaily(daily, (uint)board["day"])["finalized_at"]));
                // Without its Daily a board offers nothing.
                Assert.That(bindings.BoardRewards(account, null, (uint)board["day"], (string)board["kind"], owner), Is.Empty);
                var invalidBits = account.Data;
                invalidBits[invalidBits.Length - 1] |= 128;
                Assert.Throws<FormatException>(() => bindings.BoardRewards(new AccountEnvelope(account.Address, account.Owner, false, invalidBits),
                    daily, (uint)board["day"], (string)board["kind"], owner));
                var changedClaim = account.Data;
                changedClaim[changedClaim.Length - 1] ^= 1;
                Assert.Throws<FormatException>(() => bindings.BoardRewards(new AccountEnvelope(account.Address, account.Owner, false, changedClaim),
                    daily, (uint)board["day"], (string)board["kind"], owner));
                foreach (var bytes in new[] { account.Data.Take(account.Data.Length - 1).ToArray(), account.Data.Concat(new byte[1]).ToArray() })
                    Assert.Throws<FormatException>(() => bindings.BoardRewards(new AccountEnvelope(account.Address, account.Owner, false, bytes),
                        daily, (uint)board["day"], (string)board["kind"], owner));
                Assert.Throws<FormatException>(() => bindings.BoardRewards(account, daily, (uint)board["day"] + 1, (string)board["kind"], owner));
                Assert.Throws<FormatException>(() => bindings.BoardRewards(account, daily, (uint)board["day"], (string)board["kind"] == "score" ? "theme" : "score", owner));
            }
        }
    }
}
