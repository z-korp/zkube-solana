using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        [Test] public async Task ProvisionalRowsMatchActualKeeperScannerAndComparatorOracle()
        {
            var e=await Environment.Create();
            var oracle=JObject.Parse(File.ReadAllText(Path.Combine(Root,"fixtures/unity-provisional-boards-v1.json")));
            ConfigureScan(e,(uint)oracle["score"].Count(),(uint)oracle["theme"].Count(),oracle["accounts"].ToArray());
            Assert.That(ZKube.Integration.Transport.SolanaRpcTransport.MaximumArenaPlayerAccounts,Is.EqualTo((int)oracle["maximumScanAccounts"]));
            var actual=(await e.Queries.CurrentProvisionalBoards()).Value;
            Assert.That(actual.Complete,Is.True);
            foreach(var board in new[]{(Kind:"score",Rows:actual.Score),(Kind:"theme",Rows:actual.Theme)}) {
                Assert.That(board.Rows.Count,Is.EqualTo(oracle[board.Kind].Count()));
                foreach(var row in board.Rows) {
                    var expected=oracle[board.Kind][(int)row.Rank-1];
                    Assert.That(row.Owner,Is.EqualTo((string)expected["owner"]));
                    Assert.That(row.Source,Is.EqualTo((string)expected["source"]));
                    Assert.That(row.Score,Is.EqualTo((uint)expected["score"]));
                    Assert.That(row.ObjectiveTotal,Is.EqualTo((ulong)expected["objectiveTotal"]));
                    Assert.That(row.FinalizedAt,Is.EqualTo((long)expected["finalizedAt"]));
                }
            }
            Assert.That(actual.Score.Last().FinalizedAt,Is.EqualTo((long)oracle["timestampBoundary"]["maximumAccepted"]));
            foreach(var invalid in oracle["timestampBoundary"]["invalidCases"]) {
                ConfigureScan(e,1,1,invalid["envelope"]);
                await Failure<FormatException>(async()=>{await e.Queries.CurrentProvisionalBoards();});
            }
        }
    }
}
