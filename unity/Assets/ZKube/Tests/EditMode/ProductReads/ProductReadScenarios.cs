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
        private static async Task<T> Failure<T>(Func<Task> action) where T : Exception
        { try { await action(); } catch (T error) { return error; } Assert.Fail("Expected " + typeof(T).Name); return null; }
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
        private static readonly JObject MutationIdl = JObject.Parse(File.ReadAllText(Path.Combine(Root,"tools/chain/idl/solana.json")));
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
            public ClientIdentity Identity; public Wallet Wallet; public long Now; public string Owner;
            public static async Task<Environment> Create()
            {
                var e = new Environment { Fixture = ProductReadTests.Fixture() }; e.Owner = (string)e.Fixture["inputs"]["owner"]; e.Now = (long)e.Fixture["inputs"]["now"];
                string idl = File.ReadAllText(Path.Combine(Root, "tools/chain/idl/solana.json"));
                var protocol = new ProtocolBindings(idl); var sessions = new SessionTokenBindings(File.ReadAllText(Path.Combine(Root,"unity/Assets/ZKube/Integration/Generated/session.json")));
                e.Accounts = new AccountBindings(idl,Protocol.PlayerStateAccountVersion,Protocol.ProtocolAccountVersion);
                e.Wallet = new Wallet { Owner = e.Owner }; e.Identity = new ClientIdentity(new WalletClient(e.Wallet)); await e.Identity.Connect();
                e.Http = new Http(); foreach (var property in ((JObject)e.Fixture["accounts"]).Properties())
                    if (property.Value is JArray list) foreach (var row in list) e.Http.Put(row); else e.Http.Put(property.Value);
                var rpc = new SolanaRpcTransport(e.Http,"https://base.invalid/","https://router.invalid/",e.Http.Genesis,protocol.ProgramId);
                e.Addresses = new TransactionPlanner(protocol,sessions);
                e.Queries = new ProductQueries(e.Identity,e.Accounts,e.Addresses,rpc,()=>e.Now);
                return e;
            }
        }
        private sealed class Wallet : INativeWalletTransport
        {
            public string Owner;
            public Task<string> Request(string json)
            {
                var request = JObject.Parse(json); string operation = (string)request["operation"];
                if (operation != "authorize" && operation != "disconnect") throw new Exception("Product reads cannot sign");
                return Task.FromResult(new JObject { ["requestId"] = request["requestId"], ["ok"] = true,
                    ["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(Owner)) }.ToString());
            }
            public Task<byte[]> LoadDeviceSeed(string owner) => throw new Exception("No device key in product queries");
            public Task<byte[]> CreateDeviceSeed(string owner) => throw new Exception("No device key in product queries");
            public Task RemoveDeviceSeed(string owner) => throw new Exception("No device key in product queries");
        }
        private sealed class Http : IJsonRpcHttp
        {
            public readonly string Genesis = "11111111111111111111111111111111";
            public readonly List<string> Methods = new List<string>();
            public readonly List<JObject> Requests = new List<JObject>();
            public string WaitMethod = "getAccountInfo";
            private readonly Dictionary<string,JToken> data = new Dictionary<string,JToken>();
            public TaskCompletionSource<bool> Wait; public readonly TaskCompletionSource<bool> Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            public void Put(JToken row) { if (row?["address"] != null) data[(string)row["address"]] = row.DeepClone(); }
            public void Remove(JToken row) => data.Remove((string)row["address"]);
            private JToken Account(string address) => data.TryGetValue(address,out var row) ? new JObject { ["owner"] = row["owner"], ["executable"] = row["executable"],
                ["data"] = new JArray(row["data"],"base64"), ["lamports"] = 1, ["rentEpoch"] = 0 } : JValue.CreateNull();
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                var request = JObject.Parse(json); string method = (string)request["method"]; Methods.Add(method);
                Requests.Add(request);
                if (method == WaitMethod && Wait != null) { Entered.TrySetResult(true); await Wait.Task; }
                JToken result;
                if (method == "getGenesisHash") result = Genesis;
                else if (method == "getAccountInfo") result = new JObject { ["context"] = new JObject { ["slot"] = 100 }, ["value"] = Account((string)request["params"][0]) };
                else if (method == "getMultipleAccounts") result = new JObject { ["context"] = new JObject { ["slot"] = 100 }, ["value"] = new JArray(request["params"][0].Select(address => Account((string)address))) };
                else throw new Exception("Forbidden product-query RPC: " + method);
                string response = new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
                return response;
            }
        }
    }
}
