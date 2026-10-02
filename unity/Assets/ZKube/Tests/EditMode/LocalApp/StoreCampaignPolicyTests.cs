using System;
using System.Linq;
using NUnit.Framework;
using ZKube.Local;
using ZKube.Local.App;
namespace ZKube.Local.App.Tests
{
    public sealed class StoreCampaignPolicyTests
    {
        [Test]
        public void store_gate_is_a_store_identity_policy_over_shared_progression()
        {
            var state = new LocalProductState { Stars = Enumerable.Repeat((byte)3, 100).ToArray() };
            var store = new LocalProductStore(_ => LocalProductCodec.Encode(state));
            var money = new LocalRunClient(store);
            var paidStore = new StoreRunClient(store, () => 0);
            Assert.That(money.CampaignLock(4), Is.Null);
            Assert.That(paidStore.CampaignLock(4), Is.EqualTo("purchase"));
            Assert.That(paidStore.CampaignLock(3), Is.Null);
            paidStore.ApplyCampaignEntitlement(true, "$1");
            Assert.That(paidStore.CampaignLock(4), Is.Null);
            store.Write(current => { var next = LocalProductCodec.Decode(LocalProductCodec.Encode(current)); next.Stars[29] = 0; return next; });
            Assert.That(money.CampaignLock(4), Is.EqualTo("stars"));
            Assert.That(paidStore.CampaignLock(4), Is.EqualTo("stars"));
        }

        [Test] public void TheLocalDailyTurnsOverAtSevenUtcWithTheCore()
        {
            long opens = (long)ZKube.Core.NativeEngine.Daily(20705).OpensAt, clock = opens - 1;
            var client = new StoreRunClient(new LocalProductStore(), () => clock);
            // One second before 07:00 UTC it is still yesterday's Daily.
            Assert.That(client.Today().DayId, Is.EqualTo(20704u));
            Assert.That(client.Today().FreezesAt, Is.EqualTo(opens));
            clock = opens;
            var today = client.Today();
            Assert.That(today.DayId, Is.EqualTo(20705u));
            Assert.That(today.OpensAt, Is.EqualTo(opens));
            Assert.That(today.OpensAt % 86400, Is.EqualTo(7 * 3600));
            Assert.That(today.FreezesAt, Is.EqualTo((long)ZKube.Core.NativeEngine.Daily(20706).OpensAt));
            Assert.That(today.Realm, Is.EqualTo(ZKube.Core.NativeEngine.Daily(20705).Realm));
            // A clock set before the first day still gets a Daily.
            clock = 0; Assert.That(client.Today().DayId, Is.Zero);
        }

        [Test] public void LocalDailyBoardUsesTheCoreSelectedRealm()
        {
            var client = new StoreRunClient(new LocalProductStore(), () => (long)ZKube.Core.NativeEngine.Daily(20705).OpensAt);
            var daily = client.StartDaily();
            Assert.That(new LocalBoardActionProvider(client, daily).Bind().RealmId, Is.EqualTo(client.Today().Realm));
        }
    }
}
