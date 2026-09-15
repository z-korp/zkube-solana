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
            store.WriteCampaign(current => { var next = LocalProductCodec.Decode(LocalProductCodec.Encode(current)); next.Stars[29] = 0; return next; });
            Assert.That(money.CampaignLock(4), Is.EqualTo("stars"));
            Assert.That(paidStore.CampaignLock(4), Is.EqualTo("stars"));
        }

        [Test] public void LocalDailyBoardUsesTheCoreSelectedRealm()
        {
            var client = new StoreRunClient(new LocalProductStore(), () => 20705L * 86400);
            var daily = client.StartDaily();
            Assert.That(new LocalBoardActionProvider(client, daily).Bind("Daily").RealmId, Is.EqualTo(client.Today().Realm));
        }
    }
}
