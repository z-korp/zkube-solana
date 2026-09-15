#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Integration.App.Evidence;
using ZKube.Integration.Client;
using ZKube.Integration.Presentation;
using ZKube.Presentation.Evidence;

namespace ZKube.Integration.App
{
    // Only the dedicated evidence scene owns this component. The inactive
    // serialized template never starts, including after a fixture error.
    public sealed partial class MoneyOverviewEvidenceHost : MonoBehaviour
    {
        [SerializeField] private MoneyStartup template;
        [SerializeField] private string scenario = "owner-overview";
        private MoneyStartup active;
        private MoneyEvidenceGraph graph;
        private MoneySessionEvidenceGraph sessionGraph;
        private Task loading = Task.CompletedTask, stopped;
        private bool changing, stopping, recording;
        private long generation;
        private string failure;
        public MoneyStartup Active => active;
        public MoneyEvidenceGraph Graph => graph;
        public MoneySessionEvidenceGraph SessionGraph => sessionGraph;
        private MoneyClientServices CurrentServices => playableGraph?.Services ?? sessionGraph?.Services ?? graph?.Services;
        private string CurrentSource => playableGraph?.SourceSha256 ?? sessionGraph?.SourceSha256 ?? graph?.SourceSha256;
        private string CurrentLabel => playableGraph?.Label ?? sessionGraph?.Label ?? graph?.Label;
        private Func<long> CurrentClock => playableGraph?.Clock ?? sessionGraph?.Clock ?? graph?.Clock;
        private long FixtureTime => CurrentClock?.Invoke() ?? -1;
        private int ForbiddenCount => playableGraph?.ForbiddenCalls ?? sessionGraph?.ForbiddenCalls ?? graph?.ForbiddenCalls ?? 0;
        private IReadOnlyList<MoneyEvidenceCall> CurrentCalls => playableGraph?.Calls ?? sessionGraph?.Calls ?? graph?.Calls ?? Array.Empty<MoneyEvidenceCall>();
        public string LastJourneyJson { get; private set; }
        public bool Ready => !changing && !stopping && failure == null && active != null &&
            active.Controller != null && active.Controller.PageReady && !active.Controller.Busy;

