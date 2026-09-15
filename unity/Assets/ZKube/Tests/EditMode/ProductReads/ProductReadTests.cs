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
        [Test] public async Task CampaignAndProfileMatchActualTypeScriptAndReturnIsolatedValues()
        {
            var e = await Environment.Create();
            var read = await e.Queries.Campaign(); var expected = e.Fixture["campaign"];
            Assert.That(read.Value.Status, Is.EqualTo("ready"));
            Assert.That(read.Value.TotalStars, Is.EqualTo((int)e.Fixture["profile"]["totalStars"]));
            foreach (var map in read.Value.Maps)
            {
                var row = expected[map.MapId - 1];
                Assert.That(map.Stars, Is.EqualTo(row["levelStars"].Values<byte>()));
                Assert.That(map.Unlocked, Is.EqualTo((bool)row["unlocked"]));
                Assert.That(map.Cleared, Is.EqualTo((bool)row["cleared"]));
                Assert.That(map.Perfected, Is.EqualTo((bool)row["perfected"]));
            }
            var profile = (await e.Queries.Profile()).Value;
            Assert.That(profile.CurrentTier, Is.EqualTo((byte)e.Fixture["profile"]["tier"]));
            Assert.That(profile.HighestTier, Is.EqualTo((byte)e.Fixture["profile"]["highest"]));
            Assert.That(profile.WornTier, Is.EqualTo((byte)e.Fixture["profile"]["worn"]));
            profile.Fields["ladder_points"] = 0;
            Assert.That(profile.LadderPoints.ToString(), Is.EqualTo((string)e.Fixture["profile"]["points"]));
            read.Value.Maps[0].Catalog["enabled"] = false;
            Assert.That(read.Value.Maps[0].Catalog["enabled"].Value<bool>(), Is.True);
        }

        [Test] public async Task CurrentDailyUsesActualDrawAndLedgerWithNoFollowingContentInResult()
        {
            var e = await Environment.Create(); var daily = (await e.Queries.CurrentDaily()).Value;
            Assert.That(daily.DayId, Is.EqualTo((uint)e.Fixture["inputs"]["day"]));
            Assert.That(daily.Realm, Is.EqualTo((byte)e.Fixture["daily"]["realm"]));
            Assert.That(daily.ObjectiveKind, Is.EqualTo((byte)e.Fixture["daily"]["objective"]["kind"]));
            Assert.That(daily.ObjectiveValue, Is.EqualTo((byte)e.Fixture["daily"]["objective"]["value"]));
            Assert.That(daily.PotLamports.ToString(), Is.EqualTo((string)e.Fixture["daily"]["pool"]));
            Assert.That(daily.Status, Is.EqualTo((string)e.Fixture["daily"]["status"]));
            CollectionAssert.AreEquivalent(new[] { e.Addresses.ProtocolAddress, e.Addresses.ArcadeAddress,
                e.Addresses.Daily(daily.DayId), e.Addresses.Player(e.Owner),
                e.Addresses.ArenaPlayer(e.Addresses.Daily(daily.DayId), e.Owner) },
                e.Http.Requests.Where(request => (string)request["method"] == "getMultipleAccounts")
                    .SelectMany(request => request["params"][0].Values<string>()).Distinct().ToArray());
            Assert.That(e.Http.Methods.All(method => method == "getGenesisHash" || method == "getMultipleAccounts"), Is.True);
        }

        [Test] public async Task DailyPublicationFixtureAgreesWithGeneratedBindingsAndNativeCoreAndRejectsOriginalMismatch()
        {
            var e = await Environment.Create(); var authority = e.Fixture["dailyAuthority"];
            uint day = (uint)authority["day"], pair = NativeEngine.DailyPairIndex(day);
            Assert.That(pair, Is.EqualTo((uint)authority["pairIndex"]), "native draw vs actual TS core result");
            Assert.That(Protocol.CampaignContentVersion, Is.EqualTo((uint)authority["contentVersion"]), "generated C# vs TS publication identity");
            Assert.That(Protocol.DailyMaxMoves, Is.EqualTo((uint)authority["maxMoves"]), "generated C# vs TS pressure limit");
            Assert.That(pair / Protocol.DailyThemes.Length + 1, Is.EqualTo((uint)authority["realm"]));
            var theme = Protocol.DailyThemes[pair % Protocol.DailyThemes.Length];
            Assert.That(theme[0], Is.EqualTo((byte)authority["objective"]["kind"]));
            Assert.That(theme[1], Is.EqualTo((byte)authority["objective"]["value"]));
            var malformed = e.Fixture["invalidAccounts"]["dailyContentVersion"];
            var invalid = e.Accounts.ArenaDaily(Envelope(malformed), day);
            var protocol = e.Accounts.ProtocolConfig(Envelope(e.Fixture["accounts"]["protocol"]));
            Assert.That((uint)invalid["content_version"], Is.EqualTo(0), "original omitted/zero-filled version");
            Assert.That((uint)protocol["content_version"], Is.EqualTo(Protocol.CampaignContentVersion));
            var valid = e.Accounts.ArenaDaily(Envelope(e.Fixture["accounts"]["daily"]), day);
            var normalizedInvalid = (JObject)invalid.DeepClone(); normalizedInvalid["content_version"] = valid["content_version"];
            Assert.That(JToken.DeepEquals(normalizedInvalid, valid), Is.True, "only the historical missing version differs");
            e.Http.Put(malformed);
            var versionError = await Failure<FormatException>(async () => { await e.Queries.CurrentDaily(); });
            Assert.That(versionError.Message, Is.EqualTo("Daily content version differs from protocol: expected " + Protocol.CampaignContentVersion + ", observed 0"));
            e.Http.Put(e.Fixture["invalidAccounts"]["dailyMoveLimit"]);
            var movesError = await Failure<FormatException>(async () => { await e.Queries.CurrentDaily(); });
            Assert.That(movesError.Message, Does.StartWith("Daily move limit differs from protocol:"));
            e.Http.Put(e.Fixture["invalidAccounts"]["dailyDraw"]);
            var drawError = await Failure<FormatException>(async () => { await e.Queries.CurrentDaily(); });
            Assert.That(drawError.Message, Is.EqualTo("Daily content disagrees with the protocol draw"));
            e.Http.Put(e.Fixture["accounts"]["daily"]);
            Assert.That((await e.Queries.CurrentDaily()).Value.Status, Is.EqualTo("open"));
        }

        [Test] public async Task ExplicitOldBoardClaimsUseIndependentSealingWindowsAndNativePayouts()
        {
            var e = await Environment.Create(); uint day = (uint)e.Fixture["inputs"]["oldDay"];
            foreach (var row in e.Fixture["boardCases"])
            {
                e.Http.Put(row["daily"]);
                e.Http.Put(row["envelope"]);
                var result = (await e.Queries.SettledBoards(day)).Value;
                var actual = (string)row["kind"] == "score" ? result.Score : result.Theme;
                string variant = (string)row["variant"];
                Assert.That(actual.Status, Is.EqualTo(variant == "unsealed" ? "unsealed" : variant == "empty" ? "empty" : (string)row["status"]));
                Assert.That(actual.Rows.Count, Is.EqualTo(row["rows"].Count()));
                foreach (var item in actual.Rows)
                {
                    var expected = row["rows"][(int)item.Record.Position];
                    Assert.That(item.Metric.ToString(), Is.EqualTo((string)expected["metric"]));
                    Assert.That(item.PayoutLamports.ToString(), Is.EqualTo((string)expected["payoutLamports"]));
                }
                Assert.That(actual.ClaimStatus, Is.EqualTo(variant == "sealed" ? "claimable" : variant == "empty" ? "not-ranked" : variant));
                // Each case has its own finalized Daily economics. Do not
                // carry its board into the next case's different pool/field.
                e.Http.Remove(row["envelope"]);
            }
            e.Http.Put(e.Fixture["accounts"]["oldDaily"]);
            e.Http.Put(e.Fixture["boardCases"].Single(row => (string)row["kind"] == "score" && (string)row["variant"] == "sealed")["envelope"]);
            e.Http.Put(e.Fixture["boardCases"].Single(row => (string)row["kind"] == "theme" && (string)row["variant"] == "expired")["envelope"]);
            var independent = (await e.Queries.SettledBoards(day)).Value;
            Assert.That(independent.Score.ClaimStatus, Is.EqualTo("claimable"));
            Assert.That(independent.Theme.ClaimStatus, Is.EqualTo("expired"));
            e.Now = independent.Score.ExpiresAt.Value;
            Assert.That((await e.Queries.SettledBoards(day)).Value.Score.ClaimStatus, Is.EqualTo("claimable"));
            e.Now++;
            Assert.That((await e.Queries.SettledBoards(day)).Value.Score.ClaimStatus, Is.EqualTo("expired"));
        }

        [Test] public async Task MissingPlayerCatalogAndBoardRemainDifferentFromEmptySealedResults()
        {
            var e = await Environment.Create(); e.Http.Remove(e.Fixture["accounts"]["player"]);
            var campaign = (await e.Queries.Campaign()).Value;
            Assert.That(campaign.Player.Exists, Is.False); Assert.That(campaign.Maps[0].Unlocked, Is.True);
            Assert.That(campaign.Maps.Skip(1).All(map => !map.Unlocked), Is.True);
            e.Http.Remove(e.Fixture["accounts"]["catalogs"][0]);
            campaign = (await e.Queries.Campaign()).Value;
            Assert.That(campaign.Status, Is.EqualTo("missing-catalog")); Assert.That(campaign.TotalStars, Is.Null);
            var board = (await e.Queries.SettledBoards((uint)e.Fixture["inputs"]["oldDay"])).Value;
            Assert.That(board.Score.Status, Is.EqualTo("missing")); Assert.That(board.Score.ClaimStatus, Is.EqualTo("unavailable"));
        }

        [Test] public async Task DailyFundingFreezeFinalizationSuspensionAndPauseAreExplicit()
        {
            var e = await Environment.Create();
            foreach (var test in e.Fixture["statusCases"])
            {
                e.Now = (long)test["now"]; e.Http.Put(test["daily"]);
                Assert.That((await e.Queries.CurrentDaily()).Value.Status, Is.EqualTo((string)test["expected"]));
            }
            e.Now = (long)e.Fixture["inputs"]["now"]; e.Http.Put(e.Fixture["accounts"]["daily"]); e.Http.Put(e.Fixture["suspendedArcade"]);
            var suspended = (await e.Queries.CurrentDaily()).Value;
            Assert.That(suspended.Suspended, Is.EqualTo(!(bool)e.Fixture["scheduled"])); Assert.That(suspended.Status, Is.EqualTo("suspended"));
            e.Http.Remove(e.Fixture["accounts"]["daily"]);
            suspended = (await e.Queries.CurrentDaily()).Value;
            Assert.That(suspended.Status, Is.EqualTo("suspended")); Assert.That(suspended.Daily, Is.Null);
            e.Http.Put(e.Fixture["accounts"]["arcade"]); e.Http.Put(e.Fixture["accounts"]["daily"]); e.Http.Put(e.Fixture["pausedProtocol"]);
            Assert.That((await e.Queries.CurrentDaily()).Value.Status, Is.EqualTo("paused"));
        }

        [Test] public async Task CatalogAndArenaPlayerRelationshipsRejectSubstitutedAccounts()
        {
            var e = await Environment.Create(); e.Http.Put(e.Fixture["arenaPlayer"]);
            Assert.That((await e.Queries.CurrentDaily()).Value.DailyPlayer["paid_entries"].Value<uint>(), Is.EqualTo(3));
            foreach (var key in new[] { "catalogMap", "catalogVersion" })
            {
                e.Http.Put(e.Fixture["invalidAccounts"][key]);
                await Failure<FormatException>(async () => { await e.Queries.Campaign(); });
            }
            foreach (var key in new[] { "arenaOwner", "arenaChallenge" })
            {
                e.Http.Put(e.Fixture["invalidAccounts"][key]);
                await Failure<FormatException>(async () => { await e.Queries.CurrentDaily(); });
            }
        }

        [Test] public async Task SpectatorSnapshotsMatchTsAndUseNativeStateWithoutChangingRunSlots()
        {
            var e = await Environment.Create();
            foreach (var expected in e.Fixture["spectatorCases"])
            {
                e.Http.Delegated = (bool)expected["delegated"];
                var result = (await e.Queries.Spectate(e.Owner)).Value;
                Assert.That(result.Phase, Is.EqualTo((string)expected["phase"]));
                var native = new ActiveRunReconciler(e.Accounts).Reconcile(Envelope(e.Fixture["accounts"]["active"]), e.Owner);
                Assert.That(result.Token.State, Is.EqualTo(native.State)); Assert.That(result.Token.Config, Is.EqualTo(native.Config));
            }
            e.Http.Delegated = false; e.Http.Remove(e.Fixture["accounts"]["active"]);
            Assert.That((await e.Queries.Spectate(e.Owner)).Value.Phase, Is.EqualTo("archived"));
            Assert.That(e.Http.Methods.All(method => method == "getGenesisHash" || method == "getAccountInfo" || method == "getDelegationStatus"), Is.True);
        }

        [Test] public async Task IdentitySwitchDiscardsLateReadEvenWhenTransportIgnoresCancellation()
        {
            var e = await Environment.Create();
            var retained = await e.Queries.Profile();
            e.Http.Wait = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var query = e.Queries.Profile(); await e.Http.Entered.Task;
            await e.Identity.Disconnect(); e.Wallet.Owner = e.Accounts.ProgramId;
            await e.Identity.Connect(); e.Http.Wait.SetResult(true);
            Assert.Throws<OperationCanceledException>(() => { var ignored = retained.Value; });
            await Failure<OperationCanceledException>(async () => { await query; });
            var fresh = await e.Queries.Profile(); Assert.That(fresh.Identity.Owner, Is.EqualTo(e.Wallet.Owner));
            Assert.That(fresh.Value.Exists, Is.False);
        }

        [Test] public async Task WrongOwnerAndRelocatedSpectatorNeverExposeAcceptedBytes()
        {
            var e = await Environment.Create(); var profile = (JObject)e.Fixture["accounts"]["player"].DeepClone();
            profile["owner"] = e.Owner; e.Http.Put(profile);
            await Failure<FormatException>(async () => { await e.Queries.Profile(); });
            e.Http.Put(e.Fixture["accounts"]["player"]); e.Http.Relocate = true;
            Assert.That((await e.Queries.Spectate(e.Owner)).Value.Phase, Is.EqualTo("resolving"));
        }

        private static async Task<T> Failure<T>(Func<Task> action) where T : Exception
        { try { await action(); } catch (T error) { return error; } Assert.Fail("Expected " + typeof(T).Name); return null; }
        private static AccountEnvelope Envelope(JToken row) => new AccountEnvelope((string)row["address"], (string)row["owner"],
            (bool)row["executable"], Convert.FromBase64String((string)row["data"]));
        private static string Root {
            get {
#if ZKUBE_STANDALONE
                return Directory.GetCurrentDirectory();
#else
                return Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath,"../.."));
