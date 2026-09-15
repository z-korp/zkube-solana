using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator OpenAcceptedCampaign()
        {
            yield return PrepareEvidence("owner-overview");
            yield return SessionClick("Connect"); yield return Idle();
            yield return SessionClick("Campaign"); yield return Idle();
            yield return SessionClick("Resume Campaign"); yield return Idle();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            Assert.That(controller.PlayingRun, Is.True);
            float until = Time.realtimeSinceStartup + 15;
            var run = host.GetComponent<MoneyBoardHost>();
            while (!run.Board.Ready && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(run.Board.Ready, Is.True, run.Board.ReadinessIssue);
        }

        [UnityTest] public IEnumerator CampaignResumeInputBindsTheSavedNativeStateWithoutRequestingAnotherRun()
        {
            yield return OpenAcceptedCampaign();
            var run = host.GetComponent<MoneyBoardHost>();
            var observed = evidence.Services.Runs.Inspect("campaign"); yield return Wait(observed);
            var state = observed.GetAwaiter().GetResult();
            Assert.That(run.Board.Session.Accepted.State, Is.EqualTo(state.Token.State));
            Assert.That(run.Board.PresentedRealmId, Is.EqualTo(run.Board.Session.RealmId));
            Assert.That(run.Board.HostInputEnabled, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Start trial" || button.name == "Resume Campaign"), Is.False);
            Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator ForegroundKeepsInputLockedUntilTheBoundObservationCompletes()
        {
            yield return OpenAcceptedCampaign();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var run = host.GetComponent<MoneyBoardHost>();
            var held = evidence.HoldNextRead("getAccountInfo");
            try
            {
                controller.SendMessage("OnApplicationPause", true);
                Assert.That(run.Board.HostInputEnabled, Is.False);
                controller.SendMessage("OnApplicationPause", false);
                yield return Wait(held.Entered);
                Assert.That(run.Board.HostInputEnabled, Is.False);
                held.Release();
                float until = Time.realtimeSinceStartup + 15;
                while (!run.Board.HostInputEnabled && Time.realtimeSinceStartup < until) yield return null;
                Assert.That(run.Board.HostInputEnabled, Is.True);
                Assert.That(run.Board.Paused, Is.True, "Fresh observation leaves an explicit Resume choice");
                Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
                Assert.That(evidence.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); }
        }

        [UnityTest] public IEnumerator DisconnectLocksTheVisibleBoardBeforeAwaitingWalletCleanup()
        {
            yield return OpenAcceptedCampaign();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var board = host.GetComponent<MoneyBoardHost>().Board;
            var disconnect = controller.Disconnect();
            Assert.That(board.HostInputEnabled, Is.False);
            yield return Wait(disconnect); yield return null;
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(evidence.Services.Identity.Owner, Is.Null);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator AForegroundReadCompletingDuringAnotherPauseCannotUnlockTheBoard()
        {
            yield return OpenAcceptedCampaign();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var run = host.GetComponent<MoneyBoardHost>();
            var held = evidence.HoldNextRead("getAccountInfo");
            try
            {
                controller.SendMessage("OnApplicationPause", true);
                controller.SendMessage("OnApplicationPause", false);
                yield return Wait(held.Entered);
                controller.SendMessage("OnApplicationPause", true);
                held.Release();
                // This owner read shares the flow gate, so completion proves
                // the held observation has released it. Allow its Unity
                // continuation to run before inspecting visible input.
                yield return Wait(controller.Flow.RefreshOwner()); yield return null;
                Assert.That(run.Board.HostInputEnabled, Is.False);
                Assert.That(run.Board.Paused, Is.True);
                var next = evidence.HoldNextRead("getAccountInfo");
                try
                {
                    controller.SendMessage("OnApplicationPause", false);
                    yield return Wait(next.Entered);
                    Assert.That(run.Board.HostInputEnabled, Is.False);
                    next.Release();
                    float until = Time.realtimeSinceStartup + 15;
                    while (!run.Board.HostInputEnabled && Time.realtimeSinceStartup < until) yield return null;
                    Assert.That(run.Board.HostInputEnabled, Is.True);
                    Assert.That(run.Board.Paused, Is.True);
                }
                finally { next.Release(); }
                Assert.That(evidence.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
                Assert.That(evidence.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); }
        }

        [UnityTest] public IEnumerator AnObservationReleasedAfterCloseCannotRestoreTheRetiredBoard()
        {
            yield return OpenAcceptedCampaign();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var run = host.GetComponent<MoneyBoardHost>();
            var held = evidence.HoldNextRead("getAccountInfo");
            try
            {
                controller.SendMessage("OnApplicationPause", true);
                controller.SendMessage("OnApplicationPause", false);
                yield return Wait(held.Entered);
                run.Close();
                Assert.That(run.HasRun, Is.False);
                held.Release(); yield return Idle(); yield return null;
                Assert.That(controller.PlayingRun, Is.False);
                Assert.That(run.Board, Is.Null);
                Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(), Is.Empty);
                Assert.That(evidence.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); }
        }

        [UnityTest] public IEnumerator HidingThePageRetiresOnlyItsBoardAndPreservesTheSavedRun()
        {
            yield return OpenAcceptedCampaign();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var marker = evidence.Services.RunMarkers.Load(evidence.Owner, "campaign"); yield return Wait(marker);
            Assert.That(marker.GetAwaiter().GetResult(), Is.Not.Null);
            controller.enabled = false; yield return null;
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(), Is.Empty);
            var retained = evidence.Services.RunMarkers.Load(evidence.Owner, "campaign"); yield return Wait(retained);
            Assert.That(retained.GetAwaiter().GetResult().ActiveRun, Is.EqualTo(marker.GetAwaiter().GetResult().ActiveRun));
            controller.enabled = true; yield return Idle();
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(evidence.ForbiddenCalls, Is.Zero);
        }
    }
}
