using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Presentation;
using ZKube.Integration.App;
using ZKube.Integration.Execution;
using ZKube.Integration.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        [UnityTest] public IEnumerator OneKreditButtonUsesTheOwnerPurchaseAndConfirmedBalance() => PurchasePack(1);
        [UnityTest] public IEnumerator TenKreditButtonUsesTheOwnerPurchaseAndConfirmedBalance() => PurchasePack(10);
        [UnityTest] public IEnumerator TwentyFiveKreditButtonUsesTheOwnerPurchaseAndConfirmedBalance() => PurchasePack(25);

        private IEnumerator PurchasePack(uint pack)
        {
            yield return PrepareDeviceScenario("kredit-buy-" + pack, 1.3f, "Kredits");
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.BrowsingKredits, Is.True);
            Assert.That(Text("Kredit balance"), Is.EqualTo("25"));
            Assert.That(environment.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
            var offers = host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Buy ")).Select(button => button.name).ToArray();
            Assert.That(offers, Is.EquivalentTo(new[] { "Buy 1 Kredit · 0.01 SOL", "Buy 10 Kredits · 0.10 SOL", "Buy 25 Kredits · 0.25 SOL" }));
            Canvas.ForceUpdateCanvases();
            foreach (var button in host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Buy ")))
            {
                var label = button.GetComponentInChildren<TMPro.TMP_Text>(); label.ForceMeshUpdate();
                Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height + 1), button.name);
            }
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(pack)); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            Assert.That(Text("Kredit balance"), Is.EqualTo((25 + pack).ToString()));
            Assert.That(host.GetComponentsInChildren<UnityEngine.UI.Image>().Any(image => image.name == "Receipt card"), Is.False, "The page carries no receipt card");
            // The last operation, behind Settings, shows the whole signature on request.
            controller.Navigate(AppPage.Settings); yield return Idle();
            yield return SessionClick("Last operation"); yield return Idle();
            StringAssert.DoesNotContain(environment.SentSignature, Text("Transaction receipt"));
            yield return SessionClick("Receipt details"); yield return Idle();
            StringAssert.Contains(environment.SentSignature, Text("Transaction receipt"));
            yield return SessionClick("Receipt details"); yield return Idle();
            StringAssert.DoesNotContain(environment.SentSignature, Text("Transaction receipt"));
            yield return SessionClick("Back"); yield return Idle();
            yield return Wait(controller.OpenKredits()); yield return Idle();
            Assert.That(Text("Kredit balance"), Is.EqualTo((25 + pack).ToString()));
            var exact = controller.LastReceipt;
            controller.SendMessage("OnApplicationPause", true); controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            // The purchase made the install key that signed it before the wallet did, and no session.
            Assert.That(environment.HasActiveKey, Is.True);
            var saved = environment.Services.Sessions.Load(environment.Owner); yield return Wait(saved);
            Assert.That(saved.GetAwaiter().GetResult().Active, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DecliningThePurchaseKeepsTheBalance() => RefusedPurchase("kredit-owner-decline", ExecutionOutcome.Rejected, 1);
        [UnityTest] public IEnumerator FeeShortageDoesNotRequestAnOwnerSignature() => RefusedPurchase("kredit-fee-shortage", ExecutionOutcome.FeeShortage, 0);
        private IEnumerator RefusedPurchase(string scenario, ExecutionOutcome expected, int signatures)
        {
            yield return PrepareDeviceScenario(scenario, page: "Kredits");
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(environment.KreditPack)); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt.Outcome, Is.EqualTo(expected));
            Assert.That(Text("Kredit balance"), Is.EqualTo("25"));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(signatures));
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator PendingSuccessChangesBalanceOnlyAfterAnExplicitCheck() => PendingPurchase(false);
        [UnityTest] public IEnumerator PendingFailureKeepsTheOriginalBalanceAndReceipt() => PendingPurchase(true);
        private IEnumerator PendingPurchase(bool failure)
        {
            yield return PrepareDeviceScenario(failure ? "kredit-pending-failure" : "kredit-pending-success", page: "Kredits");
            uint pack = environment.KreditPack;
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(pack)); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller; string signature = controller.LastReceipt.Signature;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            Assert.That(Text("Kredit balance"), Is.EqualTo("25"));
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Buy ")), Is.False);
            int checks = environment.Calls.Count(call => call.Operation == "getSignatureStatuses");
            yield return Wait(controller.RefreshOverview()); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(checks));
            yield return Wait(controller.PurchaseKredits(pack));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            if (failure) environment.ConfirmPendingFailure(); else environment.ConfirmPendingSuccess();
            yield return SessionClick("Try again"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(failure ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            Assert.That(Text("Kredit balance"), Is.EqualTo((failure ? 25 : 25 + pack).ToString()));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }



        [UnityTest] public IEnumerator ConfirmedPurchaseKeepsItsReceiptWhenBalanceReadbackFails()
        {
            yield return PrepareDeviceScenario("kredit-buy-10", page: "Kredits");
            environment.FailFirstReadAfterJournalClear();
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(10)); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            StringAssert.Contains("Transaction confirmed", Text("Transaction receipt"));
            yield return SessionClick("Refresh Kredits"); yield return Idle();
            Assert.That(Text("Kredit balance"), Is.EqualTo("35"));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
