#if UNITY_EDITOR || ZKUBE_EVIDENCE
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;
using UnityEngine.EventSystems;

namespace ZKube.Presentation.Evidence
{
    public sealed partial class BoardEvidenceHarness
    {
        [Serializable] private sealed class JourneyInput
        {
            public string phase, hit;
            public int unityFrame;
            public float elapsedSeconds;
            public Vector2 screen;
            public uint fixtureOperation;
            public bool busy, previewRendererPresent;
            public uint acceptedActionCounter;
            public Vector2 previewPosition;
            public string status;
        }
        [Serializable] private sealed class JourneyFrame
        {
            public string png;
            public int index, unityFrame;
            public float elapsedSeconds, unscaledDeltaMilliseconds;
            public Readiness snapshot;
            public JourneyInput[] inputs;
        }
        [Serializable] private sealed class JourneyReport
        {
            public string evidenceClass = "actual end-of-frame screenshot sequence; offline native fixture";
            public string inputMethod = "screen-coordinate GraphicRaycaster hit testing and EventSystem dispatch; not OS/device touch";
            public string timing = "Variable-rate actual frames. PNG encoding, disk IO, synthetic provider delays and Editor overhead affect cadence; not a device performance benchmark. No interpolated or repeated frames.";
            public string startedUtc, endedUtc, outcome, error;
            public string scenario = "fixture-inputs";
            public FaultObservation fault;
            public int requestedInputs, completedInputs, maxFrames;
            public float maxSeconds, elapsedSeconds, textScale;
            public bool initialReady, finalReady, muted, reducedMotion, haptics, requiresFixtureReload;
            public JourneyFrame[] frames;
            public JourneyInput[] inputsAfterLastFrame;
        }
        public bool RecordingJourney { get; private set; }
        public string LastJourneyJson { get; private set; }
        private float journeyStarted;
        private bool journeyRequiresReload;
        private readonly List<JourneyInput> recordedInputs = new List<JourneyInput>();
        private void RecordInput(string phase, Vector2 screen, GameObject hit, uint operation = 0)
        {
            if (!RecordingJourney) return;
            // Observe the actual view renderer after dispatch; do not infer
            // selection from intended pointer coordinates or native state.
            var preview = Board.View.GetComponentsInChildren<SpriteRenderer>().FirstOrDefault(r => r.name == "Unaccepted drag preview" && r.enabled);
            recordedInputs.Add(new JourneyInput { phase = phase, screen = screen, hit = hit == null ? null : hit.name,
                unityFrame = Time.frameCount, elapsedSeconds = Time.realtimeSinceStartup - journeyStarted, fixtureOperation = operation,
                busy = Board.Busy, acceptedActionCounter = Board.State.ActionCounter, status = Board.View.StatusText,
                previewRendererPresent = preview != null, previewPosition = preview == null ? Vector2.zero : (Vector2)preview.transform.position });
        }

        // Run through StartCoroutine from the Editor command bridge. A new
        // directory is mandatory, so a shorter recording cannot inherit frames.
        public IEnumerator RecordInputJourney(string directory, int inputCount = 1, int maxFrames = 300, float maxSeconds = 15)
            => RecordJourney(directory, inputCount, maxFrames, maxSeconds, null, null);

