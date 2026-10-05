using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Integration.App;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private sealed class PageStore : ICampaignStoreDriver
        {
            public event Action<string> ProductFetched;
            public event Action<CampaignOrder[]> PurchasesFetched;
            public event Action<CampaignOrder> PurchasePaid;
            public event Action PurchaseDeferred;
            public event Action<bool> PurchaseRejected;
            public event Action<string, bool> PurchaseConfirmed;
            public event Action<string> QueryFailed;
            public event Action Disconnected;
            public Task Connect() => Task.CompletedTask;
            public void FetchProduct() => ProductFetched?.Invoke("€4.99");
            public void FetchPurchases() => PurchasesFetched?.Invoke(Array.Empty<CampaignOrder>());
            public void Purchase() => Assert.Fail("Rendering a page cannot purchase anything");
            public void Confirm(CampaignOrder order) => Assert.Fail("Rendering a page cannot acknowledge a purchase");
            public void Dispose() { }
        }

        [UnityTest] public IEnumerator EverySharedPageRendersUnderBothIdentityImplementations()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(money, Is.InstanceOf<IAppPageSource>());
            yield return Wait(money.OpenCampaign()); yield return Rendered(money, AppPage.Campaign);
            Click("Trial 1"); yield return Rendered(money, AppPage.Level);
            yield return Wait(money.OpenDaily()); yield return Rendered(money, AppPage.Home);
            yield return Wait(money.OpenProfile()); yield return Rendered(money, AppPage.Profile);
            money.Navigate(AppPage.Settings); yield return Rendered(money, AppPage.Settings);
            money.Navigate(AppPage.Result); yield return Rendered(money, AppPage.Result);
            Assert.That(environment.SentSignature, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);

            var local = new GameObject("Store page source");
            CampaignBilling billing = null;
            try
            {
                var product = new LocalProductStore(_ => null, (_, __) => { });
                var runs = new StoreRunClient(product, environment.Clock);
                var attempt = runs.StartDaily(); runs.Act(attempt.View.RunId, new LocalRunAction(LocalActionKind.Finish));
                billing = new CampaignBilling(new PageStore(),
                    () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
                var boardObject = new GameObject("Store board"); boardObject.transform.SetParent(local.transform);
                var board = boardObject.AddComponent<BoardController>();
                var store = local.AddComponent<StoreAppAdapter>(); store.Initialize(product, runs, billing, board);
                Assert.That(store, Is.InstanceOf<IAppPageSource>());
                yield return Rendered(store, AppPage.Home);
                store.Navigate(AppPage.Campaign); yield return Rendered(store, AppPage.Campaign);
                store.Flow.Campaign.Preview(store.Flow.Campaign.Realm, 1); yield return Rendered(store, AppPage.Level);
                store.Navigate(AppPage.Profile); yield return Rendered(store, AppPage.Profile);
                store.Navigate(AppPage.Settings); yield return Rendered(store, AppPage.Settings);
                store.Flow.PlayDaily(); yield return Rendered(store, AppPage.Result);
                Assert.That(store.ResultPage().HasResult, Is.True);
            }
            finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
            yield return null;
        }

        // A page is absolute layout for one display. When the screen or its safe area
        // changes, the shared renderer draws the shown page again by itself, under
        // both identities and for a tab page and an identity panel alike.
        private static IEnumerator DrawnAgainForAnotherPhone(Component source, string page)
        {
            var shell = source.GetComponent<PageShell>(); var views = source.GetComponent<PageViews>();
            Rect[] Pieces() => source.GetComponentsInChildren<UnityEngine.UI.Button>().Where(button => button.gameObject.activeInHierarchy)
                .Select(button => SkinUi.ScreenRect((RectTransform)button.transform)).ToArray();
            string Shown() => views.Shown?.ToString() ?? views.ShownPanel;
            // The page before this one keeps its pieces while it fades; it is gone before anything is measured.
            var leaving = (ICollection)typeof(PageShell).GetField("leaving", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(shell);
            for (float until = Time.realtimeSinceStartup + 5; leaving.Count != 0 && Time.realtimeSinceStartup < until;) yield return null;
            Assert.That(leaving.Count, Is.Zero, page + ": the page before it never left");
            try
            {
                ZKube.Tests.Presentation.Phones.Seeker(shell); yield return null; yield return null;
                string shown = Shown();
                Assert.That(Pieces().Max(rect => rect.xMax), Is.GreaterThan(ZKube.Tests.Presentation.Phones.CompactScreen.width), page + ": drawn for the Seeker");
                // Only the display changes: nothing navigates and nothing asks for a draw.
                ZKube.Tests.Presentation.Phones.Compact(shell); yield return null; yield return null;
                Assert.That(Shown(), Is.EqualTo(shown), page + ": the same page");
                var compact = ZKube.Tests.Presentation.Phones.CompactScreen;
                Assert.That(Pieces(), Is.Not.Empty, page);
                foreach (var rect in Pieces())
                    Assert.That(rect.xMin >= compact.xMin - .5f && rect.xMax <= compact.xMax + .5f, Is.True, page + ": a piece was left where the other phone had it: " + rect);
                Assert.That(Pieces().Max(rect => rect.yMax), Is.LessThanOrEqualTo(shell.SafeArea.yMax + .5f), page + ": under the new safe area's top");
            }
            finally { ZKube.Tests.Presentation.Phones.Clear(shell); }
            yield return null; yield return null;
        }
        [UnityTest] public IEnumerator AChangedDisplayDrawsThePageAgainUnderBothIdentityImplementations()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyIdentity>().Controller;
            yield return Wait(money.OpenDaily()); yield return Rendered(money, AppPage.Home);
            yield return DrawnAgainForAnotherPhone(money, "Arena home");
            money.Navigate(AppPage.Settings); yield return Rendered(money, AppPage.Settings);
            yield return DrawnAgainForAnotherPhone(money, "Arena settings");
            yield return Wait(money.OpenSession()); yield return Idle();
            Assert.That(money.GetComponent<PageViews>().ShownPanel, Is.EqualTo("Device"));
            yield return DrawnAgainForAnotherPhone(money, "Arena device panel");
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);

            var local = new GameObject("Store page source");
            CampaignBilling billing = null;
            try
            {
                var product = new LocalProductStore(_ => null, (_, __) => { });
                var runs = new StoreRunClient(product, environment.Clock);
                billing = new CampaignBilling(new PageStore(),
                    () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
                var boardObject = new GameObject("Store board"); boardObject.transform.SetParent(local.transform);
                var board = boardObject.AddComponent<BoardController>();
                var store = local.AddComponent<StoreAppAdapter>(); store.Initialize(product, runs, billing, board);
                yield return Rendered(store, AppPage.Home);
                yield return DrawnAgainForAnotherPhone(store, "Realms home");
                store.Navigate(AppPage.Settings); yield return Rendered(store, AppPage.Settings);
                yield return DrawnAgainForAnotherPhone(store, "Realms settings");
            }
            finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
            yield return null;
        }

        [UnityTest] public IEnumerator CampaignStaysVisibleWhenAnEarlierOverviewReadCompletes()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyIdentity>().Controller;
            delay = environment.HoldNextRead("getMultipleAccounts");
            var overview = money.RefreshOverview(); yield return Wait(delay.Entered);
            try
            {
                yield return Wait(money.OpenCampaign()); yield return Rendered(money, AppPage.Campaign);
                delay.Release(); yield return Wait(overview);
                yield return Rendered(money, AppPage.Campaign);
                Assert.That(money.BrowsingCampaign, Is.True);
                Assert.That(money.GetComponentsInChildren<CampaignPathGraphic>().Length, Is.EqualTo(1));
                Assert.That(environment.SentSignature, Is.Null);
            }
            finally { delay.Release(); }
        }

        private static IEnumerator Rendered(Component source, AppPage page)
        {
            var views = source.GetComponent<PageViews>(); var shell = source.GetComponent<PageShell>();
            float until = Time.realtimeSinceStartup + 15;
            while ((!Equals(views.Shown, page) || shell.Loading) && Time.realtimeSinceStartup < until)
                yield return null;
            Assert.That(views.Shown, Is.EqualTo(page));
            Assert.That(shell.ArtworkError, Is.Null);
            Assert.That(source.GetComponentsInChildren<TMP_Text>().Any(text => !string.IsNullOrEmpty(text.text)), Is.True);
            yield return null;
        }
    }
}
