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
            foreach (uint qualified in new[] { (uint)SolanaRpcTransport.MaximumArenaPlayerAccounts + 1, uint.MaxValue })
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
            uint limit = (uint)SolanaRpcTransport.MaximumArenaPlayerAccounts;
            var plan = ZKube.Core.NativeEngine.BoardWidth(0, limit);
            var emptySource = e.Fixture["boardCases"].Single(row => (string)row["kind"] == "score" && (string)row["variant"] == "empty");
            var empty = PatchAccount(emptySource["envelope"], "ArenaBoard", ("qualified_count", Number(limit, 4)),
                ("pool_lamports", Number(0, 8)), ("paid_lamports", Number(0, 8)), ("rollover_lamports", Number(0, 8)),
                ("denominator", ZKube.Core.Generated.NativeWire.Bytes(plan, 4, 16)));
            e.Http.Put(empty); e.Http.Remove(source["daily"]);
            Assert.That((await e.Queries.SettledBoards(day)).Value.Score.Status, Is.EqualTo("empty"));
        }

        [Test] public async Task ProvisionalTimestampUsesTheKeeperSafeIntegerBoundary()
        {
            var e = await Environment.Create(); const ulong maximum = 9007199254740991;
            ConfigureScan(e, 1, 0, ArenaRow(e, 1, 10, 0, maximum));
            var result = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(result.Complete, Is.True); Assert.That(result.Score[0].FinalizedAt, Is.EqualTo((long)maximum));
            ConfigureScan(e, 1, 0, ArenaRow(e, 1, 10, 0, maximum + 1));
            await Failure<FormatException>(async () => { await e.Queries.CurrentProvisionalBoards(); });
        }

        [Test] public async Task ScanPreflightBoundsAccountContextAndErrorBeforeAnyAccountCallback()
        {
            var e = await Environment.Create(); ConfigureScan(e, 1, 0, ArenaRow(e, 1, 10, 0, 10));
            var rpc = new SolanaRpcTransport(e.Http, "https://base.invalid/", "https://router.invalid/", e.Http.Genesis, e.Accounts.ProgramId);
            var manyProperties = new JObject(); for (int i = 0; i < 33; i++) manyProperties["k" + i] = 0;
            JToken nested = new JValue(0); for (int i = 0; i < 14; i++) nested = new JArray(nested);
            var payloads = new JToken[] {
                new JValue(new string('x', 1025)), // bounded individual text
                new JArray(Enumerable.Range(0, 129).Select(_ => new JValue(0))), // tokens/items
                manyProperties, nested,
                new JArray(Enumerable.Range(0, 8).Select(_ => new JValue(new string('x', 600)))) // total subtree text
            };
            foreach (string target in new[] { "account", "context", "error" })
                foreach (var payload in payloads)
                {
                    int accepted = 0;
                    e.Http.AlterScanResponse = json => {
                        var response = JObject.Parse(json); var result = (JObject)response["result"];
                        if (target == "account") result["value"][0]["account"]["unexpected"] = payload.DeepClone();
                        else if (target == "context") {
                            var context = (JObject)result["context"]; context["unexpected"] = payload.DeepClone();
                            // Put context after the valid row: preflight must
                            // reject before the streaming callback sees it.
                            result.Remove("context"); result["context"] = context;
                        }
                        else response["error"] = new JObject { ["code"] = -1, ["message"] = "bounded test", ["data"] = payload.DeepClone() };
                        return response.ToString(Formatting.None);
                    };
                    await Failure<FormatException>(async () => { await rpc.ReadArenaPlayers(e.Accounts,
                        (uint)e.Fixture["inputs"]["day"], 100, (_, __) => accepted++); });
                    Assert.That(accepted, Is.EqualTo(0), target + " must fail before any account materialization/callback");
                }
            e.Http.AlterScanResponse = json => json.Replace("\"result\"", "\"res\\u0075lt\"");
            int valid = 0;
            await rpc.ReadArenaPlayers(e.Accounts, (uint)e.Fixture["inputs"]["day"], 100, (_, __) => valid++);
            Assert.That(valid, Is.EqualTo(1), "escaped wrapper keys preserve JSON semantics");
        }
    }
}
