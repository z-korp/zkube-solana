using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
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
            StringAssert.Contains("Balance · 25", SessionText());
            Assert.That(environment.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
            var offers = host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Buy ")).Select(button => button.name).ToArray();
            Assert.That(offers, Is.EquivalentTo(new[] { "Buy 1 Kredit · 0.01 SOL", "Buy 10 Kredits · 0.1 SOL", "Buy 25 Kredits · 0.25 SOL" }));
            Canvas.ForceUpdateCanvases();
            foreach (var button in host.GetComponentsInChildren<Button>().Where(button => button.name.StartsWith("Buy ")))
            {
                var label = button.GetComponentInChildren<TMPro.TMP_Text>(); label.ForceMeshUpdate();
                Assert.That(label.preferredHeight, Is.LessThanOrEqualTo(label.rectTransform.rect.height + 1), button.name);
            }
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(pack)); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            StringAssert.DoesNotContain(environment.SentSignature, Text("Transaction receipt"));
            yield return SessionClick("Receipt details"); yield return Idle();
            StringAssert.Contains(environment.SentSignature, Text("Transaction receipt"));
            yield return SessionClick("Receipt details"); yield return Idle();
            StringAssert.DoesNotContain(environment.SentSignature, Text("Transaction receipt"));
            StringAssert.Contains("Balance · " + (25 + pack), SessionText());
            var exact = controller.LastReceipt;
            controller.SendMessage("OnApplicationPause", true); controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.HasActiveKey, Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DecliningThePurchaseKeepsTheBalance() => RefusedPurchase("kredit-owner-decline", ExecutionOutcome.Rejected, 1);
        [UnityTest] public IEnumerator FeeShortageDoesNotRequestAnOwnerSignature() => RefusedPurchase("kredit-fee-shortage", ExecutionOutcome.FeeShortage, 0);
        private IEnumerator RefusedPurchase(string scenario, ExecutionOutcome expected, int signatures)
        {
            yield return PrepareDeviceScenario(scenario, page: "Kredits");
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(environment.KreditPack)); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt.Outcome, Is.EqualTo(expected));
            StringAssert.Contains("Balance · 25", SessionText());
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
            StringAssert.Contains("Balance · 25", SessionText());
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Buy ")), Is.False);
            int checks = environment.Calls.Count(call => call.Operation == "getSignatureStatuses");
            yield return SessionClick("Refresh Kredits"); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "getSignatureStatuses"), Is.EqualTo(checks));
            yield return Wait(controller.PurchaseKredits(pack));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            if (failure) environment.ConfirmPendingFailure(); else environment.ConfirmPendingSuccess();
            yield return SessionClick("Check transaction"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(failure ? ExecutionOutcome.ConfirmedFailure : ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            StringAssert.Contains("Balance · " + (failure ? 25 : 25 + pack), SessionText());
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator DisconnectDuringPurchaseApprovalRemovesTheShopAndPreventsSend()
        {
            yield return PrepareDeviceScenario("kredit-buy-1", page: "Kredits");
            var controller = host.GetComponent<MoneyIdentity>().Controller; var hold = environment.HoldNextWallet();
            var operation = controller.PurchaseKredits(1);
            try
            {
                yield return Wait(hold.Entered);
                yield return Wait(controller.PurchaseKredits(1));
                Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
                var disconnect = controller.Disconnect();
                Assert.That(controller.BrowsingKredits, Is.False); Assert.That(controller.LastReceipt, Is.Null);
                hold.Release(); yield return Wait(operation); yield return Wait(disconnect);
                Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction"), Is.False);
                Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Buy ")), Is.False);
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
        }

        [UnityTest] public IEnumerator PurchaseApprovalHeldAcrossDisableCannotOpenARunOrEnableADevice()
        {
            yield return PrepareDeviceScenario("kredit-buy-1", page: "Kredits");
            var controller = host.GetComponent<MoneyIdentity>().Controller; var hold = environment.HoldNextWallet();
            var operation = controller.PurchaseKredits(1);
            try
            {
                yield return Wait(hold.Entered); controller.enabled = false; yield return null;
                controller.enabled = true; yield return null;
                Assert.That(controller.EconomyActionPending, Is.True);
                Assert.That(controller.Busy, Is.True, "A fresh read waits for the outstanding owner operation to drain");
                Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Buy ")), Is.False);
                Assert.That(host.GetComponentsInChildren<Button>().Where(button => button.name != "Disconnect").All(button => !button.interactable), Is.True);
                int before = environment.Calls.Count;
                yield return Wait(controller.EnsureDeviceSession());
                yield return Wait(controller.ResumeCampaignRun());
                Assert.That(environment.Calls.Count, Is.EqualTo(before));
                Assert.That(controller.PlayingRun, Is.False);
                hold.Release(); yield return Wait(operation); yield return Idle();
                Assert.That(controller.EconomyActionPending, Is.False);
                Assert.That(controller.BrowsingKredits, Is.True);
                StringAssert.Contains("Balance · 25", SessionText());
                Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction"), Is.False);
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
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
            StringAssert.Contains("Balance · 35", SessionText());
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
