using System;
using System.Threading;
using System.Threading.Tasks;
using System.IO;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Tests
{
    public sealed class StoreAppFlowTests
    {
        private sealed class Driver : ICampaignStoreDriver
        {
            public event Action<string> ProductFetched;
            public event Action<CampaignOrder[]> PurchasesFetched;
            public event Action<CampaignOrder> PurchasePaid;
            public event Action PurchaseDeferred;
            public event Action<bool> PurchaseRejected;
            public event Action<string, bool> PurchaseConfirmed;
            public event Action<string> QueryFailed;
            public event Action Disconnected;
            public bool Delay;
            public bool Owned;
            public int PurchaseCalls;
            public Task Connect() => Task.CompletedTask;
            public void FetchProduct() { if (!Delay) ProductFetched?.Invoke("€4.99"); }
            public void ReleaseProduct() => ProductFetched?.Invoke("€4.99");
            public void FetchPurchases() => PurchasesFetched?.Invoke(Owned ? new[] { new CampaignOrder(CampaignBilling.ProductId, "owned", CampaignOrderState.Confirmed) } : Array.Empty<CampaignOrder>());
            public void Purchase() { PurchaseCalls++; PurchaseDeferred?.Invoke(); }
            public void Confirm(CampaignOrder order) => PurchaseConfirmed?.Invoke(order.TransactionId, true);
            public void Dispose() { }
        }
        private sealed class Session : IDisposable
        {
            public long Now = 20705L * 86400;
            public bool FailSave;
            public readonly LocalProductStore Product;
            public readonly LocalRunClient Runs;
            public readonly Driver Driver = new Driver();
            public readonly CampaignBilling Billing;
            public readonly StoreAppFlow Flow;
            public Session(bool name = true)
            {
                Product = new LocalProductStore(_ => null, (_, __) => { if (FailSave) throw new InvalidOperationException("Disk full"); });
                if (name) Product.Write(current => { current.Name = "Player"; return current; });
                Runs = new LocalRunClient(Product, () => Now);
                Billing = new CampaignBilling(Driver, () => new CampaignBillingAnswer(Product.Read.CampaignOwned, Product.Read.CampaignPrice, CampaignBillingStatus.Updated), Runs.ApplyCampaignEntitlement);
                Flow = new StoreAppFlow(Product, Runs, Billing);
            }
            public void Dispose() { Flow.Dispose(); Billing.Dispose(); }
        }
        [Test] public void NameGateUsesCodecAndDoesNotOpenLockedPages()
        {
            using var app = new Session(false);
            app.Flow.Show(StorePage.Profile); Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Name));
            Assert.Throws<InvalidOperationException>(() => app.Flow.PlayDaily());
            app.Flow.SetName("   Alice   "); Assert.That(app.Product.Read.Name, Is.EqualTo("Alice"));
            Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Daily));
        }
        [TestCase(null)] [TestCase("")] [TestCase(" \t\r\n ")]
        public void DirectBlankNameSubmitStaysAtGateWithoutWriting(string value)
        {
            using var app = new Session(false); var before = app.Product.Read;
            app.Flow.SetName(value);
            Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Name)); Assert.That(app.Product.Read.Name, Is.Null);
            Assert.That(app.Product.Read, Is.SameAs(before)); Assert.That(app.Flow.Error, Is.EqualTo("Enter a name"));
            Assert.That(app.Flow.Unsaved, Is.False);
        }
        [Test] public void DailyResumesOnlyInProcessAndTheUtcRolloverOpensOneNewAttempt()
        {
            using var app = new Session(); app.Flow.PlayDaily(); string first = app.Runs.Active("arcade").RunId;
            app.Flow.Show(StorePage.Daily); app.Flow.PlayDaily(); Assert.That(app.Runs.Active("arcade").RunId, Is.EqualTo(first));
            var restarted = new LocalRunClient(app.Product, () => app.Now);
            using var restartedFlow = new StoreAppFlow(app.Product, restarted, app.Billing);
            Assert.That(restartedFlow.DailyAction, Is.EqualTo("View result")); restartedFlow.PlayDaily();
            Assert.That(restartedFlow.Page, Is.EqualTo(StorePage.Result)); Assert.That(restarted.Active("arcade"), Is.Null);
            app.Now += 86400; Assert.That(app.Flow.DailyAction, Is.EqualTo("Play today")); app.Flow.PlayDaily();
            Assert.That(app.Runs.Active("arcade").RunId, Is.Not.EqualTo(first));
            Assert.That(app.Product.Read.Streak, Is.EqualTo(2));
        }
        [Test] public void ReservationSaveFailureKeepsOneAcceptedRunAndPermanentWarning()
        {
            using var app = new Session(); app.FailSave = true;
            app.Flow.PlayDaily(); var first = app.Runs.Active("arcade").RunId;
            Assert.That(app.Flow.Unsaved, Is.True); Assert.That(app.Flow.Provider.PersistenceFailure, Is.Not.Null);
            app.Flow.Show(StorePage.Daily); app.Flow.PlayDaily();
            Assert.That(app.Runs.Active("arcade").RunId, Is.EqualTo(first));
            app.FailSave = false; app.Flow.SetName("Saved name"); Assert.That(app.Flow.Unsaved, Is.True);
        }
        [Test] public async Task TerminalSaveFailureRemainsVisibleAfterAcceptedSnapshotRecovery()
        {
            using var app = new Session(); app.Flow.PlayDaily(); var provider = app.Flow.Provider;
            app.FailSave = true;
            try { await provider.Submit(provider.AcceptedSnapshot, new BoardAction(BoardActionKind.Abandon), CancellationToken.None); Assert.Fail("Expected failed durable write"); }
            catch (InvalidOperationException) { }
            await provider.Recover(CancellationToken.None); app.Flow.ObservePersistence();
            Assert.That(app.Flow.Unsaved, Is.True); app.Flow.LeaveBoard();
            Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Result)); Assert.That(app.Product.Read.DailyAttempt.Finished, Is.True);
        }
        [Test] public void CampaignUsesRealmEntitlementAndFirstUnclearedNodeWithoutReplacingActiveRun()
        {
            using var app = new Session(); Assert.That(app.Flow.LevelAvailable(1, 1), Is.True);
            Assert.That(app.Flow.LevelAvailable(1, 2), Is.False);
            Assert.That(app.Runs.CampaignLock(4), Is.EqualTo("purchase"));
            app.Flow.SelectRealm(1); app.Flow.Preview(1); app.Flow.PlayCampaign(); var first = app.Runs.Active("campaign").RunId;
            app.Product.Write(state => { state.Stars[0] = 1; return state; });
            app.Flow.SelectRealm(1); app.Flow.Preview(2);
            Assert.Throws<InvalidOperationException>(() => app.Flow.PlayCampaign()); Assert.That(app.Runs.Active("campaign").RunId, Is.EqualTo(first));
            app.Product.Write(state => { state.CampaignOwned = true; state.Stars[29] = 1; return state; });
            Assert.That(app.Runs.CampaignLock(4), Is.Null); Assert.That(app.Flow.LevelAvailable(4, 1), Is.True);
        }
        [Test] public void ProfileEmblemsRequireFinalTrialAndPersistThroughCodec()
        {
            using var app = new Session(); Assert.Throws<InvalidOperationException>(() => app.Flow.Wear(1));
            app.Product.Write(state => { state.Stars[9] = 2; return state; }); app.Flow.Wear(1);
            Assert.That(LocalProductCodec.Decode(LocalProductCodec.Encode(app.Product.Read)).WornEmblem, Is.EqualTo(1));
        }
        [Test] public void PageChoicesAgreeWithTheSharedActualTypescriptHelperCases()
        {
            string path = Path.Combine(UnityEngine.Application.dataPath, "../../fixtures/unity-store-pages-v1.json");
            foreach (JObject row in JArray.Parse(File.ReadAllText(path)))
            {
                using var app = new Session(); byte realm = (byte)row["realm"];
                app.Product.Write(state => {
                    state.CampaignOwned = (bool)row["owned"];
                    if (realm > 1 && (bool)row["previousCleared"]) state.Stars[(realm - 1) * 10 - 1] = 1;
                    for (int i = 0; i < 10; i++) state.Stars[(realm - 1) * 10 + i] = (byte)row["stars"][i];
                    return state;
                });
                for (byte level = 1; level <= 10; level++)
                {
                    bool expected = false; foreach (var value in (JArray)row["available"]) if ((byte)value == level) expected = true;
                    Assert.That(app.Flow.LevelAvailable(realm, level), Is.EqualTo(expected), (string)row["name"] + " level " + level);
                }
            }
        }
        [Test] public async Task NavigationCancelsCallerWithoutReopeningOldPageOrLaunchingPurchase()
        {
            using var app = new Session(); app.Driver.Delay = true; var task = app.Flow.RefreshBilling(purchase: true);
            app.Flow.Show(StorePage.Profile); await task; Assert.That(app.Billing.Busy, Is.True);
            Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Profile)); Assert.That(app.Flow.BillingNotice, Is.Null);
            app.Driver.ReleaseProduct(); Assert.That(app.Driver.PurchaseCalls, Is.Zero);
            Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Profile)); Assert.That(app.Flow.Error, Is.Null);
        }
        [Test] public async Task DeferredPaymentDoesNotGrantUnlockOrRepeatPurchaseWhileWaiting()
        {
            using var app = new Session(); await app.Flow.RefreshBilling(purchase: true);
            Assert.That(app.Product.Read.CampaignOwned, Is.False); Assert.That(app.Driver.PurchaseCalls, Is.EqualTo(1));
            Assert.That(app.Flow.BillingNotice, Does.Contain("pending"));
        }
        [Test] public async Task LateOwnershipRefreshUpdatesProductWithoutRestoringOldPageNotice()
        {
            using var app = new Session(); app.Driver.Delay = true; app.Driver.Owned = true;
            var task = app.Flow.RefreshBilling(); app.Flow.Show(StorePage.Profile); await task;
            app.Driver.ReleaseProduct();
            Assert.That(app.Product.Read.CampaignOwned, Is.True);
            Assert.That(app.Flow.Page, Is.EqualTo(StorePage.Profile)); Assert.That(app.Flow.BillingNotice, Is.Null);
            Assert.That(app.Flow.Error, Is.Null);
        }
    }
}
