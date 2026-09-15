using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using ZKube.Integration.App;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Execution;

namespace ZKube.Tests
{
    public sealed class MoneyOverviewHostTests
    {
        private GameObject root, templateObject, input;
        private TextAsset solana, session;
        private MoneyOverviewEvidenceHost host;
        private MoneyEvidenceDelay hold;
        [Serializable] private sealed class Observation
        {
            public string fixtureClass, sourceSha256, scenario;
            public bool browsingRewards;
            public uint rewardDay;
            public string observedUtc, deviceModel, graphicsDeviceName, graphicsDeviceType;
            public long fixtureUnixTime;
            public float densityDpi;
            public Rect safeArea;
        }
        [UnityTearDown] public IEnumerator Cleanup()
        {
            hold?.Release();
            if (host != null) yield return Wait(host.StopAsync());
            if (root != null) UnityEngine.Object.Destroy(root);
            if (templateObject != null) UnityEngine.Object.Destroy(templateObject);
            if (input != null) UnityEngine.Object.Destroy(input);
            if (solana != null) UnityEngine.Object.Destroy(solana);
            if (session != null) UnityEngine.Object.Destroy(session);
            yield return null;
        }
        private void Create(string scenario)
        {
            if (EventSystem.current == null) input = new GameObject("Host test input", typeof(EventSystem), typeof(StandaloneInputModule));
            templateObject = new GameObject("Inactive money template"); templateObject.SetActive(false);
            var startup = templateObject.AddComponent<MoneyStartup>();
            solana = new TextAsset(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/solana.json")));
            session = new TextAsset(File.ReadAllText(Path.Combine(Application.dataPath, "ZKube/Integration/Generated/session.json")));
            startup.Configure(solana, session, Resources.Load<TMP_FontAsset>("ZKube/Fonts/LilitaOne-Regular"), Resources.Load<TMP_FontAsset>("ZKube/Fonts/Outfit-Regular"));
            root = new GameObject("Money evidence host"); root.SetActive(false);
            host = root.AddComponent<MoneyOverviewEvidenceHost>(); host.Configure(startup, scenario); root.SetActive(true);
        }
        [UnityTest] public IEnumerator RaycastedOwnerInputsAndScenarioReplacementKeepTemplateInactive()
        {
            Create("owner-overview"); yield return null; yield return host.WaitReady();
            Assert.That(templateObject.activeSelf, Is.False);
            Assert.That(host.Graph.Services.Identity.Owner, Is.Null);
            yield return host.Click("Connect");
            Assert.That(host.Graph.Services.Identity.Owner, Is.EqualTo(host.Graph.Owner));
            var previous = host.Active;
            yield return Wait(host.Load("public-disconnected")); yield return host.WaitReady();
            yield return null;
            Assert.That(previous == null, Is.True);
            Assert.That(host.Graph.Services.Identity.Owner, Is.Null);
            Assert.That(host.Graph.ForbiddenCalls, Is.Zero);
            StringAssert.Contains(host.Graph.SourceSha256, host.ReadinessJson());
            var observation = JsonUtility.FromJson<Observation>(host.ReadinessJson());
            Assert.That(DateTimeOffset.TryParse(observation.observedUtc, out var observed), Is.True);
            Assert.That(Math.Abs((DateTimeOffset.UtcNow - observed).TotalSeconds), Is.LessThan(5));
            Assert.That(observation.fixtureUnixTime, Is.EqualTo(host.Graph.Clock()));
            Assert.That(observation.densityDpi, Is.EqualTo(Screen.dpi));
            Assert.That(observation.safeArea, Is.EqualTo(Screen.safeArea));
            Assert.That(observation.deviceModel, Is.EqualTo(SystemInfo.deviceModel));
            Assert.That(observation.graphicsDeviceName, Is.EqualTo(SystemInfo.graphicsDeviceName));
            Assert.That(observation.graphicsDeviceType, Is.EqualTo(SystemInfo.graphicsDeviceType.ToString()));
            Assert.That(templateObject.activeSelf, Is.False);
        }
        [UnityTest] public IEnumerator PendingStatusAdvanceRequiresObservedReceiptAndActualCheckInput()
        {
            Create("pending-confirmed-failure"); yield return null; yield return host.WaitReady();
            Assert.Throws<InvalidOperationException>(() => host.AdvancePendingFailure());
            yield return host.Click("Connect");
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending));
            host.AdvancePendingFailure();
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.Pending), "Fixture status alone must not change the UI receipt");
            yield return host.Click("Check transaction");
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
            yield return host.Click("Refresh");
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedFailure));
            Assert.That(host.Graph.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator StopDrainsHeldReadBeforeDestroyingClone()
        {
            Create("owner-overview"); yield return null; yield return host.WaitReady();
            hold = host.Graph.HoldNextRead("getMultipleAccounts");
            var read = host.Active.Controller.RefreshOverview(); yield return Wait(hold.Entered);
            var stop = host.StopAsync(); Assert.That(stop.IsCompleted, Is.False);
            Assert.That(host.Ready, Is.False);
            hold.Release(); yield return Wait(stop); yield return Wait(read);
            Assert.That(host.Active, Is.Null);
            Assert.That(templateObject.activeSelf, Is.False);
        }
        [UnityTest] public IEnumerator CampaignBrowseInputsUseActualRaycastsWithoutStartingOrResumingRuns()
        {
            Create("owner-overview"); yield return null; yield return host.WaitReady();
            yield return host.Click("Connect"); yield return host.Click("Check transaction");
            var receipt = host.Active.Controller.LastReceipt;
            yield return host.Click("Campaign");
            Assert.That(host.Active.Controller.BrowsingCampaign, Is.True);
            yield return host.Click("Trial 1");
            Assert.That(host.Active.Controller.SelectedTrial, Is.EqualTo(1));
            yield return host.Click("Back to map"); yield return host.Click("Next realm");
            Assert.That(host.Active.Controller.SelectedRealm, Is.EqualTo(2));
            yield return host.Click("Previous realm"); yield return host.Click("Refresh Campaign");
            StringAssert.Contains("\"browsingCampaign\": true", host.ReadinessJson());
            yield return host.Click("Overview");
            Assert.That(host.Active.Controller.LastReceipt, Is.SameAs(receipt));
            Assert.That(host.Graph.ForbiddenCalls, Is.Zero);
            Assert.Throws<ArgumentException>(() => host.Click("Trial 11").MoveNext());
        }
        [UnityTest] public IEnumerator SyntheticSessionEnableUsesActualInputAndReloadRestoresReadonlyBoundaries()
        {
            Create("session-enable-success"); yield return null; yield return host.WaitReady();
            Assert.That(host.Graph, Is.Null); Assert.That(host.SessionGraph.Services.Identity.Owner, Is.Null);
            yield return host.Click("Connect"); yield return host.Click("This device"); yield return host.Click("Enable device");
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(host.SessionGraph.HasActiveKey, Is.True); Assert.That(host.SessionGraph.HasCandidateKey, Is.False);
            Assert.That(host.SessionGraph.ForbiddenCalls, Is.Zero);
            AssertSyntheticFamily("offline-synthetic-money-session");
            var previous = host.SessionGraph;
            yield return Wait(host.Load("public-disconnected")); yield return host.WaitReady();
            Assert.That(previous.Services.Identity.Owner, Is.Null);
            Assert.That(host.SessionGraph, Is.Null); Assert.That(host.Graph.Services.Identity.Owner, Is.Null);
            Assert.That(host.Graph.ForbiddenCalls, Is.Zero); Assert.That(templateObject.activeSelf, Is.False);
        }
        private void AssertSyntheticFamily(string expected)
        {
            var observation = JsonUtility.FromJson<Observation>(host.ReadinessJson());
            Assert.That(observation.fixtureClass, Is.EqualTo(expected));
            Assert.That(observation.fixtureClass, Is.EqualTo(host.SessionGraph.FixtureClass));
            Assert.That(observation.sourceSha256, Is.EqualTo(host.SessionGraph.SourceSha256));
            Assert.That(observation.scenario, Is.EqualTo(host.SessionGraph.Scenario));
        }
        [UnityTest] public IEnumerator SyntheticPurchaseReportsItsFixtureFamilyBeforeAnySigning()
        {
            Create("kredit-buy-1"); yield return null; yield return host.WaitReady();
            AssertSyntheticFamily("offline-synthetic-money-economy");
            Assert.That(host.SessionGraph.SentSignature, Is.Null);
            Assert.That(host.SessionGraph.Services.Identity.Owner, Is.Null);
            yield return Wait(host.Load("public-disconnected")); yield return host.WaitReady();
            Assert.That(JsonUtility.FromJson<Observation>(host.ReadinessJson()).fixtureClass, Is.Null.Or.Empty);
        }
        [UnityTest] public IEnumerator SyntheticClaimUsesTheSelectedDailyAndActualCollectionInput()
        {
            Create("claim-score-sealed"); yield return null; yield return host.WaitReady();
            AssertSyntheticFamily("offline-synthetic-money-claims");
            yield return host.Click("Connect");
            yield return Wait(host.Active.Controller.OpenRewards(host.SessionGraph.ClaimDay)); yield return host.WaitReady();
            var before = JsonUtility.FromJson<Observation>(host.ReadinessJson());
            Assert.That(before.browsingRewards, Is.True); Assert.That(before.rewardDay, Is.EqualTo(host.SessionGraph.ClaimDay));
            yield return host.Click("Collect Score");
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(host.Active.Controller.LastReceipt.Signature, Is.EqualTo(host.SessionGraph.SentSignature));
            Assert.That(host.SessionGraph.Calls.Count(call => call.Operation == "signTransactions"), Is.Zero);
            Assert.That(host.SessionGraph.Calls.Count(call => call.Operation == "sendTransaction"), Is.EqualTo(1));
            Assert.That(host.SessionGraph.ForbiddenCalls, Is.Zero);
            AssertSyntheticFamily("offline-synthetic-money-claims");
        }
        [UnityTest] public IEnumerator SyntheticPendingDisableRequiresExactReceiptAndCheckBeforeDeletingTheKey()
        {
            Create("session-disable-pending-success"); yield return null; yield return host.WaitReady();
            Assert.Throws<InvalidOperationException>(() => host.AdvancePendingSuccess());
            yield return host.Click("Connect"); yield return host.Click("This device"); yield return host.Click("Disable this device");
            var pending = host.Active.Controller.LastReceipt;
            Assert.That(pending.Outcome, Is.EqualTo(ExecutionOutcome.Pending)); Assert.That(host.SessionGraph.HasActiveKey, Is.True);
            Assert.Throws<InvalidOperationException>(() => host.AdvancePendingFailure());
            host.AdvancePendingSuccess(); Assert.That(host.SessionGraph.HasActiveKey, Is.True);
            yield return host.Click("Check transaction");
            Assert.That(host.Active.Controller.LastReceipt.Outcome, Is.EqualTo(ExecutionOutcome.ConfirmedSuccess));
            Assert.That(host.Active.Controller.LastReceipt.Signature, Is.EqualTo(pending.Signature));
            Assert.That(host.SessionGraph.HasActiveKey, Is.False); Assert.That(host.SessionGraph.ForbiddenCalls, Is.Zero);
        }
        [UnityTest] public IEnumerator InvalidSceneDoesNotActivateProductionStartup()
        {
            root = new GameObject("Invalid money evidence host"); host = root.AddComponent<MoneyOverviewEvidenceHost>();
            yield return null; yield return null;
            Assert.That(host.Ready, Is.False); Assert.That(host.Graph, Is.Null); Assert.That(host.Active, Is.Null);
            StringAssert.Contains("Offline evidence could not start", host.ReadinessJson());
        }
        private static IEnumerator Wait(Task task)
        {
            float until = Time.realtimeSinceStartup + 15;
            while (!task.IsCompleted && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(task.IsCompleted, Is.True, "Offline host operation did not finish");
            if (task.IsFaulted) Assert.Fail(task.Exception.ToString());
            Assert.That(task.IsCanceled, Is.False);
        }
    }
}
