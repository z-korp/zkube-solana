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
            var money = host.GetComponent<MoneyStartup>().Controller;
            Assert.That(money, Is.InstanceOf<IAppPageSource>());
            yield return Wait(money.OpenCampaign()); yield return Rendered(money, AppPage.Campaign);
            Click("Trial 1"); yield return Rendered(money, AppPage.Level);
            yield return Wait(money.OpenDaily()); yield return Rendered(money, AppPage.Daily);
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
                product.Write(state => { state.Name = "Local player"; return state; });
                var attempt = runs.StartDaily(); runs.Act(attempt.View.RunId, new LocalRunAction(LocalActionKind.Finish));
                billing = new CampaignBilling(new PageStore(),
                    () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
                var boardObject = new GameObject("Store board"); boardObject.transform.SetParent(local.transform);
                var board = boardObject.AddComponent<BoardController>();
                var store = local.AddComponent<StoreAppAdapter>(); store.Initialize(product, runs, billing, board);
                Assert.That(store, Is.InstanceOf<IAppPageSource>());
                yield return Rendered(store, AppPage.Daily);
                store.Navigate(AppPage.Campaign); yield return Rendered(store, AppPage.Campaign);
                store.Flow.Preview(1); yield return Rendered(store, AppPage.Level);
                store.Navigate(AppPage.Profile); yield return Rendered(store, AppPage.Profile);
                store.Navigate(AppPage.Settings); yield return Rendered(store, AppPage.Settings);
                store.Flow.PlayDaily(); yield return Rendered(store, AppPage.Result);
                Assert.That(store.ResultPage().HasResult, Is.True);
            }
            finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
            yield return null;
        }

        [UnityTest] public IEnumerator CampaignStaysVisibleWhenAnEarlierOverviewReadCompletes()
        {
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyStartup>().Controller;
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
            var pages = source.GetComponent<AppPages>();
            var field = typeof(AppPages).GetField("previousPage", BindingFlags.Instance | BindingFlags.NonPublic);
            float until = Time.realtimeSinceStartup + 15;
            while ((!Equals(field.GetValue(pages), page) || source.GetComponent<AppShell>().Loading) && Time.realtimeSinceStartup < until)
                yield return null;
            Assert.That(field.GetValue(pages), Is.EqualTo(page));
            Assert.That(source.GetComponent<AppShell>().ArtworkError, Is.Null);
            Assert.That(source.GetComponentsInChildren<TMP_Text>().Any(text => !string.IsNullOrEmpty(text.text)), Is.True);
            yield return null;
        }
    }
}
