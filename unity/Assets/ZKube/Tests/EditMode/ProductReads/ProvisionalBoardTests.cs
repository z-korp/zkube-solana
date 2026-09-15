using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Core.Generated;
using ZKube.Integration;
using ZKube.Integration.Transport;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        [Test] public async Task ProvisionalRanksSeparateScoreThemeAndUseRawWalletTiebreaks()
        {
            var e = await Environment.Create();
            int smaller = 0, larger = 0;
            for (int a = 1; a < 255 && smaller == 0; a++)
                for (int b = a + 1; b < 256; b++)
                    if (string.CompareOrdinal(PublicOwner(a), PublicOwner(b)) > 0) { smaller = a; larger = b; break; }
            Assert.That(smaller, Is.GreaterThan(0), "Exercise a base58 string order that differs from raw bytes");
            var winner = ArenaRow(e, 900, 1000, 0, 20);
            var firstTie = ArenaRow(e, smaller, 200, 9000, 10);
            var secondTie = ArenaRow(e, larger, 200, 8000, 10);
            var earlier = ArenaRow(e, 901, 200, 0, 9);
            var empty = ArenaRow(e, 902, 0, 0, 1);
            ConfigureScan(e, 4, 2, secondTie, empty, winner, firstTie, earlier);
            var read = await e.Queries.CurrentProvisionalBoards(); var board = read.Value;
            Assert.That(board.Complete, Is.True); Assert.That(board.ScoreQualifiedCount, Is.EqualTo(4));
            CollectionAssert.AreEqual(new[] { PublicOwner(900), PublicOwner(901), PublicOwner(smaller), PublicOwner(larger) }, board.Score.Select(row => row.Owner));
            CollectionAssert.AreEqual(new[] { PublicOwner(smaller), PublicOwner(larger) }, board.Theme.Select(row => row.Owner));
            CollectionAssert.AreEqual(new uint[] { 1, 2, 3, 4 }, board.Score.Select(row => row.Rank));
            Assert.That(board.Score.All(row => row.Metric > 0), Is.True); Assert.That(board.Theme.All(row => row.Metric > 0), Is.True);
            var scan = e.Http.Requests.Single(request => (string)request["method"] == "getProgramAccounts");
            Assert.That((bool)scan["params"][1]["withContext"], Is.True);
            Assert.That((ulong)scan["params"][1]["minContextSlot"], Is.EqualTo(100));
            Assert.That(JToken.DeepEquals(scan["params"][1]["filters"], e.Accounts.ArenaPlayerScanFilters((uint)e.Fixture["inputs"]["day"])), Is.True);
            var rows = board.Score[0].ReplayHash; rows[0] ^= 255;
            Assert.That(board.Score[0].ReplayHash[0], Is.Not.EqualTo(rows[0]));
            await e.Identity.Disconnect(); Assert.Throws<OperationCanceledException>(() => { var ignored = read.Value; });
        }

        [Test] public async Task ProvisionalScanRetainsCanonicalTopRowsAbove4096WithoutDroppingQualificationCounts()
        {
            var e = await Environment.Create();
            var rows = Enumerable.Range(1, 4200).Select(i => ArenaRow(e, i, (uint)i, 0, 10)).ToArray();
            var own = ArenaRow(e, 0, 1, 0, 11, e.Owner); e.Http.Put(own);
            ConfigureScan(e, 4201, 0, rows.Cast<JToken>().Append(own).ToArray());
            var result = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(SolanaRpcTransport.MaximumArenaPlayerAccounts, Is.EqualTo(100000));
            Assert.That(result.Complete, Is.True); Assert.That(result.ScoreQualifiedCount, Is.EqualTo(4201));
            Assert.That(result.Score.Count, Is.EqualTo(ClientPolicy.ArenaBoardCapacity));
            Assert.That(result.Score.First().Metric, Is.EqualTo(4200));
            Assert.That(result.Score.Last().Metric, Is.EqualTo(4200U - ClientPolicy.ArenaBoardCapacity + 1));
            Assert.That(result.Theme, Is.Empty);
            Assert.That(result.ScoreStanding.Qualified, Is.True); Assert.That(result.ScoreStanding.Rank, Is.EqualTo(4201));
            Assert.That(result.ScoreStanding.Entry.Owner, Is.EqualTo(e.Owner));
            Assert.That(result.ThemeStanding.Qualified, Is.False); Assert.That(result.ThemeStanding.Rank, Is.Null);
        }

        [Test] public async Task IncompleteChangedAndEmptyProvisionalBoardsCannotBeConfused()
        {
            var e = await Environment.Create(); ConfigureScan(e, 1, 0);
            var result = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(result.Status, Is.EqualTo("incomplete")); Assert.That(result.Complete, Is.False); Assert.That(result.Score, Is.Empty);
            ConfigureScan(e, 0, 0); result = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(result.Complete, Is.True); Assert.That(result.Score, Is.Empty);
            e.Http.OnRequest = request => { if ((string)request["method"] == "getProgramAccounts")
                e.Http.Put(PatchAccount(e.Fixture["accounts"]["daily"], "ArenaDaily", ("score_qualified_players", Number(1, 4)))); };
            result = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(result.Status, Is.EqualTo("changed")); Assert.That(result.Score, Is.Empty);
            e.Http.OnRequest = null; e.Http.Remove(e.Fixture["accounts"]["daily"]);
            Assert.That((await e.Queries.CurrentProvisionalBoards()).Value.Status, Is.EqualTo("missing-daily"));
        }

        [Test] public async Task OwnStandingIsIndependentAcrossBoardsAndMissingQualifiedViewerInvalidatesTheScan()
        {
            var e = await Environment.Create(); var own = ArenaRow(e, 0, 10, 100, 10, e.Owner); e.Http.Put(own);
            var other = ArenaRow(e, 1, 100, 10, 10); ConfigureScan(e, 2, 2, own, other);
            var board = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(board.ScoreStanding.Rank, Is.EqualTo(2)); Assert.That(board.ThemeStanding.Rank, Is.EqualTo(1));
            ConfigureScan(e, 2, 2, other);
            board = (await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(board.Complete, Is.False); Assert.That(board.ScoreStanding, Is.Null); Assert.That(board.ThemeStanding, Is.Null);
        }

        [Test] public async Task ProvisionalScanRejectsLyingFiltersDuplicatesBadEnvelopesAndZeroQualifiedMetrics()
        {
            var e = await Environment.Create(); var row = ArenaRow(e, 1, 10, 0, 10);
            ConfigureScan(e, 1, 0, row, row);
            await Failure<FormatException>(async () => { await e.Queries.CurrentProvisionalBoards(); });
            var wrongOwner = (JObject)row.DeepClone(); wrongOwner["owner"] = e.Owner;
            var wrongPda = (JObject)row.DeepClone(); wrongPda["address"] = e.Owner;
            var wrongVersion = PatchAccount(row, "ArenaPlayer", ("version", new byte[] { 255 }));
            var zeroBest = PatchAccount(row, "ArenaPlayer", ("score_best_entry.score", Number(0, 4)));
            foreach (var invalid in new[] { wrongOwner, wrongPda, wrongVersion, zeroBest, e.Fixture["invalidAccounts"]["arenaChallenge"] })
            {
                ConfigureScan(e, 1, 0, invalid);
                await Failure<FormatException>(async () => { await e.Queries.CurrentProvisionalBoards(); });
            }
        }

        [Test] public async Task ScanRequiresFreshContextAndCompleteRpcEnvelopeEvenAfterValidRows()
        {
            var e = await Environment.Create(); ConfigureScan(e, 1, 0, ArenaRow(e, 1, 10, 0, 10));
            e.Http.ScanSlot = 99;
            await Failure<FormatException>(async () => { await e.Queries.CurrentProvisionalBoards(); });
            e.Http.ScanSlot = 100;
            foreach (var mutation in new Func<string,string>[] {
                json => { var value = JObject.Parse(json); ((JObject)value["result"]).Remove("context"); return value.ToString(); },
                json => { var value = JObject.Parse(json); value["id"] = 999; return value.ToString(); },
                json => json.Substring(0, json.LastIndexOf('}')),
                json => json + "{}",
                json => json.Replace("\"jsonrpc\": \"2.0\"", "\"jsonrpc\": \"2.0\", \"jsonrpc\": \"2.0\"") })
            {
                e.Http.AlterScanResponse = mutation;
                await Failure<Exception>(async () => { await e.Queries.CurrentProvisionalBoards(); });
            }
        }

        [Test] public async Task DisconnectDuringCompleteScanDiscardsTheOldIdentityResult()
        {
            var e = await Environment.Create(); ConfigureScan(e, 1, 0, ArenaRow(e, 1, 10, 0, 10));
            e.Http.WaitMethod = "getProgramAccounts"; e.Http.Wait = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var pending = e.Queries.CurrentProvisionalBoards(); await e.Http.Entered.Task;
            await e.Identity.Disconnect(); e.Wallet.Owner = e.Accounts.ProgramId; await e.Identity.Connect(); e.Http.Wait.SetResult(true);
            await Failure<OperationCanceledException>(async () => { await pending; });
        }

        private static void ConfigureScan(Environment e, uint score, uint theme, params JToken[] rows)
        {
            e.Http.Put(PatchAccount(e.Fixture["accounts"]["daily"], "ArenaDaily", ("score_qualified_players", Number(score, 4)), ("theme_qualified_players", Number(theme, 4))));
            e.Http.ScanRows = new JArray(rows.Select(row => new JObject { ["pubkey"] = row["address"], ["account"] = new JObject {
                ["owner"] = row["owner"], ["executable"] = row["executable"], ["lamports"] = 1, ["data"] = new JArray(row["data"], "base64") } }));
        }
        private static string PublicOwner(int index)
        { var bytes = new byte[32]; bytes[0] = (byte)index; bytes[1] = (byte)(index >> 8); return new Solana.Unity.Wallet.PublicKey(bytes).Key; }
        private static JObject ArenaRow(Environment e, int index, uint score, ulong theme, ulong finalized, string selectedOwner = null)
        {
            string owner = selectedOwner ?? PublicOwner(index);
            var row = PatchAccount(e.Fixture["arenaPlayer"], "ArenaPlayer", ("player", SolanaAddress.Bytes(owner)), ("rent_payer", SolanaAddress.Bytes(owner)),
                ("paid_entries", Number(1,4)), ("resolved_entries", Number(1,4)),
                ("has_score_best", new byte[] { (byte)(score > 0 ? 1 : 0) }), ("has_theme_best", new byte[] { (byte)(theme > 0 ? 1 : 0) }),
                ("score_best_run_id", Number(1,8)), ("theme_best_run_id", Number(1,8)),
                ("score_best_entry.player", SolanaAddress.Bytes(owner)), ("theme_best_entry.player", SolanaAddress.Bytes(owner)),
                ("score_best_entry.score", Number(score,4)), ("theme_best_entry.score", Number(score,4)),
                ("score_best_entry.objective_total", Number(theme,8)), ("theme_best_entry.objective_total", Number(theme,8)),
                ("score_best_entry.finalized_at", Number(finalized,8)), ("theme_best_entry.finalized_at", Number(finalized,8)));
            row["address"] = e.Addresses.ArenaPlayer(e.Addresses.Daily((uint)e.Fixture["inputs"]["day"]), owner); return row;
        }
        private static byte[] Number(ulong value, int width)
        { var bytes = new byte[width]; for (int i=0;i<width;i++) bytes[i]=(byte)(value>>(8*i)); return bytes; }
        // Test mutations locate fields through the real IDL rather than copied
        // offsets. The encoded base account is the existing Anchor fixture.
        private static readonly JObject MutationIdl = JObject.Parse(File.ReadAllText(Path.Combine(Root,"client/src/backend/solana/idl/solana.json")));
        private static JObject PatchAccount(JToken source, string account, params (string Path, byte[] Bytes)[] patches)
        {
            var output = (JObject)source.DeepClone(); byte[] data = Convert.FromBase64String((string)source["data"]);
            foreach (var patch in patches)
            {
                var located = Locate(account, patch.Path.Split('.'), 0, 8);
                if (located.Size != patch.Bytes.Length) throw new ArgumentException("Invalid test field width");
                Array.Copy(patch.Bytes,0,data,located.Offset,patch.Bytes.Length);
            }
            output["data"] = Convert.ToBase64String(data); return output;
        }
        private static (int Offset,int Size) Locate(string name, string[] path, int depth, int offset)
        {
            foreach (var field in MutationIdl["types"].Single(type=>(string)type["name"]==name)["type"]["fields"])
            {
                if ((string)field["name"]==path[depth]) return depth==path.Length-1 ? (offset,Size(field["type"]))
                    : Locate((string)field["type"]["defined"]["name"],path,depth+1,offset);
                offset += Size(field["type"]);
            }
            throw new ArgumentException("Unknown test fixture field");
        }
        private static int Size(JToken type)
        {
            if(type.Type==JTokenType.String) switch((string)type) {
                case "u8": case "bool": return 1; case "u16": return 2; case "u32": return 4;
                case "u64": case "i64": return 8; case "u128": return 16; case "pubkey": return 32; }
            if(type["array"]!=null) return Size(type["array"][0])*(int)type["array"][1];
            var definition=MutationIdl["types"].Single(item=>(string)item["name"]==(string)type["defined"]["name"])["type"];
            if((string)definition["kind"]=="enum") return 1;
            return definition["fields"].Sum(field=>Size(field["type"]));
        }
    }
}
