using ZKube.Integration.Tests;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        private static string Root => Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath,"../.."));
        private static JObject Fixture() => ZKube.Integration.Tests.ProgramScenarios.Load("reads");
        private static string PublicOwner(int index)
        { var bytes = new byte[32]; bytes[0] = (byte)index; bytes[1] = (byte)(index >> 8); return new Solana.Unity.Wallet.PublicKey(bytes).Key; }
        private static byte[] Number(ulong value, int width)
        { var bytes = new byte[width]; for (int i=0;i<width;i++) bytes[i]=(byte)(value>>(8*i)); return bytes; }
        // Test mutations locate fields through the real IDL rather than copied
        // offsets. The encoded base account is the existing Anchor fixture.
        private static readonly JObject MutationIdl = JObject.Parse(ZKube.Integration.Tests.TestBootstrap.ProtocolJson);
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
        private sealed class Environment
        {
            public JObject Fixture; public Http Http; public ProductQueries Queries; public AccountBindings Accounts; public TransactionPlanner Addresses;
            public ClientIdentity Identity; public TestNative Wallet; public long Now; public string Owner;
            public static async Task<Environment> Create()
            {
                var e = new Environment { Fixture = ProductReadTests.Fixture() }; e.Owner = (string)e.Fixture["inputs"]["owner"]; e.Now = (long)e.Fixture["inputs"]["now"];
                var bootstrap = new TestBootstrap(); var protocol = bootstrap.Protocol; var sessions = bootstrap.Tokens;
                e.Accounts = bootstrap.Accounts;
                e.Wallet = new TestNative { Owner = e.Owner, ForbidKeyReads = true }; e.Identity = new ClientIdentity(new WalletClient(e.Wallet)); await e.Identity.Connect();
                e.Http = new Http(); foreach (var property in ((JObject)e.Fixture["accounts"]).Properties())
                    if (property.Value is JArray list) foreach (var row in list) e.Http.Put(row); else e.Http.Put(property.Value);
                var rpc = new SolanaRpcTransport(e.Http.Transport,"https://base.invalid/","https://router.invalid/",e.Http.Genesis,protocol.ProgramId);
                e.Addresses = bootstrap.Planner;
                e.Queries = new ProductQueries(e.Identity,e.Accounts,e.Addresses,rpc,()=>e.Now);
                return e;
            }
        }
        private sealed class Http
        {
            public readonly TestHttp Transport;
            public Http() { Transport = new TestHttp { Reply = Respond }; }

            public readonly string Genesis = "11111111111111111111111111111111";
            public readonly List<string> Methods = new List<string>();
            public System.Collections.Concurrent.ConcurrentQueue<JObject> Requests => Transport.Requests;
            public string WaitMethod = "getAccountInfo";
            private readonly Dictionary<string,JToken> data = new Dictionary<string,JToken>();
            public TaskCompletionSource<bool> Wait; public readonly TaskCompletionSource<bool> Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            public void Put(JToken row) { if (row?["address"] != null) data[(string)row["address"]] = row.DeepClone(); }
            public void Remove(JToken row) => data.Remove((string)row["address"]);
            private JToken Account(string address) => data.TryGetValue(address,out var row) ? new JObject { ["owner"] = row["owner"], ["executable"] = row["executable"],
                ["data"] = new JArray(row["data"],"base64"), ["lamports"] = 1, ["rentEpoch"] = 0 } : JValue.CreateNull();
            private async Task<JToken> Respond(Uri endpoint, JObject request, CancellationToken cancellation)
            {
                string method = (string)request["method"]; Methods.Add(method);
                if (method == WaitMethod && Wait != null) { Entered.TrySetResult(true); await Wait.Task; }
                JToken result;
                if (method == "getGenesisHash") result = Genesis;
                else if (method == "getAccountInfo") result = new JObject { ["context"] = new JObject { ["slot"] = 100 }, ["value"] = Account((string)request["params"][0]) };
                else if (method == "getMultipleAccounts") result = new JObject { ["context"] = new JObject { ["slot"] = 100 }, ["value"] = new JArray(request["params"][0].Select(address => Account((string)address))) };
                else throw new Exception("Forbidden product-query RPC: " + method);
                return result;
            }
        }
    }
}