        public void Configure(MoneyStartup inactiveTemplate, string initialScenario = "owner-overview")
        {
            if (template != null || changing || active != null || stopping) throw new InvalidOperationException("Configure evidence before startup");
            ValidateScenario(initialScenario);
            template = inactiveTemplate; scenario = initialScenario;
        }
        private async void Start()
        {
            try { await Load(scenario); }
            catch (Exception error) { failure = "Offline evidence could not start (" + error.GetType().Name + "). Check the serialized evidence scene."; }
        }
        public Task Load(string selected)
        {
            ValidateScenario(selected);
            if (changing || recording || stopping) throw new InvalidOperationException("Evidence host is busy or stopped");
            changing = true; failure = null; generation++;
            return loading = Change(selected);
        }
        private async Task Change(string selected)
        {
            try
            {
                if (template == null || template.gameObject.activeSelf || template.gameObject == gameObject ||
                    template.SolanaSchema == null || template.SessionSchema == null ||
                    (template.Controller != null && !template.Controller.transform.IsChildOf(template.transform)))
                    throw new InvalidOperationException("Money evidence requires a separate inactive startup template with serialized schemas");
                await Retire(); graph = null; sessionGraph = null; playableGraph = null;
                if (MoneyPlayableEvidenceGraph.Supports(selected))
                    playableGraph = await MoneyPlayableEvidenceGraph.CreateScenario(selected, template.SolanaSchema.text, template.SessionSchema.text);
                else if (MoneySessionEvidenceGraph.Supports(selected))
                    sessionGraph = await MoneySessionEvidenceGraph.Create(selected, template.SolanaSchema.text, template.SessionSchema.text);
                else graph = await MoneyEvidenceGraph.Create(selected, template.SolanaSchema.text, template.SessionSchema.text);
                if (stopping || this == null) return;
                scenario = selected;
                active = Instantiate(template, transform);
                active.name = "Offline money overview · " + scenario;
                active.InitializeEvidence(CurrentServices, CurrentLabel, CurrentClock);
                active.gameObject.SetActive(true);
            }
            catch (Exception error)
            {
                failure = "Offline evidence could not start (" + error.GetType().Name + "). Check the serialized evidence scene.";
                await Retire();
            }
            finally { changing = false; }
        }
        private async Task Retire()
        {
            var previous = active; active = null;
            if (previous == null) return;
            try
            {
                await previous.StopAsync();
                // Retiring an offline scenario also retires its synthetic
                // identity, after draining all operations on that graph.
                if (CurrentServices?.Identity.Owner != null)
                    await CurrentServices.Identity.Disconnect();
            }
            finally { if (previous != null) Destroy(previous.gameObject); }
        }
        public Task StopAsync()
        {
            if (stopped != null) return stopped;
            stopping = true; generation++;
            return stopped = Stop();
        }
        private async Task Stop()
        { await loading; await Retire(); }
        private async void OnDestroy()
        { try { await StopAsync(); } catch (Exception error) { Debug.LogException(error); } }
        private void OnGUI()
        {
            if (failure == null || stopping) return;
            var style = new GUIStyle(GUI.skin.box) { wordWrap = true, fontSize = 22 };
            GUI.Box(new Rect(20, 20, Mathf.Max(1, Screen.width - 40), 160), "OFFLINE EVIDENCE\n" + failure, style);
        }
        public static void ValidateScenario(string value)
        {
            if (value != "campaign-playable" && value != "public-disconnected" && value != "owner-overview" && value != "pending-confirmed-failure" && !MoneySessionEvidenceGraph.Supports(value) && !MoneyPlayableEvidenceGraph.Supports(value))
                throw new ArgumentException("Unknown money evidence scenario", nameof(value));
        }
        public void AdvancePendingFailure()
        {
            RequireReady();
            if (sessionGraph != null)
            {
                RequireSessionPending(); sessionGraph.ConfirmPendingFailure(); return;
            }
            if (scenario != "pending-confirmed-failure" || graph.Services.Identity.Owner == null ||
                active.Controller.LastReceipt?.Outcome != ZKube.Integration.Execution.ExecutionOutcome.Pending)
                throw new InvalidOperationException("Observe the connected pending receipt before advancing its fixture status");
            graph.ConfirmPendingFailure();
        }
        public void AdvancePendingSuccess()
        {
            RequireReady(); RequireSessionPending(); sessionGraph.ConfirmPendingSuccess();
        }
        private void RequireSessionPending()
        {
            if (sessionGraph == null || sessionGraph.Services.Identity.Owner == null ||
                active.Controller.LastReceipt?.Outcome != ZKube.Integration.Execution.ExecutionOutcome.Pending ||
                active.Controller.LastReceipt.Signature != sessionGraph.SentSignature)
                throw new InvalidOperationException("Observe the exact synthetic transaction receipt before advancing its fixture status");
        }
        [Serializable] private sealed class Call { public string boundary, operation; }
        [Serializable] private sealed class Readiness
        {
            public string evidenceClass = "offline injected HTTP/native graph; real validated account and signed fixture bytes; no network or new signing";
            public string scenario, sourceSha256, fixtureClass, label, status, error, owner, outcome, code, signature;
            public string observedUtc, deviceModel, graphicsDeviceName, graphicsDeviceType;
            public long fixtureUnixTime;
            public float densityDpi;
            public Rect safeArea;
            public bool ready, busy, changing, stopped, browsingCampaign, browsingSession, browsingDaily, browsingKredits, browsingRewards, browsingProfile, confirmingDailyEntry, activeSyntheticKey, candidateSyntheticKey;
            public uint rewardDay;
            public byte selectedRealm, selectedTrial;
            public byte selectedEmblem, selectedBorder;
            public int width, height, frame, forbiddenCalls;
            public Call[] calls;
            public bool playingRun, boardBusy, boardReady, consumed;
            public uint score, dailyScore, actions;
            public ulong objectiveTotal;
            public string runMode;
            public byte phase, starSources;
            public string nextFixtureCommand;
        }
        public string ReadinessJson()
        {
            var receipt = active == null ? null : active.Controller?.LastReceipt;
            var board = VisibleBoard;
            return JsonUtility.ToJson(new Readiness {
                scenario = scenario, sourceSha256 = CurrentSource, fixtureClass = sessionGraph?.FixtureClass, label = CurrentLabel,
                evidenceClass = playableGraph != null ? "offline finite native " + playableGraph.Mode + " ledger; actual planner/executor/dispatcher and input; no network or real wallet" : sessionGraph == null ? "offline injected read-only graph; no network or new signing" : "offline synthetic signer and finite transaction ledger; actual planner/executor/dispatcher; no network or real wallet",
                observedUtc = DateTime.UtcNow.ToString("O"), fixtureUnixTime = FixtureTime,
                densityDpi = Screen.dpi, safeArea = Screen.safeArea, deviceModel = SystemInfo.deviceModel,
                graphicsDeviceName = SystemInfo.graphicsDeviceName, graphicsDeviceType = SystemInfo.graphicsDeviceType.ToString(),
                status = active == null ? null : active.Controller?.Status, error = failure,
                owner = CurrentServices?.Identity.Owner, ready = Ready, busy = active != null && active.Controller != null && active.Controller.Busy,
                changing = changing, stopped = stopping, width = Screen.width, height = Screen.height, frame = Time.frameCount,
                browsingCampaign = active != null && active.Controller != null && active.Controller.BrowsingCampaign,
                selectedRealm = active?.Controller?.SelectedRealm ?? 0, selectedTrial = active?.Controller?.SelectedTrial ?? 0,
                browsingSession = active != null && active.Controller != null && active.Controller.BrowsingSession,
                browsingDaily = active != null && active.Controller != null && active.Controller.BrowsingDaily,
                browsingKredits = active != null && active.Controller != null && active.Controller.BrowsingKredits,
                browsingRewards = active != null && active.Controller != null && active.Controller.BrowsingRewards,
                browsingProfile = active != null && active.Controller != null && active.Controller.BrowsingProfile,
                selectedEmblem = active?.Controller?.SelectedEmblem ?? 0, selectedBorder = active?.Controller?.SelectedBorder ?? 0,
                rewardDay = active?.Controller?.RewardDay ?? 0,
                confirmingDailyEntry = active != null && active.Controller != null && active.Controller.ConfirmingDailyEntry,
                activeSyntheticKey = sessionGraph?.HasActiveKey ?? false, candidateSyntheticKey = sessionGraph?.HasCandidateKey ?? false,
                forbiddenCalls = ForbiddenCount, outcome = receipt?.Outcome.ToString(), code = receipt?.Code, signature = receipt?.Signature,
                calls = CurrentCalls.Select(call => new Call { boundary = call.Boundary, operation = call.Operation }).ToArray(),
                playingRun = active != null && active.Controller != null && active.Controller.PlayingRun,
                boardBusy = board != null && board.Busy, boardReady = board != null && board.Ready,
                score = board?.State?.Score ?? 0, actions = board?.State?.ActionCounter ?? 0,
                dailyScore = board?.State?.DailyScore ?? 0, objectiveTotal = board?.State?.ObjectiveTotal ?? 0, runMode = playableGraph?.Mode,
                phase = board?.State?.Phase ?? 0, starSources = board?.State?.LatchedStarSources ?? 0,
                consumed = playableGraph?.Consumed ?? false, nextFixtureCommand = playableGraph?.NextCommand
            }, true);
        }
        private void RequireReady()
        { if (!Ready) throw new InvalidOperationException("Money evidence is not ready: " + (failure ?? "wait for startup, read and artwork")); }
        public IEnumerator WaitReady()
        {
            float until = Time.realtimeSinceStartup + 15;
            while (!Ready && failure == null && !stopping && Time.realtimeSinceStartup < until) yield return null;
            RequireReady();
            if (ForbiddenCount != 0) throw new InvalidOperationException("Evidence attempted a forbidden operation");
        }
        [Serializable] private sealed class Input
        {
            public string control, hit;
            public Vector2 screen;
            public int frame;
        }
        private readonly List<Input> inputs = new List<Input>();
        public IEnumerator Click(string control)
        {
            RequireReady(); long epoch = generation;
            if (VisibleBoard != null)
            {
                yield return ClickRunControl(control); yield break;
            }
            if (!new[] { "Connect", "Disconnect", "Refresh", "Check transaction", "Campaign", "Overview",
                "Refresh Campaign", "Previous realm", "Next realm", "Back to map",
                "This device", "Enable device", "Renew device", "Refill allowance", "Disable this device", "Refresh session",
                "Start trial", "Resume Campaign", "Set up this device",
                "Daily", "Refresh Daily", "Resume Daily", "Enter · 1 Kredit", "Confirm 1 Kredit", "Cancel entry",
                "Kredits", "Refresh Kredits", "Receipt details",
                "Profile", "Refresh profile", "Wear selection",
                "Results", "Refresh results", "Previous day", "Next day", "Collect Score", "Collect Theme",
                "Previous Score rows", "More Score rows", "Previous Theme rows", "More Theme rows",
                "Trial 1", "Trial 2", "Trial 3", "Trial 4", "Trial 5", "Trial 6", "Trial 7", "Trial 8", "Trial 9", "Trial 10" }.Contains(control) &&
                !SessionViewPolicy.KreditPacks.Select(MoneyAppController.KreditPurchaseLabel).Contains(control) &&
                !ProfileIdentityCatalog.Emblems.Any(value => control == "Emblem " + value.Id) &&
                !ProfileIdentityCatalog.Tiers.Any(value => control == "Border " + value.Id))
                throw new ArgumentException("Unknown overview control");
            if (EventSystem.current == null) throw new InvalidOperationException("Money evidence needs the scene's EventSystem");
            var button = active.GetComponentsInChildren<Button>().Single(value => value.name == control);
            if (!button.interactable) throw new InvalidOperationException("Overview control is disabled");
            var scroll = active.GetComponentInChildren<ScrollRect>();
            Canvas.ForceUpdateCanvases();
            var bounds = RectTransformUtility.CalculateRelativeRectTransformBounds(scroll.viewport, button.transform);
            float range = scroll.content.rect.height - scroll.viewport.rect.height;
            if (range > 0) scroll.verticalNormalizedPosition = 1 - Mathf.Clamp01((scroll.content.anchoredPosition.y + scroll.viewport.rect.center.y - bounds.center.y) / range);
            // Positioning the viewport is harness setup, not an OS scroll claim.
            yield return null; Canvas.ForceUpdateCanvases(); RequireReady();
            if (epoch != generation) throw new InvalidOperationException("Evidence changed before the input frame");
            EvidencePointer.Click(button, (kind, point, hit) => {
                if (kind == "tap-after") inputs.Add(new Input { control = control, hit = hit.name, screen = point, frame = Time.frameCount });
            });
            if (playableGraph != null) yield return PumpPlayable();
            yield return WaitReady();
        }
        public IEnumerator Capture(string output)
        {
            RequireReady(); long epoch = generation; var size = new Vector2Int(Screen.width, Screen.height);
            if (Application.isEditor && Application.isBatchMode) throw new InvalidOperationException("Capture requires a focused graphics Game view");
            if (File.Exists(output) || File.Exists(Path.ChangeExtension(output, ".json"))) throw new IOException("Use a fresh capture path");
            yield return new WaitForEndOfFrame(); RequireReady();
            if (epoch != generation || size != new Vector2Int(Screen.width, Screen.height)) throw new InvalidOperationException("Evidence changed before the capture frame");
            var texture = ScreenCapture.CaptureScreenshotAsTexture();
            try
            {
                if (texture == null || texture.width != Screen.width || texture.height != Screen.height) throw new InvalidOperationException("Screenshot dimensions differ from the rendered viewport");
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output)));
                File.WriteAllBytes(output, texture.EncodeToPNG()); File.WriteAllText(Path.ChangeExtension(output, ".json"), ReadinessJson());
            }
            finally { if (texture != null) Destroy(texture); }
        }
        [Serializable] private sealed class Journey
        {
            public string evidenceClass = "actual raycast and EventSystem button inputs with rendered milestone frames; offline fixtures, not OS touch or performance evidence";
            public string scenario, sourceSha256, setup;
            public uint fixtureDay;
            public string[] frames;
            public Input[] inputs;
        }
        public IEnumerator RecordJourney(string directory)
        {
            RequireReady();
            if (playableGraph?.Mode == "daily")
                throw new InvalidOperationException("Capture the Daily with individual click/input commands and milestone frames; its full trajectory exceeds one command deadline");
            if (recording || CurrentServices.Identity.Owner != null) throw new InvalidOperationException("Reload a disconnected scenario before recording");
            if (Directory.Exists(directory) || File.Exists(directory)) throw new IOException("Use a fresh journey directory");
            Directory.CreateDirectory(directory); recording = true; inputs.Clear(); LastJourneyJson = null;
            var frames = new List<string>();
            try
            {
                string path = Path.Combine(directory, "00-disconnected.png"); yield return Capture(path); frames.Add(path);
                if (scenario == "public-disconnected") yield return Click("Refresh");
                else
                {
                    yield return Click("Connect");
                    path = Path.Combine(directory, "01-connected.png"); yield return Capture(path); frames.Add(path);
                    if (scenario == "campaign-playable") yield return PlayableJourney(directory, frames);
                    else if (sessionGraph?.Operation == "claim")
                    {
                        yield return Click("Results");
                        // Explicit fixture setup, recorded separately from real input.
                        // The claim itself still uses the raycast/EventSystem button.
                        var selection = active.Controller.OpenRewards(sessionGraph.ClaimDay);
                        float until = Time.realtimeSinceStartup + 15;
                        while (!selection.IsCompleted && Time.realtimeSinceStartup < until) yield return null;
                        if (!selection.IsCompleted) throw new TimeoutException("Reward fixture day selection did not complete");
                        selection.GetAwaiter().GetResult(); yield return WaitReady();
                        path = Path.Combine(directory, "02-rewards-before.png"); yield return Capture(path); frames.Add(path);
                        string control = sessionGraph.ClaimKind == "score" ? "Collect Score" : "Collect Theme";
                        var collect = active.GetComponentsInChildren<Button>().SingleOrDefault(button => button.name == control);
                        if (collect != null && collect.interactable) yield return Click(control);
                        path = Path.Combine(directory, "03-rewards-operation.png"); yield return Capture(path); frames.Add(path);
                        if (active.Controller.LastReceipt?.Outcome == ZKube.Integration.Execution.ExecutionOutcome.Pending)
                        {
                            if (scenario.EndsWith("-pending-failure", StringComparison.Ordinal)) AdvancePendingFailure(); else AdvancePendingSuccess();
                            yield return Click("Check transaction");
                            path = Path.Combine(directory, "04-rewards-reconciled.png"); yield return Capture(path); frames.Add(path);
                        }
                    }
                    else if (sessionGraph?.Operation == "featured")
                    {
                        yield return Click("Profile");
                        path = Path.Combine(directory, "02-profile-before.png"); yield return Capture(path); frames.Add(path);
                        foreach (string control in new[] { "Emblem " + sessionGraph.ProfileEmblem, "Border " + sessionGraph.ProfileBorder })
                            if (active.GetComponentsInChildren<Button>().Single(button => button.name == control).interactable)
                                yield return Click(control);
                        path = Path.Combine(directory, "03-profile-selection.png"); yield return Capture(path); frames.Add(path);
                        if (active.GetComponentsInChildren<Button>().Single(button => button.name == "Wear selection").interactable)
                            yield return Click("Wear selection");
                        path = Path.Combine(directory, "04-profile-operation.png"); yield return Capture(path); frames.Add(path);
                        if (active.Controller.LastReceipt?.Outcome == ZKube.Integration.Execution.ExecutionOutcome.Pending)
                        {
                            if (scenario.EndsWith("-failure", StringComparison.Ordinal)) AdvancePendingFailure(); else AdvancePendingSuccess();
                            yield return Click("Check transaction");
                            path = Path.Combine(directory, "05-profile-reconciled.png"); yield return Capture(path); frames.Add(path);
                        }
                    }
                    else if (sessionGraph?.Operation == "purchase")
                    {
                        yield return Click("Kredits");
                        path = Path.Combine(directory, "02-kredits-before.png"); yield return Capture(path); frames.Add(path);
                        yield return Click(MoneyAppController.KreditPurchaseLabel(sessionGraph.KreditPack));
                        path = Path.Combine(directory, "03-kredits-operation.png"); yield return Capture(path); frames.Add(path);
                        if (scenario == "kredit-pending-success" || scenario == "kredit-pending-failure")
                        {
                            if (scenario == "kredit-pending-failure") AdvancePendingFailure(); else AdvancePendingSuccess();
                            yield return Click("Check transaction");
                            path = Path.Combine(directory, "04-kredits-reconciled.png"); yield return Capture(path); frames.Add(path);
                        }
                    }
                    else if (sessionGraph != null)
                    {
                        yield return Click("This device");
                        path = Path.Combine(directory, "02-session-before.png"); yield return Capture(path); frames.Add(path);
                        string control = scenario == "session-current" ? "Refresh session" :
                            scenario == "session-refill-success" ? "Refill allowance" :
                            scenario.StartsWith("session-disable-", StringComparison.Ordinal) ? "Disable this device" :
                            scenario == "session-renew-expired" ? "Renew device" : "Enable device";
                        yield return Click(control);
                        path = Path.Combine(directory, "03-session-operation.png"); yield return Capture(path); frames.Add(path);
                        if (scenario == "session-enable-pending-failure" || scenario == "session-disable-pending-success")
                        {
                            if (scenario == "session-enable-pending-failure") AdvancePendingFailure(); else AdvancePendingSuccess();
                            yield return Click("Check transaction");
                            path = Path.Combine(directory, "04-session-reconciled.png"); yield return Capture(path); frames.Add(path);
                        }
                    }
                    else if (scenario == "pending-confirmed-failure")
                    { AdvancePendingFailure(); yield return Click("Check transaction"); }
                    else yield return Click("Refresh");
                }
                path = Path.Combine(directory, playableGraph != null ? "31-observed.png" : sessionGraph == null ? "02-observed.png" : "05-observed.png"); yield return Capture(path); frames.Add(path);
                LastJourneyJson = JsonUtility.ToJson(new Journey { scenario = scenario, sourceSha256 = CurrentSource,
                    fixtureDay = sessionGraph?.Operation == "claim" ? sessionGraph.ClaimDay : 0,
                    setup = sessionGraph?.Operation == "claim" ? "OpenRewards selected the fixture Daily; day selection is setup, not recorded pointer input." : null,
                    frames = frames.ToArray(), inputs = inputs.ToArray() }, true);
                File.WriteAllText(Path.Combine(directory, "journey.json"), LastJourneyJson);
            }
            finally { recording = false; }
        }
    }
}
#endif
