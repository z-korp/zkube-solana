using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Tests
{
    // The store answers one request at a time, and the one in flight shows on
    // its own button, the shared loader with its step, until its outcome.
    public sealed partial class StoreAppPageJourneyTests
    {
        private const string BusyNotice = "A store operation is still in progress.";
        private IEnumerator MountStore(Driver driver)
        {
            Object.Destroy(app.gameObject); yield return null; billing.Dispose();
            billing = new CampaignBilling(driver, () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated),
                runs.ApplyCampaignEntitlement);
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            app = appRoot.AddComponent<StoreAppAdapter>(); app.Initialize(product, runs, billing, board); Greet(app);
            yield return Wait(() => !billing.Busy, "The startup store query did not finish"); yield return Page(StorePage.Home);
        }
        private IEnumerator ClosedRealm()
        {
            product.Write(state => { state.Stars[9] = 1; state.Stars[19] = 1; state.Stars[29] = 1; return state; });
            Click(app, "Campaign"); yield return Page(StorePage.Campaign);
            app.Flow.Campaign.SelectRealm(4); yield return Page(StorePage.Campaign);
        }
        private Button StoreButton(string starts) => Buttons().Single(button => button.name.StartsWith(starts));
        private static string Words(Button button) => button.GetComponentInChildren<TMP_Text>().text;
        private static bool Loading(Button button) => button.GetComponentsInChildren<Image>().Any(image => image.name == "Action loader");
        private int Loaders() => app.GetComponentsInChildren<Image>().Count(image => image.gameObject.activeInHierarchy && image.name == "Action loader");
        private void InProgress(string button, string step, string waits = null)
        {
            Assert.That(Words(StoreButton(button)), Is.EqualTo(step), button);
            Assert.That(Loading(StoreButton(button)), Is.True, button + " carries the loader");
            Assert.That(StoreButton(button).interactable, Is.False, button + " takes no second tap");
            Assert.That(StoreButton(button).GetComponent<CanvasGroup>().alpha, Is.EqualTo(1), button + " is drawn at full strength");
            Assert.That(Loaders(), Is.EqualTo(1), "One request, one loader");
            Assert.That(Texts(), Does.Not.Contain(BusyNotice));
            if (waits == null) return;
            Assert.That(StoreButton(waits).interactable, Is.False, waits + " waits for the request in flight");
            Assert.That(Loading(StoreButton(waits)), Is.False);
        }

        [UnityTest] public IEnumerator AStorePurchaseOrRestoreShowsItsStepOnItsOwnButtonUntilItsOutcome()
        {
            var store = new Driver { Sells = true }; yield return MountStore(store);
            yield return ClosedRealm();
            Assert.That(Loaders(), Is.Zero);

            // Restore: its own button says Checking; reduced motion holds the hourglass still.
            store.Held = true;
            Click(app, "Restore purchases"); yield return Page(StorePage.Campaign);
            InProgress("Restore purchases", "Checking", waits: "Unlock");
            Assert.That(Words(StoreButton("Unlock")), Does.StartWith("Unlock"));
            Assert.That(app.GetComponentsInChildren<Turn>(), Is.Empty, "Reduced motion shows the loader still");
            store.Answer(); yield return Wait(() => !billing.Busy, "Restore did not finish"); yield return Page(StorePage.Campaign);
            Assert.That(Loaders(), Is.Zero);
            Assert.That(Words(StoreButton("Restore purchases")), Is.EqualTo("Restore purchases"));
            Assert.That(StoreButton("Restore purchases").interactable && StoreButton("Unlock").interactable, Is.True);

            // Purchase: its own button says Purchasing from the tap, through the store's sheet, to the outcome.
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
            StoreButton("Unlock").onClick.Invoke(); yield return Page(StorePage.Campaign);
            InProgress("Unlock", "Purchasing", waits: "Restore purchases");
            Assert.That(StoreButton("Unlock").GetComponentsInChildren<Turn>().Length, Is.EqualTo(1), "With motion the loader turns");
            store.Held = false; store.Answer(); yield return Page(StorePage.Campaign);
            Assert.That(store.Bought, Is.EqualTo(1), "The purchase reached the store");
            InProgress("Unlock", "Purchasing", waits: "Restore purchases");
            store.Reject(canceled: true);
            yield return Wait(() => !billing.Busy, "The purchase did not end"); yield return Page(StorePage.Campaign);
            Assert.That(Loaders(), Is.Zero);
            Assert.That(Texts(), Does.Contain("Purchase cancelled"), "The outcome is on the page");
            Assert.That(StoreButton("Unlock").interactable && StoreButton("Restore purchases").interactable, Is.True);
            Assert.That(store.Bought, Is.EqualTo(1));
        }

        [UnityTest] public IEnumerator AStoreRequestThatFailsLateOrOutlastsItsPageShowsOnTheButtonAndEndsByItself()
        {
            var store = new Driver(); yield return MountStore(store);
            // Asked from Settings and still unanswered when the player moves to the Campaign page.
            Click(app, "Settings"); yield return Page(StorePage.Settings);
            store.Held = true;
            Click(app, "Restore purchases"); yield return Page(StorePage.Settings);
            InProgress("Restore purchases", "Checking");
            yield return ClosedRealm();
            Assert.That(billing.Busy, Is.True, "The store still holds the request");
            InProgress("Restore purchases", "Checking", waits: "Unlock");
            // It lets go while nobody waits for it: the buttons come back without a tap.
            store.Answer();
            yield return Wait(() => Loaders() == 0, "The buttons did not come back by themselves"); yield return Page(StorePage.Campaign);
            Assert.That(StoreButton("Restore purchases").interactable && StoreButton("Unlock").interactable, Is.True);

            // A failure that comes late: the step until then, the store's reason and its retry after.
            Click(app, "Restore purchases"); yield return Page(StorePage.Campaign);
            InProgress("Restore purchases", "Checking", waits: "Unlock");
            store.Failure = "Purchases are unavailable"; store.Answer();
            yield return Wait(() => app.Flow.StoreUnavailable && !billing.Busy, "The late failure was not reported"); yield return Page(StorePage.Campaign);
            Assert.That(Loaders(), Is.Zero);
            Assert.That(Texts(), Does.Contain("Store purchase unavailable"));
            // The retry is a check too, on its own button.
            Click(app, "Try again"); yield return Page(StorePage.Campaign);
            InProgress("Try again", "Checking");
            store.Failure = null; store.Answer();
            yield return Wait(() => !app.Flow.StoreUnavailable && !billing.Busy, "The retry did not reach the store"); yield return Page(StorePage.Campaign);
            Assert.That(Loaders(), Is.Zero);
            Assert.That(StoreButton("Unlock").interactable && StoreButton("Restore purchases").interactable, Is.True);
        }
    }
}
