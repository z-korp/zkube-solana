using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.Client;
using ZKube.Integration.Transport;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        private const string Standings = "https://standings.invalid/";

        // A sealed score board holding the native plan's rows for this pool and
        // field. A pool that pays fewer places than qualified leaves the rest of
        // the field only in the public read model.
        private static uint SealScoreBoard(Environment e, uint day, ulong pool, uint qualified)
        {
            var source=e.Fixture["boardCases"].Single(row=>(string)row["kind"]=="score"&&(string)row["variant"]=="sealed");
            var width=NativeEngine.BoardWidth(pool,qualified); uint count=checked((uint)NativeWire.Read(width,0,4));
            var denominator=NativeWire.Bytes(width,4,16); ulong paid=0;
            for(uint rank=1;rank<=count;rank++) paid+=NativeEngine.PayoutForRank(pool,denominator,rank);
            var board=PatchAccount(source["envelope"],"ArenaBoard",("payout_count",Number(count,4)),("width_count",Number(count,4)),
                ("qualified_count",Number(qualified,4)),("denominator",denominator),("pool_lamports",Number(pool,8)),("paid_lamports",Number(paid,8)),
                ("rollover_lamports",Number(pool-paid,8)),("claimed_lamports",Number(0,8)),("claimed_count",Number(0,4)));
            int header=e.Accounts.FixedAccountBytes("ArenaBoard"),rowBytes=Size(new JObject{["defined"]=new JObject{["name"]="ArenaBoardEntry"}});
            byte[] prior=Convert.FromBase64String((string)board["data"]),data=new byte[header+rowBytes*(int)count+((int)count+7)/8];
            Array.Copy(prior,data,header);
            for(int row=0;row<count;row++) Array.Copy(prior,header,data,header+rowBytes*row,rowBytes);
            board["data"]=Convert.ToBase64String(data);
            for(uint row=0;row<count;row++){
                board=PatchBoardRow(e,board,row,"score",Number(1000-row,4));
                board=PatchBoardRow(e,board,row,"player",ZKube.Integration.SolanaAddress.Bytes(PublicOwner((int)row+1)));
            }
            e.Http.Put(board);
            e.Http.Put(PatchAccount(e.Fixture["accounts"]["oldDaily"],"ArenaDaily",("score_qualified_players",Number(qualified,4)),
                ("theme_qualified_players",Number(1,4)),("ledger.payout_lamports",Number(pool*2,8)),("ledger.rollover_out_lamports",Number(0,8))));
            return count;
        }
        private static JObject StandingRow(uint rank,string owner,ulong metric)=>
            new JObject{["rank"]=rank,["owner"]=owner,["metric"]=metric.ToString(),["finalizedAt"]=1,["paying"]=JValue.CreateNull()};
        private static JObject Answer(uint day,uint total,bool final=true,bool complete=true)=>
            new JObject{["dayId"]=day,["kind"]="score",["final"]=final,["complete"]=complete,["authority"]="none",["total"]=total};

        [Test] public async Task YourResultBelowThePaidRowsComesFromTheReadModelAndTheBoardStandsAloneWithoutIt()
        {
            var e=await Environment.Create(); uint day=(uint)e.Fixture["inputs"]["oldDay"];
            const uint qualified=150;
            uint paid=SealScoreBoard(e,day,40_000_000,qualified);
            Assert.That(paid,Is.GreaterThan(0).And.LessThan(qualified-StandingsTransport.PageRows),"the pool pays only some of the field");
            var rpc=new SolanaRpcTransport(e.Http.Transport,"https://base.invalid/","https://router.invalid/",e.Http.Genesis,new ZKube.Integration.Tests.TestBootstrap().Protocol.ProgramId);
            var queries=new ProductQueries(e.Identity,e.Accounts,e.Addresses,rpc,()=>e.Now,new StandingsTransport(e.Http.Transport,Standings));
            ulong last=1000-(paid-1);
            // The whole field below the paid rows; the owner stands beyond the first page.
            var field=Enumerable.Range((int)paid+1,(int)(qualified-paid)).Select(rank=>StandingRow((uint)rank,
                rank==qualified-3?e.Owner:PublicOwner(1000+rank),last-(ulong)(rank/10))).ToArray();
            Func<Uri,string> model=uri=>{
                if(uri.AbsolutePath.StartsWith("/v1/days/"+day+"/boards/theme")) throw new System.Net.Http.HttpRequestException("404");
                Assert.That(uri.AbsolutePath,Does.StartWith("/v1/days/"+day+"/boards/score"));
                var answer=Answer(day,qualified);
                if(uri.AbsolutePath.EndsWith("/players/"+e.Owner)) answer["row"]=field.Single(row=>(string)row["owner"]==e.Owner);
                else { Assert.That(uri.Query,Is.EqualTo("?offset="+paid+"&limit=100")); answer["rows"]=new JArray(field.Take(100)); }
                return answer.ToString();
            };
            e.Http.Transport.Read=model;
            var board=(await queries.SettledBoards(day)).Value.Score;
            Assert.That(board.Rows.Count,Is.EqualTo(paid)); Assert.That(board.Yours,Is.Null); Assert.That(board.ClaimStatus,Is.EqualTo("no-placement"));
            Assert.That(board.Unpaid.Select(row=>row.Rank),Is.EqualTo(Enumerable.Range((int)paid+1,100).Select(rank=>(uint)rank)));
            Assert.That(board.Standing.Rank,Is.EqualTo(qualified-3)); Assert.That(board.Standing.Player,Is.EqualTo(e.Owner));
            // Within the first page the same request answers both.
            field[2]["owner"]=e.Owner; field[qualified-3-paid-1]["owner"]=PublicOwner(999);
            int before=e.Http.Transport.Reads.Count;
            board=(await queries.SettledBoards(day)).Value.Score;
            Assert.That(board.Standing.Rank,Is.EqualTo(paid+3));
            Assert.That(e.Http.Transport.Reads.Count-before,Is.EqualTo(1),"the page of rows already names the owner");

            // Down, slow to fail, not final, incomplete, malformed, or contradicting the chain:
            // every time the page gets exactly the chain's board and nothing else.
            var contradictions=new List<Func<Uri,string>>{
                null,
                _=>"<html>",
                _=>"{}",
                uri=>{var answer=JObject.Parse(model(uri)); answer["final"]=false; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["complete"]=false; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["dayId"]=day+1; return answer.ToString();},
                // Another count than the board's own qualified count.
                uri=>{var answer=JObject.Parse(model(uri)); answer["total"]=qualified+1; return answer.ToString();},
                // A rank the board itself holds.
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["rank"]=paid; return answer.ToString();},
                // A result above the board's last paid row.
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["metric"]=(last+1).ToString(); return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["metric"]="0"; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["metric"]=1; return answer.ToString();},
                // A wallet the board already pays, a repeated wallet, a missing row, an invalid wallet, a rising metric.
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["owner"]=PublicOwner(1); return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][1]["owner"]=answer["rows"][0]["owner"]; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); ((JArray)answer["rows"]).RemoveAt(99); return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][5]["owner"]="not-a-wallet"; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][9]["metric"]=last.ToString(); answer["rows"][8]["metric"]="1"; return answer.ToString();},
            };
            var chain=(await new ProductQueries(e.Identity,e.Accounts,e.Addresses,rpc,()=>e.Now).SettledBoards(day)).Value.Score;
            foreach(var read in contradictions){
                e.Http.Transport.Read=read;
                var alone=(await queries.SettledBoards(day)).Value.Score;
                Assert.That(alone.Unpaid,Is.Empty); Assert.That(alone.Standing,Is.Null);
                Assert.That(alone.Status,Is.EqualTo(chain.Status)); Assert.That(alone.ClaimStatus,Is.EqualTo(chain.ClaimStatus));
                Assert.That(alone.Rows.Select(row=>(row.Rank,row.Record.Player,row.Metric,row.PayoutLamports)),
                    Is.EqualTo(chain.Rows.Select(row=>(row.Rank,row.Record.Player,row.Metric,row.PayoutLamports))));
            }
            // A rank answer that contradicts the page or the chain is dropped; the rows stay.
            field[2]["owner"]=PublicOwner(998);
            foreach(var (rank,metric) in new[]{(paid,1UL),(paid+50,1UL),(qualified+1,1UL),(qualified,last)}){
                e.Http.Transport.Read=uri=>{var answer=JObject.Parse(model(uri)); if(answer["row"]==null&&uri.AbsolutePath.Contains("/players/")) answer["row"]=null;
                    if(uri.AbsolutePath.EndsWith("/players/"+e.Owner)) answer["row"]=StandingRow(rank,e.Owner,metric); return answer.ToString();};
                var partial=(await queries.SettledBoards(day)).Value.Score;
                Assert.That(partial.Unpaid.Count,Is.EqualTo(100)); Assert.That(partial.Standing,Is.Null);
            }
            // A caller that cancels still cancels: only the read model's own failures are absorbed.
            using var cancelled=new System.Threading.CancellationTokenSource(); cancelled.Cancel();
            await ZKube.Integration.Tests.AsyncAssert.Throws<OperationCanceledException>(async()=>{await queries.SettledBoards(day,cancelled.Token);});
        }

        [Test] public async Task ABoardThatHoldsItsWholeFieldAsksTheReadModelNothing()
        {
            var e=await Environment.Create(); uint day=(uint)e.Fixture["inputs"]["oldDay"];
            var rpc=new SolanaRpcTransport(e.Http.Transport,"https://base.invalid/","https://router.invalid/",e.Http.Genesis,new ZKube.Integration.Tests.TestBootstrap().Protocol.ProgramId);
            var queries=new ProductQueries(e.Identity,e.Accounts,e.Addresses,rpc,()=>e.Now,new StandingsTransport(e.Http.Transport,Standings));
            e.Http.Transport.Read=_=>throw new InvalidOperationException("nothing is missing from this board");
            Assert.That(SealScoreBoard(e,day,1_000_000_000,3),Is.EqualTo(3));
            var boards=(await queries.SettledBoards(day)).Value;
            Assert.That(boards.Score.Rows.Count,Is.EqualTo(3)); Assert.That(boards.Score.Unpaid,Is.Empty);
            Assert.That(e.Http.Transport.Reads,Is.Empty);
            foreach(var endpoint in new[]{"http://standings.invalid/","https://user@standings.invalid/","https://standings.invalid/?key=1","standings"})
                Assert.Throws<FormatException>(()=>new StandingsTransport(e.Http.Transport,endpoint));
        }

        // The places after the first page come a hundred at a time, each page
        // held to the same agreement: ranks that follow on, results no higher
        // than the last one shown, no player twice. Anything else adds nothing.
        [Test] public async Task MorePlacesComeAHundredAtATimeAndOnlyWhereTheyFollowOn()
        {
            var e=await Environment.Create(); uint day=(uint)e.Fixture["inputs"]["oldDay"];
            const uint qualified=260;
            uint paid=SealScoreBoard(e,day,40_000_000,qualified);
            Assert.That(paid,Is.GreaterThan(0).And.LessThan(qualified-2*StandingsTransport.PageRows),"the field runs past two pages");
            var rpc=new SolanaRpcTransport(e.Http.Transport,"https://base.invalid/","https://router.invalid/",e.Http.Genesis,new ZKube.Integration.Tests.TestBootstrap().Protocol.ProgramId);
            var queries=new ProductQueries(e.Identity,e.Accounts,e.Addresses,rpc,()=>e.Now,new StandingsTransport(e.Http.Transport,Standings));
            ulong last=1000-(paid-1);
            var field=Enumerable.Range((int)paid+1,(int)(qualified-paid)).Select(rank=>StandingRow((uint)rank,
                rank==qualified?e.Owner:PublicOwner(1000+rank),last-(ulong)(rank/10))).ToArray();
            Func<Uri,string> model=uri=>{
                if(uri.AbsolutePath.StartsWith("/v1/days/"+day+"/boards/theme")) throw new System.Net.Http.HttpRequestException("404");
                var answer=Answer(day,qualified);
                if(uri.AbsolutePath.EndsWith("/players/"+e.Owner)) { answer["row"]=field[field.Length-1]; return answer.ToString(); }
                int offset=int.Parse(System.Text.RegularExpressions.Regex.Match(uri.Query,"^\\?offset=([0-9]+)&limit=100$").Groups[1].Value);
                answer["rows"]=new JArray(field.Skip(offset-(int)paid).Take(100)); return answer.ToString();
            };
            e.Http.Transport.Read=model;
            var board=(await queries.SettledBoards(day)).Value.Score;
            Assert.That(board.Unpaid.Count,Is.EqualTo(100)); Assert.That(board.PlacesBeyond,Is.EqualTo(qualified-paid-100));

            // No answer, or one that does not follow on from what is shown, adds nothing.
            var wrong=new List<Func<Uri,string>>{
                null,
                _=>"{}",
                uri=>{var answer=JObject.Parse(model(uri)); answer["total"]=qualified+1; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["rank"]=paid+100; return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["metric"]=(last+1).ToString(); return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["owner"]=PublicOwner(1000+(int)paid+1); return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); answer["rows"][0]["owner"]=PublicOwner(1); return answer.ToString();},
                uri=>{var answer=JObject.Parse(model(uri)); ((JArray)answer["rows"]).RemoveAt(99); return answer.ToString();},
            };
            foreach(var read in wrong){
                e.Http.Transport.Read=read;
                Assert.That(await queries.MoreStandings(board),Is.Zero); Assert.That(board.Unpaid.Count,Is.EqualTo(100));
            }
            e.Http.Transport.Read=model;
            Assert.That(await queries.MoreStandings(board),Is.EqualTo(100)); Assert.That(board.PlacesBeyond,Is.EqualTo(qualified-paid-200));
            Assert.That(await queries.MoreStandings(board),Is.EqualTo(qualified-paid-200));
            Assert.That(board.Unpaid.Select(row=>row.Rank),Is.EqualTo(Enumerable.Range((int)paid+1,(int)(qualified-paid)).Select(rank=>(uint)rank)));
            Assert.That(board.PlacesBeyond,Is.Zero);
            // With every place shown there is nothing left to ask for.
            int before=e.Http.Transport.Reads.Count;
            Assert.That(await queries.MoreStandings(board),Is.Zero); Assert.That(e.Http.Transport.Reads.Count,Is.EqualTo(before));
        }
    }
}