        private IEnumerator RecordJourney(string directory, int inputCount, int maxFrames, float maxSeconds,
            IEnumerator scenarioDriver, FaultObservation fault)
        {
            if (RecordingJourney) throw new InvalidOperationException("A journey is already recording");
            if (journeyRequiresReload) throw new InvalidOperationException("Reload a fixture after an incomplete journey before recording again");
            if (inputCount < 1 || inputCount > 20 || maxFrames < 2 || maxFrames > 600 || maxSeconds <= 0 || maxSeconds > 30)
                throw new ArgumentOutOfRangeException("Journey bounds: 1–20 inputs, 2–600 frames, and at most 30 seconds");
            if (Board == null || Current == null || !Board.Ready || Board.Busy)
                throw new InvalidOperationException("Begin a journey only after the fixture has rendered ready");
            if (Application.isEditor && Application.isBatchMode)
                throw new InvalidOperationException("Journey capture needs a focused Game view or graphics player");
            string destination = Path.GetFullPath(directory);
            if (Directory.Exists(destination) || File.Exists(destination))
                throw new IOException("Journey output must be a new directory: " + destination);
            Directory.CreateDirectory(destination);
            var session = Board.Session;
            var fixture = Current;
            var viewport = new Vector2Int(Screen.width, Screen.height);
            var safe = Screen.safeArea;
            var report = new JourneyReport { startedUtc = DateTime.UtcNow.ToString("O"), requestedInputs = inputCount,
                maxFrames = maxFrames, maxSeconds = maxSeconds, textScale = Board.TextScale, initialReady = true, muted = Board.Muted, reducedMotion = Board.ReducedMotion, haptics = Board.Haptics };
            report.fault = fault;
            if (fault != null) report.scenario = fault.scenario;
            var frames = new List<JourneyFrame>();
            var driver = new Stack<IEnumerator>();
            bool capturing = false;
            string captureError = null;
            Coroutine capture = null;
            RecordingJourney = true; LastJourneyJson = null; recordedInputs.Clear(); journeyStarted = Time.realtimeSinceStartup;
            try
            {
                while (true)
                {
                    if (Time.realtimeSinceStartup - journeyStarted >= maxSeconds) { report.outcome = "duration-limit"; break; }
                    if (!ReferenceEquals(session, Board.Session) || !ReferenceEquals(fixture, Current) ||
                        viewport.x != Screen.width || viewport.y != Screen.height || safe != Screen.safeArea ||
                        report.muted != Board.Muted || report.reducedMotion != Board.ReducedMotion || report.haptics != Board.Haptics || report.textScale != Board.TextScale)
                    { report.outcome = "error"; report.error = "Session, fixture, viewport, safe area or settings changed during recording"; break; }
                    if (capturing) { yield return null; continue; }
                    if (captureError != null) { report.outcome = "error"; report.error = captureError; break; }
                    if (frames.Count > 0 && report.completedInputs == inputCount && Board.Ready && !Board.Busy && frames[frames.Count - 1].snapshot.ready)
                    { report.outcome = "completed"; break; }
                    if (frames.Count >= maxFrames) { report.outcome = "frame-limit"; break; }
                    // The first frame is the rendered, ready opening before any
                    // dispatch. Following frames include pending and animation.
                    if (frames.Count > 0)
                    {
                        try
                        {
                            if (driver.Count == 0 && report.completedInputs < inputCount && Board.Ready && !Board.Busy)
                            {
                                if (scenarioDriver != null) driver.Push(scenarioDriver);
                                else
                                {
                                    int next = journeyCursor;
                                    while (next < Current.steps.Length && Current.steps[next].operation == ZKube.Core.Generated.ApplyVrfRequest.Operation) next++;
                                    if (next == Current.steps.Length) throw new InvalidOperationException("Fixture has fewer remaining input steps than requested");
                                    driver.Push(PlayNextInput());
                                }
                            }
                            if (driver.Count > 0 && !AdvanceInput(driver)) report.completedInputs++;
                        }
                        catch (Exception error) { report.outcome = "error"; report.error = error.ToString(); break; }
                    }
                    capturing = true;
                    capture = StartCoroutine(CaptureJourneyFrame(destination, frames, error => { captureError = error; capturing = false; }));
                    yield return null;
                }
            }
            finally
            {
                if (capture != null) StopCoroutine(capture);
                report.outcome = report.outcome ?? "interrupted";
                if (report.outcome != "completed")
                {
                    // Drop a queued intention before cancelling a still-held
                    // fault gate. Released accepted work keeps completing.
                    if (fault != null && Board != null) Board.Pause();
                    // Cancel selection only: pointer-up could submit a move,
                    // and provider cancellation could discard accepted work.
                    journeyRequiresReload = true; report.requiresFixtureReload = true;
                    if (Board != null && Board.View != null && Board.View.Pointer != null)
                    {
                        ExecuteEvents.Execute(Board.View.Pointer.gameObject, new BaseEventData(EventSystem.current), ExecuteEvents.cancelHandler);
                        recordedInputs.Add(new JourneyInput { phase = "recording-cancel-selection", unityFrame = Time.frameCount,
                            elapsedSeconds = Time.realtimeSinceStartup - journeyStarted, busy = Board.Busy,
                            acceptedActionCounter = Board.State == null ? 0 : Board.State.ActionCounter });
                    }
                }
                while (driver.Count > 0) (driver.Pop() as IDisposable)?.Dispose();
                if (fault != null)
                {
                    // A still-held submission was never accepted. Cancel only
                    // that gate; an already released native action continues.
                    fault.provider.CancelIfHeld();
                    fault.pausedAfterInterruption = report.outcome != "completed" && Board != null && Board.Paused;
                    fault.after = JsonUtility.FromJson<Readiness>(ReadinessJson());
                    fault.providerSubmits = fault.provider.SubmitCount;
                    fault.providerRecoveries = fault.provider.RecoveryCount;
                    fault.nativeRejection = fault.provider.NativeRejection;
                    journeyRequiresReload = true; report.requiresFixtureReload = true;
                }
                report.endedUtc = DateTime.UtcNow.ToString("O"); report.elapsedSeconds = Time.realtimeSinceStartup - journeyStarted;
                report.frames = frames.ToArray(); report.inputsAfterLastFrame = recordedInputs.ToArray();
                report.finalReady = frames.Count > 0 && frames[frames.Count - 1].snapshot.ready && !frames[frames.Count - 1].snapshot.busy;
                RecordingJourney = false; recordedInputs.Clear();
                LastJourneyJson = JsonUtility.ToJson(report, true);
                File.WriteAllText(Path.Combine(destination, "journey.json"), LastJourneyJson);
                Debug.Log("Board journey " + report.outcome + ": " + destination);
            }
        }
        private static bool AdvanceInput(Stack<IEnumerator> stack)
        {
            // PlayNextInput and Drag use nested IEnumerator and null frame
            // yields only. Reject new yield kinds instead of changing timing.
            while (stack.Count > 0)
            {
                var current = stack.Peek();
                if (!current.MoveNext()) { (stack.Pop() as IDisposable)?.Dispose(); continue; }
                if (current.Current is IEnumerator nested) { stack.Push(nested); continue; }
                if (current.Current != null) throw new InvalidOperationException("Unsupported recorded input yield: " + current.Current.GetType().Name);
                return true;
            }
            return false;
        }
        private IEnumerator CaptureJourneyFrame(string directory, List<JourneyFrame> frames, Action<string> done)
        {
            yield return new WaitForEndOfFrame();
            Texture2D texture = null;
            try
            {
                // Busy is permitted here. This remains stricter than simply
                // finding a camera: the matching board and overlay must render.
                if (!Board.PresentationInitialized || !Board.View.RenderedLayoutMatchesScreen)
                    throw new InvalidOperationException("Journey frame has no matching rendered board layout");
                var frame = new JourneyFrame { index = frames.Count, unityFrame = Time.frameCount,
                    elapsedSeconds = Time.realtimeSinceStartup - journeyStarted, unscaledDeltaMilliseconds = Time.unscaledDeltaTime * 1000,
                    snapshot = JsonUtility.FromJson<Readiness>(ReadinessJson()), inputs = recordedInputs.ToArray() };
                frame.png = "frame-" + frame.index.ToString("D5") + ".png";
                texture = ScreenCapture.CaptureScreenshotAsTexture();
                if (texture == null || texture.width != frame.snapshot.width || texture.height != frame.snapshot.height)
                    throw new InvalidOperationException("Journey screenshot dimensions differ from the rendered viewport");
                File.WriteAllBytes(Path.Combine(directory, frame.png), texture.EncodeToPNG());
                frames.Add(frame); recordedInputs.Clear(); if (sampling) sampleCaptures++;
                done(null);
            }
            catch (Exception error) { done(error.ToString()); }
            finally { if (texture != null) Destroy(texture); }
        }
    }
}
#endif
