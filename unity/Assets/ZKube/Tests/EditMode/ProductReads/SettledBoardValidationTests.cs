using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        [Test] public async Task BoardConstructionCursorAndSealStateMatchTheProgramExactly()
        {
            var e=await Environment.Create(); uint day=(uint)e.Fixture["inputs"]["oldDay"];
            var source=(JObject)e.Fixture["boardCases"].Single(row=>(string)row["kind"]=="score"&&(string)row["variant"]=="sealed")["envelope"];
            Assert.That(e.Accounts.ArenaBoard(Envelope(source),day,"score").Sealed,Is.True);
            foreach(var bad in new[]{
                PatchAccount(source,"ArenaBoard",("cursor",Number(0,4))),
                PatchAccount(source,"ArenaBoard",("sealed",new byte[]{0}),("sealed_at",Number(0,8))),
                PatchAccount(source,"ArenaBoard",("sealed",new byte[]{0}),("cursor",Number(0,4)),("sealed_at",Number(ulong.MaxValue,8))),
                PatchAccount(source,"ArenaBoard",("width_count",Number(0,4))),
                PatchAccount(source,"ArenaBoard",("qualified_count",Number(0,4))),
                PatchAccount(source,"ArenaBoard",("capacity_limited",new byte[]{1})) })
                Assert.Throws<FormatException>(()=>e.Accounts.ArenaBoard(Envelope(bad),day,"score"));
            var constructing=PatchAccount(source,"ArenaBoard",("sealed",new byte[]{0}),("cursor",Number(0,4)),("sealed_at",Number(0,8)));
            Assert.Throws<FormatException>(() => e.Accounts.ArenaBoard(Envelope(constructing), day, "score"));
            constructing = ConstructionPrefix(e, constructing, 0);
            Assert.That(e.Accounts.ArenaBoard(Envelope(constructing),day,"score").Sealed,Is.False);
            var two=TwoRows(e,source);
            var partial=PatchAccount(two,"ArenaBoard",("sealed",new byte[]{0}),("cursor",Number(1,4)),("sealed_at",Number(0,8)));
            partial = ConstructionPrefix(e, partial, 1);
            Assert.That(e.Accounts.ArenaBoard(Envelope(partial),day,"score").Rows,Is.Empty,"validated prefix is not claimable before automatic sealing");
            var empty=PatchAccount(source,"ArenaBoard",("payout_count",Number(0,4)),("width_count",Number(0,4)),("qualified_count",Number(0,4)),
                ("cursor",Number(0,4)),("denominator",new byte[16]));
            empty["data"]=Convert.ToBase64String(Convert.FromBase64String((string)empty["data"]).Take(e.Accounts.FixedAccountBytes("ArenaBoard")).ToArray());
            var initialized=e.Accounts.ArenaBoard(Envelope(empty),day,"score");
            Assert.That(initialized.Sealed,Is.True); Assert.That(initialized.Rows,Is.Empty,"zero payout allocation is sealed on initialization");
        }

        [Test] public async Task SealedAndWrittenPrefixRowsRequirePositiveMetricsAndCanonicalOrdering()
        {
            var e=await Environment.Create(); uint day=(uint)e.Fixture["inputs"]["oldDay"];
            var source=(JObject)e.Fixture["boardCases"].Single(row=>(string)row["kind"]=="score"&&(string)row["variant"]=="sealed")["envelope"];
            var valid=TwoRows(e,source); Assert.That(e.Accounts.ArenaBoard(Envelope(valid),day,"score").Rows.Count,Is.EqualTo(2));
            var badTime=PatchBoardRow(e,valid,1,"score",Number(10,4)); badTime=PatchBoardRow(e,badTime,1,"finalized_at",Number(1,8));
            var badWallet=PatchBoardRow(e,valid,0,"player",ZKube.Integration.SolanaAddress.Bytes(PublicOwner(255)));
            badWallet=PatchBoardRow(e,badWallet,1,"score",Number(10,4));
            foreach(var bad in new[]{PatchBoardRow(e,valid,0,"score",Number(0,4)),PatchBoardRow(e,valid,1,"score",Number(11,4)),
                PatchBoardRow(e,valid,0,"finalized_at",Number(ulong.MaxValue,8)),badTime,badWallet})
                Assert.Throws<FormatException>(()=>e.Accounts.ArenaBoard(Envelope(bad),day,"score"));
            var badPrefix=PatchAccount(PatchBoardRow(e,valid,0,"score",Number(0,4)),"ArenaBoard",("sealed",new byte[]{0}),("cursor",Number(1,4)),("sealed_at",Number(0,8)));
            badPrefix = ConstructionPrefix(e, badPrefix, 1);
            Assert.Throws<FormatException>(()=>e.Accounts.ArenaBoard(Envelope(badPrefix),day,"score"));
            var theme=(JObject)e.Fixture["boardCases"].Single(row=>(string)row["kind"]=="theme"&&(string)row["variant"]=="sealed")["envelope"];
            Assert.Throws<FormatException>(()=>e.Accounts.ArenaBoard(Envelope(PatchBoardRow(e,theme,0,"objective_total",Number(0,8))),day,"theme"));
        }

        [Test] public async Task ClaimablePayoutRequiresNativePlanAndFinalizedDailyEconomicBinding()
        {
            var e=await Environment.Create(); uint day=(uint)e.Fixture["inputs"]["oldDay"];
            var board=(JObject)e.Fixture["boardCases"].Single(row=>(string)row["kind"]=="score"&&(string)row["variant"]=="sealed")["envelope"];
            var width=NativeEngine.BoardWidth(1000000000,1); var denominator=NativeWire.Bytes(width,4,16);
            ulong paid=NativeEngine.PayoutForRank(1000000000,denominator,1);
            board=PatchAccount(board,"ArenaBoard",("denominator",denominator),("paid_lamports",Number(paid,8)),("rollover_lamports",Number(1000000000-paid,8)),("claimed_lamports",Number(0,8)));
            var daily=PatchAccount(e.Fixture["accounts"]["oldDaily"],"ArenaDaily",("score_qualified_players",Number(1,4)),("theme_qualified_players",Number(1,4)),
                ("ledger.payout_lamports",Number(2000000000,8)),("ledger.rollover_out_lamports",Number(0,8)));
            e.Http.Put(daily); e.Http.Put(board);
            var result=(await e.Queries.SettledBoards(day)).Value;
            Assert.That(result.Score.ClaimStatus,Is.EqualTo("claimable")); Assert.That(result.Score.Yours.PayoutLamports,Is.EqualTo(paid));
            foreach(var bad in new[]{PatchAccount(board,"ArenaBoard",("pool_lamports",Number(1000000001,8))),
                PatchAccount(board,"ArenaBoard",("paid_lamports",Number(0,8))),PatchAccount(board,"ArenaBoard",("rollover_lamports",Number(1,8))),
                PatchAccount(board,"ArenaBoard",("claimed_lamports",Number(1,8))),PatchAccount(board,"ArenaBoard",("denominator",new byte[16]))}) {
                e.Http.Put(bad); await Failure<FormatException>(async()=>{await e.Queries.SettledBoards(day);});
            }
            e.Http.Put(board);
            foreach(var bad in new[]{PatchAccount(daily,"ArenaDaily",("score_qualified_players",Number(2,4))),
                PatchAccount(daily,"ArenaDaily",("ledger.payout_lamports",Number(2000000002,8))),PatchAccount(daily,"ArenaDaily",("status",new byte[]{1}))}) {
                e.Http.Put(bad); await Failure<FormatException>(async()=>{await e.Queries.SettledBoards(day);});
            }
            e.Http.Remove(daily); Assert.That((await e.Queries.SettledBoards(day)).Value.Score.ClaimStatus,Is.EqualTo("unavailable"));
        }

        private static JObject ConstructionPrefix(Environment e, JObject source, uint cursor)
        {
            var result = (JObject)source.DeepClone();
            byte[] data = Convert.FromBase64String((string)source["data"]);
            var countField = Locate("ArenaBoard", new[] { "payout_count" }, 0, 8);
            uint count = BitConverter.ToUInt32(data, countField.Offset);
            int rowBytes = Size(new JObject { ["defined"] = new JObject { ["name"] = "ArenaBoardEntry" } });
            int prefixBytes = checked(e.Accounts.FixedAccountBytes("ArenaBoard") + (int)cursor * rowBytes);
            result["data"] = Convert.ToBase64String(data.Take(prefixBytes).Concat(new byte[(count + 7) / 8]).ToArray());
            return result;
        }

        private static JObject TwoRows(Environment e,JObject source)
        {
            int header=e.Accounts.FixedAccountBytes("ArenaBoard"),rowBytes=Size(new JObject{["defined"]=new JObject{["name"]="ArenaBoardEntry"}});
            var result=PatchAccount(source,"ArenaBoard",("payout_count",Number(2,4)),("width_count",Number(2,4)),("qualified_count",Number(2,4)),("cursor",Number(2,4)));
            byte[] prior=Convert.FromBase64String((string)result["data"]),data=new byte[header+rowBytes*2+1];
            Array.Copy(prior,data,header+rowBytes); Array.Copy(prior,header,data,header+rowBytes,rowBytes); result["data"]=Convert.ToBase64String(data);
            result=PatchBoardRow(e,result,0,"score",Number(10,4)); result=PatchBoardRow(e,result,1,"score",Number(5,4));
            result=PatchBoardRow(e,result,0,"player",ZKube.Integration.SolanaAddress.Bytes(PublicOwner(1)));
            return PatchBoardRow(e,result,1,"player",ZKube.Integration.SolanaAddress.Bytes(PublicOwner(2)));
        }
        private static JObject PatchBoardRow(Environment e,JObject source,uint position,string field,byte[] value)
        {
            var result=(JObject)source.DeepClone(); byte[] data=Convert.FromBase64String((string)source["data"]);
            int width=Size(new JObject{["defined"]=new JObject{["name"]="ArenaBoardEntry"}});
            var location=Locate("ArenaBoardEntry",new[]{field},0,checked(e.Accounts.FixedAccountBytes("ArenaBoard")+(int)position*width));
            if(value.Length!=location.Size)throw new ArgumentException("Wrong row mutation width");
            Array.Copy(value,0,data,location.Offset,value.Length); result["data"]=Convert.ToBase64String(data); return result;
        }
    }
}
