using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Tests
{
    // The Realms Daily is one try a day, and an unfinished one comes back after
    // the app restarts: Home offers it again and its board opens where it was.
    public sealed partial class StoreAppPageJourneyTests
    {
        // The process dies and the app opens again over what was saved.
        private IEnumerator Reopen()
        {
            string saved = LocalProductCodec.Encode(product.Read);
            UnityEngine.Object.Destroy(app.gameObject); billing.Dispose(); board.gameObject.SetActive(false);
            yield return null;
            product = new LocalProductStore(_ => saved, (_, __) => { if (failSave) throw new InvalidOperationException("Injected save failure"); });
            runs = new StoreRunClient(product, () => (long)NativeEngine.Daily(20705).OpensAt);
            billing = new CampaignBilling(new Driver(), () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
            var appRoot = new GameObject("Store page controller"); appRoot.transform.SetParent(root.transform);
            app = appRoot.AddComponent<StoreAppAdapter>(); app.Initialize(product, runs, billing, board, accounts);
            greeted = ~0; Greet(app);
            yield return Page(StorePage.Home);
        }

        [UnityTest] public IEnumerator AnUnfinishedDailyIsResumedAfterTheAppRestarts()
        {
            Click(app, "Play today"); yield return BoardReady();
            yield return Play(BoardHint.Best(board.Session.Accepted).Value);
            byte[] played = runs.Active("daily").Token.State;
            Assert.That(product.Read.DailyAttempt.Finished, Is.False);

            yield return Reopen();
            Assert.That(FindButton(app, "Resume run").interactable, Is.True, "Home offers the unfinished attempt again");
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Play today" || text.text == "View result")), Is.False,
                "It is neither a new try nor a used one");
            Click(app, "Resume run"); yield return BoardReady();
            CollectionAssert.AreEqual(played, board.Session.Accepted.State, "The board opens where the run was");
            Assert.That(board.State.Moves, Is.EqualTo(1));
            // Played to its end, it is the day's result, and no second try is offered.
            yield return EndRun(); yield return Page(StorePage.Result);
            Assert.That(product.Read.DailyAttempt.Finished, Is.True); Assert.That(product.Read.DailyAttempt.Actions, Is.Empty);
            app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "View result")), Is.True);
            Assert.That(runs.Active("daily"), Is.Null);
        }
    }
}
