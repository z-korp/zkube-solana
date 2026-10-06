using System;
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The placement rule's guard (owner, 2026-10-06): every page of both apps, at
    // both phones, hands its controls over by role, and each stands in its role's
    // one place (Placement.Check says which). This walk takes each page that
    // has moved onto the composer; the tests that walk a page's every state call
    // the same check (the Boards page's kinds of day, the Arena's result, the
    // pause and its confirm at both text sizes).
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator Held(Component source, string at)
        {
            var shell = source.GetComponent<PageShell>();
            var leaving = (ICollection)typeof(PageShell).GetField("leaving", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic).GetValue(shell);
            for (float until = Time.realtimeSinceStartup + 5; leaving.Count != 0 && Time.realtimeSinceStartup < until;) yield return null;
            yield return null; Canvas.ForceUpdateCanvases();
            Placement.Check(source.transform, shell.SafeArea, 1, at);
            yield return Captures.Snap(shell, "placement " + at);
        }

        [UnityTest] public IEnumerator EveryPagePlacesItsControlsByRole()
        {
            foreach (var (use, phone) in new (Action<PageShell>, string)[] { (shell => Phones.Seeker(shell), "Seeker"), (shell => Phones.Compact(shell), "360 x 640") })
            {
                // The Arena.
                yield return PrepareScenario("claim-score-sealed"); use(host.GetComponent<PageShell>());
                yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                Click("Connect"); yield return Idle();
                yield return Wait(Adapter.OpenRewards(environment.ClaimDay, "score")); yield return Idle();
                yield return Held(host.transform, phone + " Arena boards with a reward to claim");
                yield return Wait(Adapter.OpenRewards(environment.ClaimDay - 1)); yield return Idle();
                yield return Held(host.transform, phone + " Arena boards on a day without a Daily");
                yield return EndScenario();

                // Realms.
                var local = new GameObject("Store page source");
                CampaignBilling billing = null;
                try
                {
                    var product = new LocalProductStore(_ => null, (_, __) => { });
                    var runs = new StoreRunClient(product, () => (long)ZKube.Core.NativeEngine.Daily(20705).OpensAt);
                    var attempt = runs.StartDaily(); runs.Act(attempt.View.RunId, new LocalRunAction(LocalActionKind.Finish));
                    billing = new CampaignBilling(new PageStore(),
                        () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
                    var boardObject = new GameObject("Store board"); boardObject.transform.SetParent(local.transform);
                    var board = boardObject.AddComponent<BoardController>();
                    var store = local.AddComponent<StoreAppAdapter>(); store.Initialize(product, runs, billing, board);
                    yield return Rendered(store, AppPage.Home);
                    use(store.GetComponent<PageShell>()); yield return null; yield return null;
                    store.Flow.PlayDaily(); yield return Rendered(store, AppPage.Result);
                    yield return Held(store, phone + " Realms Daily result");
                }
                finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
                yield return null;
            }
        }
    }
}
