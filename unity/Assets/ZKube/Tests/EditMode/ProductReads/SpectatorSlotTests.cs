using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        [Test] public async Task ArcadeSpectatorReadsDurableSlotAndKeepsNativeAcceptedSnapshot()
        {
            var e = await Environment.Create(); var runs = JObject.Parse(File.ReadAllText(Path.Combine(Root,"fixtures/unity-run-client-v1.json")));
            e.Http.Put(runs["player"]); e.Http.Delegated = true;
            var daily = runs["cases"].Single(row => (string)row["id"] == "active-daily-playing");
            e.Http.Put(daily);
            foreach (var pair in new[] { (Mode:"ranked",Row:daily) })
            {
                var actual = (await e.Queries.SpectateSlot(e.Owner,pair.Mode)).Value;
                Assert.That(actual.Address, Is.EqualTo((string)pair.Row["address"])); Assert.That(actual.Phase, Is.EqualTo("delegated"));
                var expected = new ActiveRunReconciler(e.Accounts).Reconcile(Envelope(pair.Row),e.Owner);
                CollectionAssert.AreEqual(expected.State,actual.Token.State); CollectionAssert.AreEqual(expected.Config,actual.Token.Config);
            }
            Assert.That((await e.Queries.SpectateSlot(e.Owner,"campaign")).Value.Phase, Is.EqualTo("not-found"));
            var selected = (await e.Queries.Spectate(e.Owner, (ulong)e.Accounts.ActiveRun(Envelope(daily),e.Owner)["run_id"])).Value;
            Assert.That(selected.Address, Is.EqualTo((string)daily["address"]));
        }

        [Test] public async Task ChangedOrMismatchedDurableSpectatorSlotNeverExposesAcceptedToken()
        {
            var e = await Environment.Create(); var runs = JObject.Parse(File.ReadAllText(Path.Combine(Root,"fixtures/unity-run-client-v1.json")));
            var daily = runs["cases"].Single(row => (string)row["id"] == "active-daily-playing");
            e.Http.Put(runs["player"]); e.Http.Put(daily); e.Http.Delegated = true;
            e.Http.OnRequest = request => { if ((string)request["method"] == "getDelegationStatus")
                e.Http.Put(PatchAccount(runs["player"],"PlayerState",("active_run_id",Number(0,8)))); };
            var result = (await e.Queries.SpectateSlot(e.Owner,"ranked")).Value;
            Assert.That(result.Phase, Is.EqualTo("changed")); Assert.That(result.Token, Is.Null);
            e.Http.OnRequest = null;
            e.Http.Put(PatchAccount(runs["player"],"PlayerState",("active_run_id",Number(ulong.MaxValue,8))));
            await Failure<FormatException>(async()=>{ await e.Queries.SpectateSlot(e.Owner,"ranked"); });
            e.Http.Put(PatchAccount(runs["player"],"PlayerState",("active_run_id",Number(0,8))));
            Assert.That((await e.Queries.SpectateSlot(e.Owner,"ranked")).Value.Phase, Is.EqualTo("not-found"));
        }
    }
}
