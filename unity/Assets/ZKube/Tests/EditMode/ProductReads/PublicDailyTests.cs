using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration.Client;
using ZKube.Integration.Transport;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        private static JObject PublicFixture() => JObject.Parse(File.ReadAllText(Path.Combine(Root, "fixtures/unity-public-daily-v1.json")));
        private static PublicDailyQuery PublicQuery(Environment e) => new PublicDailyQuery(e.Accounts, e.Addresses,
            new SolanaRpcTransport(e.Http, "https://base.invalid/", "https://router.invalid/", e.Http.Genesis,
                (string)e.Fixture["accounts"]["protocol"]["owner"]), () => e.Now);

        [Test] public async Task DisconnectedDailyMatchesActualTsContentWithoutOwnerOrFollowingReads()
        {
            var e = await Environment.Create();
            var connected = await e.Queries.CurrentDaily();
            await e.Identity.Disconnect();
            e.Http.Requests.Clear(); e.Http.Methods.Clear();
            var result = await PublicQuery(e).Current();
            Assert.That(e.Identity.Owner, Is.Null);
            Assert.That(result.Status, Is.EqualTo("open"));
            Assert.That(result.PotLamports.ToString(), Is.EqualTo((string)e.Fixture["daily"]["pool"]));
            Assert.That(result.Realm, Is.EqualTo((byte)e.Fixture["daily"]["realm"]));
            Assert.That(result.Slot, Is.EqualTo(100UL));
            Assert.That(result.ObservedAt, Is.EqualTo(e.Now));
            Assert.Throws<OperationCanceledException>(() => { var ignored = connected.Value; });
            await Failure<InvalidOperationException>(async () => { await e.Queries.CurrentDaily(); });
            CollectionAssert.AreEqual(new[] {e.Addresses.ProtocolAddress, e.Addresses.ArcadeAddress, e.Addresses.Daily(result.DayId)},
                e.Http.Requests.Single(request => (string)request["method"] == "getMultipleAccounts")["params"][0].Values<string>());
            Assert.That(e.Http.Methods.All(method => method == "getGenesisHash" || method == "getMultipleAccounts"), Is.True);
            result.Daily["map_id"] = 255;
            Assert.That(result.Daily["map_id"].Value<byte>(), Is.EqualTo(result.Realm));
        }

        [Test] public async Task PublicDailyCasesMatchActualTsContentAndWindowBoundaries()
        {
            foreach (var row in PublicFixture()["cases"])
            {
                var e = await Environment.Create(); e.Now = (long)row["now"];
                foreach (string name in new[] {"protocol", "arcade", "daily"})
                {
                    e.Http.Remove(e.Fixture["accounts"][name]);
                    if (row["rows"][name].Type != JTokenType.Null) e.Http.Put(row["rows"][name]);
                }
                var result = await PublicQuery(e).Current();
                string variant = (string)row["variant"];
                string expected = variant == "missing-config" ? "missing-config" : variant == "missing-daily" ? "missing-daily"
                    : variant.StartsWith("suspended") ? "suspended" : variant == "paused" ? "paused"
                    : variant == "freeze-at" ? "frozen" : variant == "before-open" ? "not-open"
                    : variant == "finalized" ? "finalized" : "open";
                Assert.That(result.Status, Is.EqualTo(expected), variant);
                var content = row["content"];
                if (content.Type != JTokenType.Null)
                {
                    Assert.That(result.DayId, Is.EqualTo((uint)content["dayId"]), variant);
                    Assert.That(result.Realm, Is.EqualTo((byte)content["realm"]), variant);
                    Assert.That(result.ObjectiveKind, Is.EqualTo((byte)content["objective"]["kind"]), variant);
                    Assert.That(result.ObjectiveValue, Is.EqualTo((byte)content["objective"]["value"]), variant);
                    Assert.That(result.Suspended, Is.EqualTo((bool)content["suspended"]), variant);
                    if (result.HasPublication)
                    {
                        Assert.That(result.StartingHeight, Is.EqualTo((byte)content["startingHeight"]), variant);
                        Assert.That(result.OpensAt, Is.EqualTo((long)content["opensAt"]), variant);
                        Assert.That(result.FreezesAt, Is.EqualTo((long)content["freezesAt"]), variant);
                        Assert.That(result.PotLamports.ToString(), Is.EqualTo((string)row["pool"]), variant);
                    }
                }
                if (variant is "missing-config" or "missing-daily" or "suspended-missing")
                {
                    Assert.That(result.HasPublication, Is.False, variant);
                    Assert.That(result.PotLamports, Is.Null, variant);
                    Assert.That(result.OpensAt, Is.Null, variant);
                    Assert.That(result.StartingHeight, Is.Null, variant);
                }
                if (variant is "open" or "opens-at" or "freeze-minus-one")
                    Assert.That((string)row["lifecycle"], Is.EqualTo("entries-open"), variant);
                if (variant is "freeze-at" or "before-open")
                    Assert.That((string)row["lifecycle"], Is.EqualTo("entries-closed"), variant);
            }
        }

        [Test] public async Task PublicDailyMissingAndMaximumDayDrawsMatchActualCore()
        {
            foreach (var row in PublicFixture()["clocks"])
            {
                var e = await Environment.Create(); e.Now = (long)row["now"];
                e.Http.Remove(e.Fixture["accounts"]["daily"]);
                e.Http.Remove(e.Fixture["accounts"]["following"]);
                var result = await PublicQuery(e).Current();
                Assert.That(result.DayId, Is.EqualTo((uint)row["day"]));
                Assert.That(result.Realm, Is.EqualTo((byte)row["pair"]["realmMapId"]));
                Assert.That(result.ObjectiveKind, Is.EqualTo((byte)row["pair"]["objective"]["kind"]));
                Assert.That(result.ObjectiveValue, Is.EqualTo((byte)row["pair"]["objective"]["value"]));
                Assert.That(result.HasPublication, Is.False);
            }
            var invalid = await Environment.Create(); var query = PublicQuery(invalid);
            foreach (long timestamp in new[] {-1L, ((long)uint.MaxValue + 1) * 86400})
            {
                invalid.Now = timestamp; invalid.Http.Requests.Clear();
                await Failure<ArgumentOutOfRangeException>(async () => { await query.Current(); });
                Assert.That(invalid.Http.Requests, Is.Empty);
            }
        }

        [Test] public async Task PublicDailyRejectsMalformedAccountsEvenWithMissingPeer()
        {
            foreach (string name in new[] {"dailyContentVersion", "dailyMoveLimit", "dailyDraw"})
            {
                var e = await Environment.Create(); e.Http.Put(e.Fixture["invalidAccounts"][name]);
                await Failure<FormatException>(async () => { await PublicQuery(e).Current(); });
            }
            foreach (string name in new[] {"protocol", "arcade", "daily"})
            {
                foreach (string change in new[] {"owner", "executable", "length", "discriminator"})
                {
                    var e = await Environment.Create();
                    var malformed = (JObject)e.Fixture["accounts"][name].DeepClone();
                    if (change == "owner") malformed["owner"] = e.Owner;
                    if (change == "executable") malformed["executable"] = true;
                    if (change == "length") malformed["data"] = Convert.ToBase64String(new byte[1]);
                    if (change == "discriminator") { var data = Convert.FromBase64String((string)malformed["data"]); data[0] ^= 255; malformed["data"] = Convert.ToBase64String(data); }
                    e.Http.Put(malformed);
                    e.Http.Remove(e.Fixture["accounts"][name == "protocol" ? "arcade" : "protocol"]);
                    await Failure<FormatException>(async () => { await PublicQuery(e).Current(); });
                }
            }
        }

        [Test] public async Task PublicDailyRejectsClockRolloverAndHonorsCancellationAndGenesis()
        {
            var e = await Environment.Create(); var query = PublicQuery(e);
            e.Http.OnRequest = request => { if ((string)request["method"] == "getMultipleAccounts") e.Now = ((long)e.Fixture["inputs"]["day"] + 1) * 86400; };
            await Failure<InvalidOperationException>(async () => { await query.Current(); });
            e.Http.OnRequest = null;
            using var cancellation = new CancellationTokenSource(); cancellation.Cancel(); e.Http.Requests.Clear();
            await Failure<OperationCanceledException>(async () => { await query.Current(cancellation.Token); });
            Assert.That(e.Http.Requests, Is.Empty);
            e = await Environment.Create();
            var wrong = new PublicDailyQuery(e.Accounts, e.Addresses,
                new SolanaRpcTransport(e.Http, "https://base.invalid/", "https://router.invalid/", e.Owner,
                    (string)e.Fixture["accounts"]["protocol"]["owner"]), () => e.Now);
            await Failure<FormatException>(async () => { await wrong.Current(); });
            Assert.That(e.Http.Methods, Is.EqualTo(new[] {"getGenesisHash"}));
        }
    }
}
