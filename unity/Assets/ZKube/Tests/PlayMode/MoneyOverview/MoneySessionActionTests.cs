using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.App.Tests;
using ZKube.Integration.Execution;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator PrepareDeviceScenario(string scenario, float scale = 1, string page = "This device")
        {
            yield return PrepareScenario(scenario, scale);
            yield return SessionClick("Connect"); yield return Idle();
            // Connect opens the Arcade; the device is managed from Settings.
            if (page == "This device") yield return OpenDevice();
            else if (page != "Arcade") { yield return SessionClick(page); yield return Idle(); }
        }
        [UnityTest] public IEnumerator EnableButtonConfirmsAndReadsBackReadyWithoutGameplay()
        {
            yield return PrepareDeviceScenario("session-enable-success", 1.3f);
            Assert.That(environment.SentSignature, Is.Null);
            StringAssert.Contains("spends your prepaid Kredits", SessionText());
            yield return SessionClick("Enable device"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            Assert.That(Text("Device state"), Is.EqualTo("Session active"));
            Assert.That(environment.HasActiveKey, Is.True);
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(true), Is.Empty);
            Canvas.ForceUpdateCanvases();
            foreach (var text in host.GetComponentsInChildren<TMP_Text>())
            { text.ForceMeshUpdate(); Assert.That(text.preferredHeight, Is.LessThanOrEqualTo(text.rectTransform.rect.height + 1), text.name); }
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator RefillUsesExistingKeyAndAReadOnlyForegroundDoesNotRepeatIt()
        {
            yield return PrepareDeviceScenario("session-refill-success");
            Assert.That(environment.HasActiveKey, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Renew device"), Is.False);
            yield return SessionClick("Refill allowance"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            var exact = controller.LastReceipt; var signature = environment.SentSignature;
            // Refilling funds the existing token; it does not extend its expiry.
            Assert.That(Text("Device state"), Is.EqualTo("Session expires soon"));
            StringAssert.DoesNotContain("Fee allowance low", SessionText());
            int calls = environment.Calls.Count(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions");
            controller.SendMessage("OnApplicationPause", true);
            controller.SendMessage("OnApplicationPause", false); yield return Idle();
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.EqualTo(calls));
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            Assert.That(environment.SentSignature, Is.EqualTo(signature));
            Assert.That(environment.HasActiveKey, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator PendingDisableKeepsTheInstallKeyAndRevokesAfterConfirmation()
        {
            yield return PrepareDeviceScenario("session-disable-pending-success");
            yield return SessionClick("Disable this device"); yield return Idle();
            StringAssert.Contains("Revoke device access?", SessionText());
            StringAssert.Contains("The remaining fee allowance returns to your wallet.", SessionText());
            yield return SessionClick("Disable in wallet"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            var signature = controller.LastReceipt.Signature;
            Assert.That(environment.HasActiveKey, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Disable this device"), Is.False);
            environment.ConfirmPendingSuccess(); yield return SessionClick("Check transaction"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            Assert.That(environment.HasActiveKey, Is.True);
            Assert.That(Text("Device state"), Is.EqualTo("Device disabled"));
            Assert.That(environment.Services.Identity.Owner, Is.EqualTo(environment.Owner));
            var exact = controller.LastReceipt;
            // A late duplicate Check callback sees an empty journal. It must
            // keep the signed result even though the button is now absent.
            yield return Wait(controller.CheckTransaction()); yield return Idle();
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            yield return SessionClick("View operation"); yield return Idle();
            yield return SessionClick("Receipt details"); yield return Idle();
            StringAssert.Contains(signature, Text("Transaction receipt"));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator EmptyAllowanceDisableStillRevokesTheToken()
        {
            yield return PrepareDeviceScenario("session-disable-zero");
            yield return SessionClick("Disable this device"); yield return Idle();
            yield return SessionClick("Disable in wallet"); yield return Idle();
            var receipt = host.GetComponent<MoneyIdentity>().Controller.LastReceipt;
            Assert.That(receipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess), receipt.Code);
            Assert.That(environment.HasActiveKey, Is.True); Assert.That(environment.SentSignature, Is.Not.Null);
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(Text("Device state"), Is.EqualTo("Device disabled"));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator FailedEnableKeepsItsOriginalReceiptAndDoesNotReportReady()
        {
            yield return PrepareDeviceScenario("session-enable-pending-failure");
            yield return SessionClick("Enable device"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller;
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            var signature = controller.LastReceipt.Signature;
            environment.ConfirmPendingFailure(); yield return SessionClick("Check transaction"); yield return Idle();
            Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
            Assert.That(controller.LastReceipt.Signature, Is.EqualTo(signature));
            StringAssert.Contains("Transaction failed", Text("Transaction receipt"));
            Assert.That(Text("Device state"), Is.Not.EqualTo("Session active"));
            Assert.That(environment.HasActiveKey, Is.True);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator AWalletRequestAcrossDisableAndForegroundCannotCreateASecondRequest()
        {
            yield return PrepareDeviceScenario("session-enable-success");
            var hold = environment.HoldNextWallet();
            yield return SessionClick("Enable device");
            try
            {
                yield return Wait(hold.Entered);
                var controller = host.GetComponent<MoneyIdentity>().Controller;
                Assert.That(controller.SessionActionPending, Is.True);
                controller.enabled = false;
                controller.SendMessage("OnApplicationPause", true);
                controller.SendMessage("OnApplicationPause", false);
                Assert.That(host.GetComponentsInChildren<GraphicRaycaster>(), Is.Empty);
                controller.enabled = true; yield return Idle();
                Assert.That(controller.SessionActionPending, Is.True);
                Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Enable device"), Is.False);
                hold.Release();
                float end = Time.realtimeSinceStartup + 15;
                while (controller.SessionActionPending && Time.realtimeSinceStartup < end) yield return null;
                Assert.That(controller.SessionActionPending, Is.False); yield return null; yield return Idle();
                Assert.That(Text("Device state"), Is.EqualTo("Session active"));
                Assert.That(controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
                Assert.That(controller.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
                Assert.That(controller.LastReceipt.Intent, Is.EqualTo("session-renew"));
                StringAssert.Contains("Transaction confirmed", Text("Transaction receipt"));
                Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
        }

        [UnityTest] public IEnumerator DisconnectDuringApprovalClearsIdentityAndLateSuccessCannotSendOrRestoreThePanel()
        {
            yield return PrepareDeviceScenario("session-enable-success");
            var hold = environment.HoldNextWallet();
            yield return SessionClick("Enable device");
            try
            {
                yield return Wait(hold.Entered); yield return Drawn();
                var controller = host.GetComponent<MoneyIdentity>().Controller;
                yield return SessionClick("Disconnect");
                Assert.That(environment.Services.Identity.Owner, Is.Null);
                Assert.That(controller.BrowsingSession, Is.False);
                Assert.That(controller.LastReceipt, Is.Null);
                hold.Release(); yield return null; yield return Idle();
                Assert.That(controller.LastReceipt, Is.Null);
                Assert.That(environment.SentSignature, Is.Null);
                Assert.That(host.GetComponent<ZKube.Presentation.PageViews>().ShownPanel, Is.EqualTo("Connect"));
                StringAssert.DoesNotContain("Session active", SessionText());
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { hold.Release(); }
        }
        [UnityTest] public IEnumerator DeclinedSetupIsNotReadyAndDoesNotSend()
        {
            yield return PrepareDeviceScenario("session-owner-decline");
            yield return SessionClick("Enable device"); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Rejected));
            StringAssert.Contains("not accepted", Text("Transaction receipt"));
            Assert.That(Text("Device state"), Is.Not.EqualTo("Session active"));
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator FeeShortageDoesNotPromptAndRetainsItsSpecificReceipt()
        {
            yield return PrepareDeviceScenario("session-fee-shortage");
            yield return SessionClick("Enable device"); yield return Idle();
            Assert.That(host.GetComponent<MoneyIdentity>().Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.FeeShortage));
            StringAssert.Contains("not enough SOL", Text("Transaction receipt"));
            Assert.That(environment.Calls.Any(call => call.Operation == "signTransactions" || call.Operation == "sendTransaction"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator MalformedPostConfirmationReadbackDoesNotEraseReceiptOrRepeatSetup()
        {
            yield return PrepareDeviceScenario("session-enable-success");
            environment.CorruptFirstReadAfterJournalClear();
            yield return SessionClick("Enable device"); yield return Idle();
            var controller = host.GetComponent<MoneyIdentity>().Controller; var exact = controller.LastReceipt;
            Assert.That(environment.Calls.Count(call => call.Operation == "injected-token-owner-after-journal-clear"), Is.EqualTo(1));
            Assert.That(exact.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(exact.Signature, Is.EqualTo(environment.SentSignature)); Assert.That(exact.Intent, Is.EqualTo("session-renew"));
            StringAssert.Contains("Transaction confirmed", Text("Transaction receipt"));
            // The following valid observation can establish readiness; the
            // malformed first read itself never does (covered by Flow test).
            Assert.That(Text("Device state"), Is.EqualTo("Session active"));
            yield return Wait(controller.RefreshOverview()); yield return Idle();
            Assert.That(controller.LastReceipt, Is.SameAs(exact));
            Assert.That(environment.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.Calls.Count(call => call.Operation == "signTransactions"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
