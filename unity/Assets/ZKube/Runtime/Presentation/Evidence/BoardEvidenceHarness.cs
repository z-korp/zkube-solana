#if UNITY_EDITOR || ZKUBE_EVIDENCE
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Evidence
{
    // Offline readiness and synthetic VRF are compiled out of production. The
    // same pointer/button handlers drive the board in evidence and normal play.
    public sealed partial class BoardEvidenceHarness : MonoBehaviour
    {
        [Serializable] public sealed class FixtureList { public Fixture[] cases; }
        [Serializable] public sealed class Fixture
        {
            public string name, origin, realmOrigin, configRequestHex, configHex, initialStateHex, finalStateHex;
            public byte realmId;
            public Step[] steps;
        }
        [Serializable] public sealed class Step
        {
            public uint operation, counter, action;
            public byte row, start, destination, column, reason;
            public string output;
        }
        [Serializable] private sealed class Readiness
        {
            public string evidenceClass = "offline-native-editor-or-evidence-player";
            public string vrfSource = "synthetic native fixture outputs; no chain or wallet";
            public string inputEvidence = "screen-coordinate GraphicRaycaster hit testing and EventSystem dispatch; OS/device touch unverified";
            public string fixture, fixtureOrigin, realmOrigin, sourceSha256, unityVersion, platform, replayHash, stateSha256;
            public byte realmId;
            public string capturedUtc, buildMode, operatingSystem, processor, graphicsDevice, graphicsApi;
            public string readinessIssue;
            public string editorBuildTarget;
            public BoardArt.TextureInfo[] textures;
            public bool ready, busy, reducedMotion, muted, haptics;
            public int width, height;
            public float density, cellPixels, dpi, textScale;
            public Rect safeArea, board;
            public ButtonRegion[] buttons;
            public RunSummarySummary accepted;
        }
        [Serializable] private sealed class ButtonRegion
        {
            public string name;
            public bool interactable;
            public Rect pixels;
            public float widthDp, heightDp;
        }
        [Serializable] private sealed class RunSummarySummary
        {
            public byte phase, stars, guardianCharges, rerolls, endReason, combo, chargesEarned, pressureTier;
            public ushort moves;
            public uint actionCounter, score, dailyScore, pressureScore;
            public ulong objectiveTotal;
        }
        [Serializable] private sealed class FrameReport
        {
            public string evidenceClass = "offline render-loop timing; not physical Seeker performance";
            public string metric = "Time.unscaledDeltaTime sampled in LateUpdate, skipping the first partial interval after Begin; not isolated CPU or GPU execution time";
            public string overhead = "Includes Editor/player, synthetic provider delays, native candidate search, test/input dispatch, VSync, and any screenshot/PNG work during this bounded window. Each sampled frame writes preallocated timing and total Unity allocated-memory arrays. Memory API and profiler overhead are included; summary sorting occurs after sampling.";
            public string fixture, unityVersion, platform, operatingSystem, processor, graphicsDevice, graphicsApi, startedUtc, endedUtc;
            public bool editor, developmentPlayer;
            public int width, height, sampleCount, capacity, capturesDuringWindow, targetFrameRate, vSyncCount;
            public float dpi, elapsedSeconds, meanMs, p95Ms, maxMs;
            public long unityAllocatedBytesStart, unityAllocatedBytesEnd;
            public long[] unityAllocatedBytes;
            public float[] frameMilliseconds;
        }
        public BoardController Board { get; private set; }
        public Fixture Current { get; private set; }
        public bool AutoStart = true;
        private int journeyCursor;
        private float[] frameSamples;
        private long[] memorySamples;
        private int frameCount, sampleCaptures;
        private bool sampling;
        private float sampleStart, sampleEnd;
        private long sampleMemoryStart;
        private string sampleStartedUtc;
        private int firstSampleAfterFrame;
        private FrameReport completedSample;
        public static Fixture[] Fixtures => JsonUtility.FromJson<FixtureList>(BoardEvidenceData.Json).cases;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void AttachToBoardScene()
        {
            if (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != "Board") return;
            var board = FindFirstObjectByType<BoardController>();
            if (board != null && board.GetComponent<BoardEvidenceHarness>() == null) board.gameObject.AddComponent<BoardEvidenceHarness>();
        }
        private void Start()
        {
            Board = GetComponent<BoardController>();
            if (AutoStart) Load("realm-8-daily");
        }
        public void Load(string name)
        {
            if (RecordingJourney) throw new InvalidOperationException("Finish the recorded input journey before changing fixtures");
            if (sampling) throw new InvalidOperationException("Finish the timing window before changing fixtures");
            Board = GetComponent<BoardController>();
            if (Board.Busy) throw new InvalidOperationException("Wait for the accepted action before loading another fixture");
            Current = Fixtures.Single(f => f.name == name); journeyCursor = 0;
            var config = BuildConfigRequest.Decode(Hex(Current.configRequestHex));
            var token = new CoreRunToken(Hex(Current.configHex), Hex(Current.initialStateHex));
            Board.Bind(new BoardSession(token, config, new OfflineActions(Current), "", Current.realmId));
            journeyRequiresReload = false;
        }

        public IEnumerator PlayNextInput()
        {
            if (journeyRequiresReload) throw new InvalidOperationException("Reload a fixture after an incomplete journey before using fixture inputs again");
            while (!Board.Ready || Board.Busy) yield return null;
            while (journeyCursor < Current.steps.Length && Current.steps[journeyCursor].operation == ApplyVrfRequest.Operation) journeyCursor++;
            if (journeyCursor >= Current.steps.Length) yield break;
            var step = Current.steps[journeyCursor++];
            RecordInput("fixture-step", Vector2.zero, null, step.operation);
            if (step.operation == PlayMoveRequest.Operation)
            {
                int width = Board.View.DisplayGrid[step.row * 8 + step.start];
                var from = Board.View.Layout.CellCenter(step.row, step.start, width);
                var to = Board.View.Layout.CellCenter(step.row, step.destination, width);
                yield return Drag(from, to);
            }
            else if (step.operation == ApplyBonusRequest.Operation)
            {
                Click("Guardian action");
                var position = Board.View.Layout.CellCenter(step.row, step.column);
                Tap(position);
            }
            else if (step.operation == RequestRerollRequest.Operation) Click("Reroll action");
            else if (step.operation == FinishRequest.Operation && step.reason == 3)
            {
                Click("Pause"); yield return null; Click("Dialog End run"); yield return null; Click("Dialog End run");
            }
            else if (step.operation == FinishRequest.Operation)
                throw new InvalidOperationException("Deadline is external acceptance evidence, not a player gesture; capture before it or bind its accepted state separately");
            while (Board.Busy) yield return null;
            yield return null;
        }
        // Bounded evidence input for opening-to-terminal measurements. The native
        // engine chooses legality; candidate results are discarded, then one real
        // drag passes through the ordinary provider and accepted-state path.
        public IEnumerator PlayLegalInput()
        {
            if (RecordingJourney || journeyRequiresReload || !Board.Ready || Board.Busy)
                throw new InvalidOperationException("Automatic evidence input requires a ready board outside a recording");
            if (Board.State.Phase != (byte)CorePhase.Playing)
                throw new InvalidOperationException("Automatic evidence input requires a playing run");
            var token = Board.Session.Accepted;
            var state = Board.State;
            byte selectedRow = 0, selectedStart = 0, selectedDestination = 0;
            bool found = false;
            for (byte row = 0; row < 10 && !found; row++)
                for (byte start = 0; start < 8 && !found;)
                {
                    int width = state.Grid[row * 8 + start];
                    if (width == 0) { start++; continue; }
                    for (byte destination = 0; destination + width <= 8; destination++)
                    {
                        if (destination == start) continue;
                        try { NativeEngine.PlayMove(token, state.ActionCounter, state.Moves, row, start, destination, false); }
                        catch (NativeEngineException error) when (error.Status == NativeStatus.DestinationOccupied) { continue; }
                        selectedRow = row; selectedStart = start; selectedDestination = destination; found = true; break;
                    }
                    start += (byte)width;
                }
            if (!found) throw new InvalidOperationException("No native-accepted move available; full-run evidence is incomplete");
            int selectedWidth = state.Grid[selectedRow * 8 + selectedStart];
            yield return Drag(Board.View.Layout.CellCenter(selectedRow, selectedStart, selectedWidth),
                Board.View.Layout.CellCenter(selectedRow, selectedDestination, selectedWidth));
            while (Board.Busy) yield return null;
            yield return null;
            if (Board.RecoveryRequired || Board.State.ActionCounter != state.ActionCounter + 1)
                throw new InvalidOperationException("Evidence drag did not produce exactly one accepted action");
            // Do not mix the original fixture script with an independently played run.
            journeyCursor = Current.steps.Length;
        }
        public IEnumerator Drag(Vector2 from, Vector2 to) =>
            EvidencePointer.Drag(from, to, (kind, position, target) => RecordInput(kind, position, target));
        public void Click(string name) => EvidencePointer.Click(
            Board.View.GetComponentsInChildren<Button>().Single(button => button.name == name && button.isActiveAndEnabled),
            (kind, position, target) => RecordInput(kind, position, target));
        public void Tap(Vector2 screen, GameObject expected = null) =>
            EvidencePointer.Tap(screen, expected, (kind, position, target) => RecordInput(kind, position, target));
        public string ReadinessJson()
        {
            if (Board == null) Board = GetComponent<BoardController>();
            var state = Board.State;
            return JsonUtility.ToJson(new Readiness
            {
                fixture = Current?.name, fixtureOrigin = Current?.origin, realmOrigin = Current?.realmOrigin,
                realmId = Board.PresentedRealmId, sourceSha256 = BoardEvidenceData.SourceSha256,
                capturedUtc = DateTime.UtcNow.ToString("O"),
                buildMode = Application.isEditor ? "Editor" : Debug.isDebugBuild ? "evidence-player-development" : "evidence-player",
                operatingSystem = SystemInfo.operatingSystem, processor = SystemInfo.processorType,
                graphicsDevice = SystemInfo.graphicsDeviceName, graphicsApi = SystemInfo.graphicsDeviceType.ToString(), dpi = Screen.dpi,
                unityVersion = Application.unityVersion, platform = Application.platform.ToString(),
                ready = Board.Ready, busy = Board.Busy, reducedMotion = Board.ReducedMotion, muted = Board.Muted, haptics = Board.Haptics,
                readinessIssue = Board.ReadinessIssue,
                editorBuildTarget = EditorTarget(), textures = Board.ImportedTextures,
                width = Screen.width, height = Screen.height, textScale = Board.TextScale, density = Board.PresentationInitialized ? Board.View.Layout.Density : 0,
                cellPixels = Board.PresentationInitialized ? Board.View.Layout.Cell : 0, safeArea = Screen.safeArea,
                board = Board.PresentationInitialized ? Board.View.Layout.Board : default,
                buttons = ButtonRegions(),
                replayHash = state == null ? null : Convert.ToBase64String(state.ReplayHash),
                stateSha256 = Board.Session == null ? null : StateSha256(Board.Session.Accepted.State),
                accepted = state == null ? null : new RunSummarySummary
                {
                    phase = state.Phase, endReason = state.EndReason, stars = state.LatchedStarSources, guardianCharges = state.BonusCharges,
                    combo = state.ComboCounter, chargesEarned = state.ChargesEarned, pressureTier = state.CurrentTier, pressureScore = state.PressureScore,
                    rerolls = state.RerollCharges, moves = state.Moves, actionCounter = state.ActionCounter,
                    score = state.Score, dailyScore = state.DailyScore, objectiveTotal = state.ObjectiveTotal
                }
            }, true);
        }
        private ButtonRegion[] ButtonRegions()
        {
            if (!Board.PresentationInitialized) return Array.Empty<ButtonRegion>();
            Canvas.ForceUpdateCanvases();
            return Board.View.GetComponentsInChildren<Button>().Where(button => button.isActiveAndEnabled).Select(button => {
                var rect = button.GetComponent<RectTransform>();
                var corners = new Vector3[4]; rect.GetWorldCorners(corners);
                var min = RectTransformUtility.WorldToScreenPoint(null, corners[0]);
                var max = RectTransformUtility.WorldToScreenPoint(null, corners[2]);
                var pixels = Rect.MinMaxRect(min.x, min.y, max.x, max.y);
                return new ButtonRegion { name = button.name, interactable = button.interactable, pixels = pixels,
                    widthDp = pixels.width / Board.View.Layout.Density, heightDp = pixels.height / Board.View.Layout.Density };
            }).ToArray();
        }
        public IEnumerator Capture(string pngPath)
        {
            if (Board == null || !Board.Ready || Board.Busy)
                throw new InvalidOperationException("Cannot capture an unready board: " + (Board == null ? "No controller" : Board.ReadinessIssue));
            var session = Board.Session; var accepted = session.Accepted;
            var viewport = new Vector2Int(Screen.width, Screen.height);
            // Overlay UI is captured only after the actual Game view/player
            // frame renders. Camera.Render alone would omit that overlay.
            if (Application.isEditor && Application.isBatchMode)
                throw new InvalidOperationException("End-of-frame evidence capture requires a non-batch Editor with Game view focused, or a graphics player");
            yield return new WaitForEndOfFrame();
            if (!Board.Ready || Board.Busy || !ReferenceEquals(session, Board.Session) ||
                !ReferenceEquals(accepted, Board.Session.Accepted) || viewport.x != Screen.width || viewport.y != Screen.height)
                throw new InvalidOperationException("Board acceptance or layout changed before the capture frame completed");
            var texture = ScreenCapture.CaptureScreenshotAsTexture();
            if (texture == null || texture.width != Screen.width || texture.height != Screen.height)
                throw new InvalidOperationException("Screenshot dimensions differ from the active rendered viewport");
            try
            {
                string fullPath = Path.GetFullPath(pngPath);
                Directory.CreateDirectory(Path.GetDirectoryName(fullPath));
                string readiness = ReadinessJson();
                File.WriteAllBytes(fullPath, texture.EncodeToPNG());
                File.WriteAllText(Path.ChangeExtension(fullPath, ".json"), readiness);
                if (sampling) sampleCaptures++;
                Debug.Log("Board evidence captured: " + fullPath);
            }
            finally { Destroy(texture); }
        }
        private static string StateSha256(byte[] state)
        {
            using (var hash = SHA256.Create()) return Convert.ToBase64String(hash.ComputeHash(state));
        }
        private static string EditorTarget()
        {
#if UNITY_EDITOR
            return UnityEditor.EditorUserBuildSettings.activeBuildTarget.ToString();
#else
            return "not-editor";
#endif
        }
        public void BeginFrameSample(int capacity = 300)
        {
            if (Board == null || !Board.Ready) throw new InvalidOperationException("Begin timing only on a bound, rendered ready board");
            if (sampling) throw new InvalidOperationException("Finish the current timing window first");
            frameSamples = new float[Mathf.Clamp(capacity, 1, 18000)]; memorySamples = new long[frameSamples.Length]; frameCount = 0; sampleCaptures = 0;
            completedSample = null; firstSampleAfterFrame = Time.frameCount + 1;
            sampleStart = Time.realtimeSinceStartup; sampleEnd = sampleStart;
            sampleStartedUtc = DateTime.UtcNow.ToString("O");
            sampleMemoryStart = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
            sampling = true;
        }
        private void LateUpdate()
        {
            if (!sampling || Time.frameCount <= firstSampleAfterFrame) return;
            if (frameCount == 0)
            {
                sampleStart = Time.realtimeSinceStartup - Time.unscaledDeltaTime;
                sampleStartedUtc = DateTime.UtcNow.AddSeconds(-Time.unscaledDeltaTime).ToString("O");
            }
            memorySamples[frameCount] = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
            frameSamples[frameCount++] = Time.unscaledDeltaTime * 1000;
            sampleEnd = Time.realtimeSinceStartup;
            if (frameCount == frameSamples.Length || sampleEnd - sampleStart >= 300) FinishFrameSample();
        }
        public string EndFrameSample()
        {
            if (frameSamples == null || frameCount == 0) throw new InvalidOperationException("No frame samples recorded");
            if (completedSample == null) FinishFrameSample();
            return JsonUtility.ToJson(completedSample, true);
        }
        private void FinishFrameSample()
        {
            sampling = false;
            // Freeze device/viewport/fixture and memory before summary/file work.
            // A later Save cannot silently relabel a completed sampling window.
            long memoryEnd = UnityEngine.Profiling.Profiler.GetTotalAllocatedMemoryLong();
            var samples = frameSamples.Take(frameCount).ToArray(); var ordered = samples.OrderBy(f => f).ToArray();
            completedSample = new FrameReport
            {
                fixture = Current?.name, unityVersion = Application.unityVersion, platform = Application.platform.ToString(),
                operatingSystem = SystemInfo.operatingSystem, processor = SystemInfo.processorType,
                graphicsDevice = SystemInfo.graphicsDeviceName, graphicsApi = SystemInfo.graphicsDeviceType.ToString(),
                startedUtc = sampleStartedUtc, endedUtc = DateTime.UtcNow.ToString("O"), editor = Application.isEditor, developmentPlayer = Debug.isDebugBuild,
                width = Screen.width, height = Screen.height, dpi = Screen.dpi, sampleCount = frameCount,
                capacity = frameSamples.Length, capturesDuringWindow = sampleCaptures,
                targetFrameRate = Application.targetFrameRate, vSyncCount = QualitySettings.vSyncCount,
                elapsedSeconds = sampleEnd - sampleStart, meanMs = samples.Average(),
                p95Ms = ordered[Mathf.Clamp(Mathf.CeilToInt(frameCount * .95f) - 1, 0, frameCount - 1)], maxMs = ordered[frameCount - 1],
                unityAllocatedBytesStart = sampleMemoryStart, unityAllocatedBytesEnd = memoryEnd,
                unityAllocatedBytes = memorySamples.Take(frameCount).ToArray(),
                frameMilliseconds = samples
            };
        }
        public void SaveFrameSample(string jsonPath)
        {
            string report = EndFrameSample(); string fullPath = Path.GetFullPath(jsonPath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath)); File.WriteAllText(fullPath, report);
        }
        public static byte[] Hex(string value)
        {
            var bytes = new byte[value.Length / 2];
            for (int i = 0; i < bytes.Length; i++) bytes[i] = Convert.ToByte(value.Substring(i * 2, 2), 16);
            return bytes;
        }

        private sealed class OfflineActions : IBoardActionProvider
        {
            private readonly byte[][] outputs;
            private readonly string seed;
            private int outputIndex;
            public OfflineActions(Fixture fixture)
            {
                outputs = fixture.steps.Where(s => s.operation == ApplyVrfRequest.Operation).Select(s => Hex(s.output)).ToArray();
                seed = fixture.name;
            }
            public async Task<BoardActionResult> Submit(CoreRunToken token, BoardAction action, CancellationToken cancellation)
            {
                await Task.Delay(150, cancellation);
                var state = NativeEngine.Summary(token);
                switch (action.Kind)
                {
                    case BoardActionKind.Move: return NativeEngine.PlayMove(token, state.ActionCounter, state.Moves, action.Row, action.Start, action.Destination);
                    case BoardActionKind.Guardian: return NativeEngine.ApplyBonus(token, state.ActionCounter, action.Row, action.Start);
                    case BoardActionKind.Reroll: return NativeEngine.RequestReroll(token, state.ActionCounter);
                    case BoardActionKind.Abandon: return NativeEngine.Finish(token, 3);
                    default: throw new ArgumentOutOfRangeException(nameof(action));
                }
            }
            public async Task<BoardActionResult> ResolveVrf(CoreRunToken token, CancellationToken cancellation)
            {
                await Task.Delay(250, cancellation);
                var state = NativeEngine.Summary(token);
                byte[] output;
                if (outputIndex < outputs.Length) output = outputs[outputIndex++];
                else using (var hash = SHA256.Create()) output = hash.ComputeHash(Encoding.UTF8.GetBytes(seed + ":" + state.LastVrfCounter));
                return NativeEngine.ApplyVrf(token, state.LastVrfCounter + 1, output);
            }
        }
    }
}
#endif
