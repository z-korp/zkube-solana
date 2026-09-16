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
        [UnityTest] public IEnumerator CampaignResumeBindsItsDeviceLocalAcceptedState()
        {
            yield return PrepareScenario("owner-overview");
            yield return SessionClick("Connect"); yield return Idle();
            var local = environment.Services.Campaign(environment.Owner).Runs;
            var start = local.StartCampaign(1, 1);
            var accepted = local.Act(start.View.RunId, new ZKube.Local.LocalRunAction(ZKube.Local.LocalActionKind.Reroll));
            yield return SessionClick("Campaign"); yield return Idle();
            yield return SessionClick("Resume run"); yield return Idle();
            var board = host.GetComponent<MoneyBoardHost>().Board;
            float until = Time.realtimeSinceStartup + 15;
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(board) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(ZKube.Tests.Presentation.BoardTestState.Idle(board), Is.True, "Board is still busy or loading");
            CollectionAssert.AreEqual(accepted.View.Token.State, board.Session.Accepted.State);
            Assert.That(board.Session.Daily, Is.False);
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        private IEnumerator OpenAcceptedArcade()
        {
            yield return PrepareScenario("owner-overview");
            yield return SessionClick("Connect"); yield return Idle();
            yield return SessionClick("Daily"); yield return Idle();
            yield return SessionClick("Resume Daily"); yield return Idle();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            Assert.That(controller.PlayingRun, Is.True);
            float until = Time.realtimeSinceStartup + 15;
            var run = host.GetComponent<MoneyBoardHost>();
            while (!ZKube.Tests.Presentation.BoardTestState.Idle(run.Board) && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(ZKube.Tests.Presentation.BoardTestState.Idle(run.Board), Is.True, "Board is still busy or loading");
        }

        [UnityTest] public IEnumerator ArcadeResumeInputBindsTheSavedNativeStateWithoutRequestingAnotherRun()
        {
            yield return OpenAcceptedArcade();
            var run = host.GetComponent<MoneyBoardHost>();
            var observed = environment.Services.Runs.Inspect(); yield return Wait(observed);
            var state = observed.GetAwaiter().GetResult();
            Assert.That(run.Board.Session.Accepted.State, Is.EqualTo(state.Token.State));
            Assert.That(ZKube.Tests.Presentation.BoardTestState.Art(run.Board).RealmId, Is.EqualTo(run.Board.Session.RealmId));
            Assert.That(run.Board.HostInputEnabled, Is.True);
            Assert.That(host.GetComponentsInChildren<Button>().Any(button => button.name == "Play" || button.name == "Resume run"), Is.False);
            Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator ForegroundKeepsInputLockedUntilTheBoundObservationCompletes()
        {
            yield return OpenAcceptedArcade();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var run = host.GetComponent<MoneyBoardHost>();
            var held = environment.HoldNextRead("getAccountInfo");
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
                Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); }
        }

        [UnityTest] public IEnumerator DisconnectLocksTheVisibleBoardBeforeAwaitingWalletCleanup()
        {
            yield return OpenAcceptedArcade();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var board = host.GetComponent<MoneyBoardHost>().Board;
            var disconnect = controller.Disconnect();
            Assert.That(board.HostInputEnabled, Is.False);
            yield return Wait(disconnect); yield return null;
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(environment.Services.Identity.Owner, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        [UnityTest] public IEnumerator AForegroundReadCompletingDuringAnotherPauseCannotUnlockTheBoard()
        {
            yield return OpenAcceptedArcade();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var run = host.GetComponent<MoneyBoardHost>();
            var held = environment.HoldNextRead("getAccountInfo");
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
                var next = environment.HoldNextRead("getAccountInfo");
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
                Assert.That(environment.Calls.Any(call => call.Operation == "sendTransaction" || call.Operation == "signTransactions"), Is.False);
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); }
        }

        [UnityTest] public IEnumerator AnObservationReleasedAfterCloseCannotRestoreTheRetiredBoard()
        {
            yield return OpenAcceptedArcade();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var run = host.GetComponent<MoneyBoardHost>();
            var held = environment.HoldNextRead("getAccountInfo");
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
                Assert.That(environment.ForbiddenCalls, Is.Zero);
            }
            finally { held.Release(); }
        }

        [UnityTest] public IEnumerator HidingThePageRetiresOnlyItsBoardAndPreservesTheSavedRun()
        {
            yield return OpenAcceptedArcade();
            var controller = host.GetComponent<MoneyStartup>().Controller;
            var marker = environment.Services.RunMarkers.Load(environment.Owner); yield return Wait(marker);
            Assert.That(marker.GetAwaiter().GetResult(), Is.Not.Null);
            controller.enabled = false; yield return null;
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(host.GetComponentsInChildren<ZKube.Presentation.BoardController>(), Is.Empty);
            var retained = environment.Services.RunMarkers.Load(environment.Owner); yield return Wait(retained);
            Assert.That(retained.GetAwaiter().GetResult().ActiveRun, Is.EqualTo(marker.GetAwaiter().GetResult().ActiveRun));
            controller.enabled = true; yield return Idle();
            Assert.That(controller.PlayingRun, Is.False);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
