using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private static readonly AppPage[] TabPages = { AppPage.Home, AppPage.Campaign, AppPage.Profile, AppPage.Settings };

        // Both products' tab bars, every tab selected in turn on both phones: the
        // selected tab's icon and label sit on the chip in its dark ink, the
        // others in the pale one; each bar is captured. The icons' inner lines are
        // checked on their art (test_every_tab_icon_keeps_its_inner_lines_when_selected).
        [UnityTest] public IEnumerator EveryTabSelectsInTurnInBothProductsOnBothPhones()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyIdentity>().Controller;
            yield return EveryTab(money, "arena", money.Navigate);

            // The Arena's pages leave the screen to the Realms ones.
            money.GetComponent<PageShell>().Show(false);
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
                // Every guardian has greeted, so the map shows its tab bar.
                store.GetComponent<PageViews>().Greetings = new GuardianGreetings(() => ~0, _ => { });
                yield return Rendered(store, AppPage.Home);
                yield return EveryTab(store, "realms", store.Navigate);
            }
            finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
            yield return null;
        }

        private IEnumerator EveryTab(Component source, string product, Action<AppPage> open)
        {
            var shell = source.GetComponent<PageShell>();
            try
            {
                foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Compact, "compact"), (Phones.Seeker, "seeker") })
                {
                    phone(shell, 1);
                    // Leave the last tab first, so the first one draws again at this phone.
                    open(AppPage.Settings); yield return Rendered(source, AppPage.Settings);
                    for (int tab = 0; tab < TabPages.Length; tab++)
                    {
                        open(TabPages[tab]); yield return Rendered(source, TabPages[tab]);
                        string at = product + " " + TabPages[tab] + " on the " + size + " phone";
                        var bar = shell.Chrome.GetComponentsInChildren<SkinTabBar>().SingleOrDefault();
                        Assert.That(bar, Is.Not.Null, at + ": the tab bar is drawn; chrome holds " + string.Join(", ", shell.Chrome.Cast<Transform>().Select(child => child.name + (child.gameObject.activeSelf ? "" : " (off)"))));
                        Assert.That(bar.Selected, Is.EqualTo(tab), at);
                        AssertSelected(bar, tab, at);
                        // The page's motion settles before the bar is captured.
                        yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + Mathf.Max(PageShell.EnterSeconds, PageShell.GlowSeconds) + .05f);
                        var area = SkinUi.ScreenRect((RectTransform)bar.transform);
                        yield return Captures.Snap(new Rect(area.x - 8, area.y - 8, area.width + 16, area.height + 16), "tabs " + product + " " + TabPages[tab] + " " + size);
                    }
                }
            }
            finally { Phones.Clear(shell); }
        }

        private static void AssertSelected(SkinTabBar bar, int selected, string at)
        {
            var parts = bar.GetComponentsInChildren<Image>(true);
            var chip = SkinUi.ScreenRect(parts.Single(image => image.name == "Tab bar selected").rectTransform);
            var icons = parts.Where(image => image.name.EndsWith(" icon")).OrderBy(image => SkinUi.ScreenRect(image.rectTransform).x).ToArray();
            Assert.That(icons.Length, Is.EqualTo(TabPages.Length), at + ": four tab icons");
            for (int tab = 0; tab < icons.Length; tab++)
            {
                var icon = SkinUi.ScreenRect(icons[tab].rectTransform);
                bool onChip = chip.Contains(icon.min) && chip.Contains(icon.max - new Vector2(.01f, .01f));
                Assert.That(onChip, Is.EqualTo(tab == selected), at + ": only the selected icon sits on the chip");
                Assert.That(icons[tab].color, Is.EqualTo(bar.Ink(tab)), at + ": an icon wears its label's ink");
            }
            Assert.That(bar.Ink(selected), Is.Not.EqualTo(bar.Ink((selected + 1) % icons.Length)), at + ": the selected ink differs");
        }
    }
}
