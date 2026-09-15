using System;
using System.IO;
using System.Threading.Tasks;
using NUnit.Framework;
using UnityEngine;
using ZKube.Local.Billing;

namespace ZKube.Local.App.Tests
{
    public sealed class StoreStartupPersistenceTests
    {
        private string directory;
        private string ProductPath => Path.Combine(directory, LocalProductCodec.StorageKey + ".json");
        private string OfflinePath => Path.Combine(directory, OfflineCampaignStoreDriver.FileName);
        [SetUp] public void SetUp()
        {
            directory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../build/unity/harness/store-startup/files/" + Guid.NewGuid().ToString("N")));
        }
        [TearDown] public void TearDown() { if (Directory.Exists(directory)) Directory.Delete(directory, true); }
        private LocalProductStore Product(Func<bool> failGrant = null) => new LocalProductStore(
            key => { Assert.AreEqual(LocalProductCodec.StorageKey, key); return StartupFiles.Read(ProductPath); },
            (key, value) => {
                Assert.AreEqual(LocalProductCodec.StorageKey, key);
                if (failGrant?.Invoke() == true && LocalProductCodec.Decode(value).CampaignOwned) throw new IOException("product write failed");
                StartupFiles.Write(ProductPath, value);
            });
        private OfflineCampaignStoreDriver Driver(Func<bool> failConfirmation = null) => new OfflineCampaignStoreDriver(
            () => StartupFiles.Read(OfflinePath), value => {
                if (value == "confirmed" && failConfirmation?.Invoke() == true) throw new IOException("confirmation write failed");
                StartupFiles.Write(OfflinePath, value);
            });
        private static CampaignBilling Billing(OfflineCampaignStoreDriver driver, LocalProductStore product)
        {
            var runs = new LocalRunClient(product, () => 0);
            return new CampaignBilling(driver, () => new CampaignBillingAnswer(product.Read.CampaignOwned,
                product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
        }
        private static CampaignOrder[] Orders(OfflineCampaignStoreDriver driver)
        {
            CampaignOrder[] result = null;
            void Receive(CampaignOrder[] orders) { result = orders; }
            driver.PurchasesFetched += Receive;
            try { driver.FetchPurchases(); return result; }
            finally { driver.PurchasesFetched -= Receive; }
        }
        [Test] public async Task ConfirmedOfflinePurchaseSurvivesFreshDriverAndProductInstances()
        {
            var product = Product();
            using (var billing = Billing(Driver(), product)) Assert.IsTrue((await billing.Purchase()).Owned);
            Assert.IsTrue(Product().Read.CampaignOwned);
            var reopened = Product(); using var store = Driver();
            Assert.AreEqual(CampaignOrderState.Confirmed, Orders(store)[0].State);
            using var restarted = Billing(store, reopened);
            var answer = await restarted.Query();
            Assert.IsTrue(answer.Owned); Assert.AreEqual(CampaignBillingStatus.Updated, answer.Status);
            Assert.IsTrue(Product().Read.CampaignOwned, "A fresh fake-store query must not revoke its completed purchase");
        }
        [Test] public async Task PaidButUnconfirmedOrderSurvivesRestartAndIsFulfilledThenConfirmed()
        {
            using (var store = Driver()) store.Purchase(); // Process ends before any billing fulfillment callback.
            Assert.IsFalse(Product().Read.CampaignOwned, "Fake store payment is separate from product entitlement");
            using var restored = Driver();
            Assert.AreEqual(CampaignOrderState.PaidUnconfirmed, Orders(restored)[0].State);
            var product = Product(); using var billing = Billing(restored, product);
            Assert.IsTrue((await billing.Restore()).Owned);
            Assert.IsTrue(Product().Read.CampaignOwned);
            using var nextProcess = Driver(); Assert.AreEqual(CampaignOrderState.Confirmed, Orders(nextProcess)[0].State);
        }
        [Test] public async Task FailedProductGrantLeavesPaidOrderForRestartRecovery()
        {
            var product = Product(() => true);
            using (var billing = Billing(Driver(), product))
            {
                bool failed = false;
                try { await billing.Purchase(); } catch (IOException) { failed = true; }
                Assert.IsTrue(failed);
            }
            Assert.IsFalse(Product().Read.CampaignOwned, "No failed durable write is treated as saved");
            using var restored = Driver(); Assert.AreEqual(CampaignOrderState.PaidUnconfirmed, Orders(restored)[0].State);
            using var retry = Billing(restored, Product());
            Assert.IsTrue((await retry.Restore()).Owned); Assert.IsTrue(Product().Read.CampaignOwned);
        }
        [Test] public async Task FailedConfirmationPreservesPaidStateAndAlreadySavedEntitlement()
        {
            using (var billing = Billing(Driver(() => true), Product()))
            {
                bool failed = false;
                try { await billing.Purchase(); } catch (IOException) { failed = true; }
                Assert.IsTrue(failed);
            }
            Assert.IsTrue(Product().Read.CampaignOwned);
            using var restored = Driver(); Assert.AreEqual(CampaignOrderState.PaidUnconfirmed, Orders(restored)[0].State);
            using var retry = Billing(restored, Product());
            Assert.AreEqual(CampaignBillingStatus.Updated, (await retry.Restore()).Status);
            using var next = Driver(); Assert.AreEqual(CampaignOrderState.Confirmed, Orders(next)[0].State);
        }
        [Test] public void FailedFakePaymentPersistenceEmitsNoPaidEvent()
        {
            using var store = new OfflineCampaignStoreDriver(() => null, _ => throw new IOException("fake store write failed"));
            int paid = 0; store.PurchasePaid += _ => paid++;
            Assert.Throws<IOException>(() => store.Purchase()); Assert.AreEqual(0, paid); Assert.IsEmpty(Orders(store));
        }
        [Test] public void MissingOrForeignConfirmationCannotCreateAPersistedPurchase()
        {
            using var store = Driver();
            Assert.Throws<InvalidOperationException>(() => store.Confirm(null)); Assert.IsNull(StartupFiles.Read(OfflinePath));
            store.Purchase(); var paid = Orders(store)[0];
            var copy = new CampaignOrder(paid.ProductId, paid.TransactionId, paid.State);
            Assert.Throws<InvalidOperationException>(() => store.Confirm(copy));
            using var reopened = Driver(); Assert.AreEqual(CampaignOrderState.PaidUnconfirmed, Orders(reopened)[0].State);
            store.Confirm(paid);
            Assert.Throws<InvalidOperationException>(() => store.Confirm(Orders(store)[0]));
        }
        [Test] public async Task CachedProductEntitlementCannotInventAFakeStorePurchase()
        {
            var product = Product(); new LocalRunClient(product, () => 0).ApplyCampaignEntitlement(true, "cached");
            using var driver = Driver(); Assert.IsEmpty(Orders(driver));
            using var billing = Billing(driver, product);
            Assert.IsFalse((await billing.Query()).Owned, "An absent fake order is an explicit successful empty-store answer");
        }
        [TestCase("")]
        [TestCase("garbage")]
        [TestCase("confirmed\n")]
        [TestCase("{\"campaignOwned\":true}")]
        public void MalformedFakeStoreFailsWithoutOverwritingProduct(string saved)
        {
            var product = Product(); new LocalRunClient(product, () => 0).ApplyCampaignEntitlement(true, "cached");
            string before = StartupFiles.Read(ProductPath); StartupFiles.Write(OfflinePath, saved);
            Assert.Throws<FormatException>(() => Driver()); Assert.AreEqual(before, StartupFiles.Read(ProductPath));
        }
        [Test] public void FlushedProductPublicationReplacesWholeDocumentAndClearsStalePending()
        {
            Assert.IsNull(StartupFiles.Read(ProductPath));
            var first = new LocalProductState { Name = "First", BestDailyScore = 12 };
            var second = new LocalProductState { Name = "Second", BestDailyScore = 34, CampaignOwned = true };
            StartupFiles.Write(ProductPath, LocalProductCodec.Encode(first));
            File.WriteAllText(ProductPath + ".pending", "interrupted partial JSON");
            Assert.AreEqual("First", Product().Read.Name, "Restart reads only the published file");
            StartupFiles.Write(ProductPath, LocalProductCodec.Encode(second));
            Assert.AreEqual("Second", Product().Read.Name); Assert.AreEqual(34, Product().Read.BestDailyScore);
            Assert.IsTrue(Product().Read.CampaignOwned); Assert.IsFalse(File.Exists(ProductPath + ".pending"));
        }
        [Test] public void FailedPendingWritePreservesPreviouslyPublishedProduct()
        {
            var original = LocalProductCodec.Encode(new LocalProductState { Name = "Saved", BestDailyScore = 22 });
            StartupFiles.Write(ProductPath, original); Directory.CreateDirectory(ProductPath + ".pending");
            Assert.Catch(() => StartupFiles.Write(ProductPath, "replacement"));
            Assert.AreEqual(original, StartupFiles.Read(ProductPath));
        }
        [Test] public void UnpublishedPendingFileCannotBecomeProductOnRestart()
        {
            Directory.CreateDirectory(directory); File.WriteAllText(ProductPath + ".pending", "unfinished");
            Assert.IsNull(StartupFiles.Read(ProductPath));
        }
        [Test] public void ExistingUnreadableProductPathIsAnErrorNotAnAbsentSave()
        {
            Directory.CreateDirectory(ProductPath);
            Assert.Catch(() => StartupFiles.Read(ProductPath));
        }
        [Test] public void FailedAtomicPublicationRemovesOnlyItsPendingFile()
        {
            Directory.CreateDirectory(ProductPath); string marker = Path.Combine(ProductPath, "unchanged");
            File.WriteAllText(marker, "existing directory content");
            Assert.Catch(() => StartupFiles.Write(ProductPath, "new content"));
            Assert.AreEqual("existing directory content", File.ReadAllText(marker));
            Assert.IsFalse(File.Exists(ProductPath + ".pending"));
        }
    }
}
