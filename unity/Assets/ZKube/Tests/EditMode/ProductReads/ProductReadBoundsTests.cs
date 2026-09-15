using System;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration.Transport;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        [Test] public async Task UnsupportedBoardVerificationReturnsNoPayoutsOrClaimAccount()
        {
            var e = await Environment.Create(); uint day = (uint)e.Fixture["inputs"]["oldDay"];
            var source = e.Fixture["boardCases"].Single(row => (string)row["kind"] == "score" && (string)row["variant"] == "sealed");
            e.Http.Put(source["daily"]);
            // Retain the small 1 SOL pool even at u32::MAX. If this guard
            // regresses the native loop stops after a few ranks; this test
            // never supplies the huge pool needed for the reported DoS.
            foreach (uint qualified in new[] { (uint)ZKube.Integration.Client.ProductQueries.MaximumVerifiedQualifiedPlayers + 1, uint.MaxValue })
            {
                var board = PatchAccount(source["envelope"], "ArenaBoard", ("qualified_count", Number(qualified, 4)));
                e.Http.Put(board);
                var result = (await e.Queries.SettledBoards(day)).Value.Score;
                Assert.That(result.Status, Is.EqualTo("unsupported-verification"));
                Assert.That(result.ClaimStatus, Is.EqualTo("unavailable"));
                Assert.That(result.Rows, Is.Empty); Assert.That(result.Yours, Is.Null);
                Assert.That(result.Account, Is.Null); Assert.That(result.ExpiresAt, Is.Null);
            }
            // The exact existing envelope boundary is supported: a zero pool
            // has no paid rows, while core retains its structural denominator.
            uint limit = (uint)ZKube.Integration.Client.ProductQueries.MaximumVerifiedQualifiedPlayers;
            var plan = ZKube.Core.NativeEngine.BoardWidth(0, limit);
            var emptySource = e.Fixture["boardCases"].Single(row => (string)row["kind"] == "score" && (string)row["variant"] == "empty");
            var empty = PatchAccount(emptySource["envelope"], "ArenaBoard", ("qualified_count", Number(limit, 4)),
                ("pool_lamports", Number(0, 8)), ("paid_lamports", Number(0, 8)), ("rollover_lamports", Number(0, 8)),
                ("denominator", ZKube.Core.Generated.NativeWire.Bytes(plan, 4, 16)));
            e.Http.Put(empty); e.Http.Remove(source["daily"]);
            Assert.That((await e.Queries.SettledBoards(day)).Value.Score.Status, Is.EqualTo("empty"));
        }

    }
}