#endif
            }
        }
        private static JObject Fixture()
        {
            return JObject.Parse(File.ReadAllText(Path.Combine(Root, "fixtures/unity-product-reads-v1.json")));
        }
        private sealed class Environment
        {
            public JObject Fixture; public Http Http; public ProductQueries Queries; public AccountBindings Accounts; public TransactionPlanner Addresses;
            public ClientIdentity Identity; public Wallet Wallet; public long Now; public string Owner;
            public static async Task<Environment> Create()
            {
                var e = new Environment { Fixture = ProductReadTests.Fixture() }; e.Owner = (string)e.Fixture["inputs"]["owner"]; e.Now = (long)e.Fixture["inputs"]["now"];
                string idl = File.ReadAllText(Path.Combine(Root, "client/src/backend/solana/idl/solana.json"));
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
            public JArray ScanRows = new JArray(); public ulong ScanSlot = 100;
            public Action<JObject> OnRequest; public Func<string,string> AlterScanResponse;
            public string WaitMethod = "getAccountInfo";
            private readonly Dictionary<string,JToken> data = new Dictionary<string,JToken>();
            public bool Delegated, Relocate; private int placements;
            public TaskCompletionSource<bool> Wait; public readonly TaskCompletionSource<bool> Entered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            public void Put(JToken row) { if (row?["address"] != null) data[(string)row["address"]] = row.DeepClone(); }
            public void Remove(JToken row) => data.Remove((string)row["address"]);
            private JToken Account(string address) => data.TryGetValue(address,out var row) ? new JObject { ["owner"] = row["owner"], ["executable"] = row["executable"],
                ["data"] = new JArray(row["data"],"base64"), ["lamports"] = 1, ["rentEpoch"] = 0 } : JValue.CreateNull();
            public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                var request = JObject.Parse(json); string method = (string)request["method"]; Methods.Add(method);
                Requests.Add(request); OnRequest?.Invoke(request);
                if (method == WaitMethod && Wait != null) { Entered.TrySetResult(true); await Wait.Task; }
                JToken result;
                if (method == "getGenesisHash") result = Genesis;
                else if (method == "getAccountInfo") result = new JObject { ["context"] = new JObject { ["slot"] = 100 }, ["value"] = Account((string)request["params"][0]) };
                else if (method == "getMultipleAccounts") result = new JObject { ["context"] = new JObject { ["slot"] = 100 }, ["value"] = new JArray(request["params"][0].Select(address => Account((string)address))) };
                else if (method == "getProgramAccounts") result = new JObject { ["context"] = new JObject { ["slot"] = ScanSlot }, ["value"] = ScanRows };
                else if (method == "getDelegationStatus") { placements++; bool delegated = Relocate ? placements % 2 == 0 : Delegated; result = new JObject { ["isDelegated"] = delegated, ["fqdn"] = delegated ? "https://er.invalid/" : null }; }
                else throw new Exception("Forbidden product-query RPC: " + method);
                string response = new JObject { ["jsonrpc"] = "2.0", ["id"] = request["id"], ["result"] = result }.ToString();
                return method == "getProgramAccounts" && AlterScanResponse != null ? AlterScanResponse(response) : response;
            }
        }
    }
}
