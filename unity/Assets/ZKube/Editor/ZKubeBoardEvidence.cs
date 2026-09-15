using System;
using System.Reflection;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using ZKube.Presentation.Evidence;

namespace ZKube.Editor
{
    // Editor-only viewport control for repeatable captures. Readiness records
    // the actual Screen dimensions after resizing; this does not simulate a
    // device density, safe area, or touch driver.
    [InitializeOnLoad]
    public static class ZKubeBoardEvidence
    {
        [Serializable] private sealed class Request
        {
            public string id, action, fixture, output, control, scenario, raw, surface, outcome;
            public int width = 430, height = 932, frames = 300;
            public int inputs = 1;
            public float seconds = 15;
            public float textScale = 1;
            public bool muted = true, reducedMotion = true, haptics;
        }
        [Serializable] private sealed class Response
        {
            public string id, status, result, utc;
        }
        private static bool commandRunning;
        private static readonly string CommandDirectory = Path.GetFullPath(Path.Combine(Application.dataPath, "../../build/unity/editor-commands"));

        static ZKubeBoardEvidence()
        {
            // Local, bounded evidence operations only. No arbitrary code or
            // network endpoint; this assembly never ships in a player.
            if (!Application.isBatchMode) EditorApplication.update += Poll;
        }

        private static void Poll()
        {
            if (commandRunning || EditorApplication.isCompiling) return;
            string path = Path.Combine(CommandDirectory, "request.json");
            if (!File.Exists(path)) return;
            Request request = null;
            try
            {
                request = JsonUtility.FromJson<Request>(File.ReadAllText(path));
                File.Delete(path);
                if (request == null || string.IsNullOrEmpty(request.id)) throw new ArgumentException("Command id required");
                if (request.action == "mcp-settings")
                {
                    SettingsService.OpenProjectSettings("Project/AI/Unity MCP");
                    Finish(request, "ok", "Opened official MCP settings");
                    return;
                }
                if (request.action == "exit") { Finish(request, "ok", "Exiting Editor"); EditorApplication.Exit(0); return; }
                if (request.action == "profiler-export")
                {
                    Finish(request, "ok", ZKubeProfilerEvidence.Export(request.raw, request.output));
                    return;
                }
                if (request.surface != null && request.surface != "board" && request.surface != "money") throw new ArgumentException("Unknown evidence surface");
                if (request.action == "open")
                {
                    if (request.surface == "money") OpenMoney(); else Open();
                    Finish(request, "ok", "Entering Play mode"); return;
                }
#if !ZKUBE_STORE
                if (request.surface == "money")
                {
                    var money = UnityEngine.Object.FindFirstObjectByType<ZKube.Integration.App.MoneyOverviewEvidenceHost>();
                    if (!EditorApplication.isPlaying || money == null) throw new InvalidOperationException("Open the dedicated MoneyEvidence scene in Play mode");
                    commandRunning = true;
                    money.StartCoroutine(Execute(request, MoneyOperation(request, money),
                        () => request.action == "journey" ? money.LastJourneyJson : money.ReadinessJson()));
                    return;
                }
#else
                if (request.surface == "money") throw new InvalidOperationException("Money evidence is excluded from store");
#endif
                var harness = UnityEngine.Object.FindFirstObjectByType<BoardEvidenceHarness>();
                if (!EditorApplication.isPlaying || harness == null) throw new InvalidOperationException("Board evidence requires Play mode");
                commandRunning = true;
                harness.StartCoroutine(Execute(request, Operation(request, harness),
                    () => request.action == "journey" || request.action == "fault-journey" ? harness.LastJourneyJson : harness.ReadinessJson()));
            }
            catch (Exception error) { Finish(request, "error", error.ToString()); }
        }

        private static IEnumerator Execute(Request request, IEnumerator operation, Func<string> result)
        {
            // Poll starts this coroutine in an Editor update. Screen and rendered
            // readiness belong to a player frame, not that Editor callback.
            yield return null;
            var pending = new Stack<IEnumerator>();
            pending.Push(operation);
            double deadline = EditorApplication.timeSinceStartup + 30;
            try
            {
                while (pending.Count != 0)
                {
                    object instruction = null;
                    Exception failure = null;
                    try
                    {
                        if ((request.action == "profile" || request.surface == "money") && EditorApplication.timeSinceStartup > deadline)
                            throw new TimeoutException("Evidence workload exceeded its 30-second bound");
                        var current = pending.Peek();
                        if (!current.MoveNext()) { (pending.Pop() as IDisposable)?.Dispose(); continue; }
                        instruction = current.Current;
                    }
                    catch (Exception error) { failure = error; }
                    if (failure != null) { Finish(request, "error", failure.ToString()); yield break; }
                    if (instruction is IEnumerator nested) pending.Push(nested);
                    else yield return instruction;
                }
            }
            finally { while (pending.Count != 0) (pending.Pop() as IDisposable)?.Dispose(); }
            Finish(request, "ok", result());
        }

        public static void OpenMoney()
        {
#if !ZKUBE_STORE
            const string path = "Assets/ZKube/Scenes/MoneyEvidence.unity";
            if (Application.isBatchMode || EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Open captures from an idle graphics Editor");
            if (!File.Exists(path)) throw new InvalidOperationException("Root must prepare the dedicated MoneyEvidence scene first");
            EditorSceneManager.OpenScene(path); SetViewport(430, 932); EditorApplication.isPlaying = true;
#else
            throw new InvalidOperationException("Money evidence is excluded from store");
#endif
        }
#if !ZKUBE_STORE
        private static IEnumerator MoneyOperation(Request request, ZKube.Integration.App.MoneyOverviewEvidenceHost host)
        {
            switch (request.action)
            {
                case "readiness": break;
                case "load":
                    var load = host.Load(request.scenario);
                    while (!load.IsCompleted) yield return null;
                    load.GetAwaiter().GetResult(); yield return host.WaitReady(); break;
                case "viewport": SetViewport(request.width, request.height); yield return null; yield return null; break;
                case "click": yield return host.Click(request.control); break;
                case "input": yield return host.PlayNextInput(); break;
                case "advance":
                    if (request.outcome == "success") host.AdvancePendingSuccess();
                    else if (string.IsNullOrEmpty(request.outcome) || request.outcome == "failure") host.AdvancePendingFailure();
                    else throw new ArgumentException("Unknown finite money outcome");
                    break;
                case "capture": FocusGameView(); yield return null; yield return host.Capture(EvidencePath(request.output)); break;
                case "journey": FocusGameView(); yield return null; yield return host.RecordJourney(EvidencePath(request.output)); break;
                default: throw new ArgumentException("Unsupported money evidence operation: " + request.action);
            }
        }
#endif

        private static IEnumerator Operation(Request request, BoardEvidenceHarness harness)
        {
            switch (request.action)
            {
                case "readiness": break;
                case "load": harness.Load(request.fixture); break;
                case "viewport": SetViewport(request.width, request.height); yield return null; yield return null; break;
                case "input": yield return harness.PlayNextInput(); break;
                case "legal-input": yield return harness.PlayLegalInput(); break;
                case "click": harness.Click(request.control); yield return null; break;
                case "profile":
                    FocusGameView(); yield return null;
                    yield return Profile(request, harness); break;
                case "capture":
                    FocusGameView(); yield return null;
                    yield return harness.Capture(EvidencePath(request.output)); break;
                case "journey":
                    FocusGameView(); yield return null;
                    yield return harness.RecordInputJourney(EvidencePath(request.output), request.inputs, request.frames, request.seconds); break;
                case "fault-journey":
                    FocusGameView(); yield return null;
                    yield return harness.RecordFaultJourney(EvidencePath(request.output), request.scenario, request.frames, request.seconds); break;
                case "settings":
                    harness.Board.SetMuted(request.muted);
                    harness.Board.SetReducedMotion(request.reducedMotion);
                    harness.Board.SetHaptics(request.haptics);
                    harness.Board.SetTextScale(request.textScale); break;
                case "sample-start": harness.BeginFrameSample(request.frames); break;
                case "sample-end": harness.SaveFrameSample(EvidencePath(request.output)); break;
                default: throw new ArgumentException("Unknown evidence operation: " + request.action);
            }
        }

        private static IEnumerator Profile(Request request, BoardEvidenceHarness harness)
        {
            if (request.inputs < 1 || request.inputs > 12 || request.seconds < 1 || request.seconds > 20)
                throw new ArgumentOutOfRangeException("Profiler workload requires 1–12 inputs and 1–20 seconds");
            if (!harness.Board.Ready || harness.Board.Busy)
                throw new InvalidOperationException("Profile only a bound, rendered ready board");
            if (UnityEngine.Profiling.Profiler.enabled || UnityEngine.Profiling.Profiler.enableBinaryLog)
                throw new InvalidOperationException("An existing profiler session must finish before evidence profiling");
            string path = ZKubeProfilerEvidence.RecordingStem(EvidencePath(request.output));
            if (File.Exists(path) || File.Exists(path + ".raw"))
                throw new IOException("Use a fresh profiler output path");
            File.WriteAllText(path + ".before.json", harness.ReadinessJson());
            string previousLog = UnityEngine.Profiling.Profiler.logFile;
            double started = EditorApplication.timeSinceStartup;
            try
            {
                UnityEngine.Profiling.Profiler.logFile = path;
                UnityEngine.Profiling.Profiler.enableBinaryLog = true;
                UnityEngine.Profiling.Profiler.enabled = true;
                for (int index = 0; index < request.inputs; index++) yield return harness.PlayNextInput();
                while (EditorApplication.timeSinceStartup - started < request.seconds) yield return null;
            }
            finally
            {
                UnityEngine.Profiling.Profiler.enabled = false;
                UnityEngine.Profiling.Profiler.enableBinaryLog = false;
                UnityEngine.Profiling.Profiler.logFile = previousLog;
            }
            File.WriteAllText(path + ".after.json", harness.ReadinessJson());
            // The binary recording includes Editor and instrumentation overhead;
            // inspect it in Unity's Profiler, separately from no-capture timings.
            if ((!File.Exists(path) || new FileInfo(path).Length == 0) &&
                (!File.Exists(path + ".raw") || new FileInfo(path + ".raw").Length == 0))
                throw new IOException("Unity did not produce a nonempty profiler recording");
        }

        private static string EvidencePath(string output)
        {
            string root = Path.GetFullPath(Path.Combine(CommandDirectory, "..")) + Path.DirectorySeparatorChar;
            string path = Path.GetFullPath(output ?? "");
            if (!path.StartsWith(root, StringComparison.Ordinal)) throw new ArgumentException("Evidence output must be under build/unity");
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            return path;
        }

        private static void Finish(Request request, string status, string result)
        {
            commandRunning = false;
            Directory.CreateDirectory(CommandDirectory);
            string path = Path.Combine(CommandDirectory, "response.json");
            File.WriteAllText(path + ".tmp", JsonUtility.ToJson(new Response { id = request?.id, status = status, result = result, utc = DateTime.UtcNow.ToString("O") }, true));
            if (File.Exists(path)) File.Replace(path + ".tmp", path, null);
            else File.Move(path + ".tmp", path);
        }

        private const BindingFlags Members = BindingFlags.Public | BindingFlags.NonPublic |
                                             BindingFlags.Instance | BindingFlags.Static | BindingFlags.FlattenHierarchy;

        private static void FocusGameView()
        {
            var viewType = typeof(EditorWindow).Assembly.GetType("UnityEditor.GameView", true);
            var view = EditorWindow.GetWindow(viewType);
            view.Show(); view.Focus(); view.Repaint();
        }

        public static void Open()
        {
            if (Application.isBatchMode || EditorApplication.isPlayingOrWillChangePlaymode)
                throw new InvalidOperationException("Open captures from an idle graphics Editor");
            if (!System.IO.File.Exists(ZKubeBoardScene.Path)) ZKubeBoardScene.Create();
            EditorSceneManager.OpenScene(ZKubeBoardScene.Path);
            SetViewport(430, 932);
            EditorApplication.isPlaying = true;
        }

        public static void ConfigureGraphicsTests()
        {
            if (Application.isBatchMode) throw new InvalidOperationException("Rendered board tests require the graphics Editor");
            SetViewport(430, 932);
        }

        public static void SetViewport(int width, int height)
        {
            if (width < 240 || height < 240 || width > 4096 || height > 4096)
                throw new ArgumentOutOfRangeException(nameof(width));
            // Unity exposes no public fixed Game-view size API. These Editor
            // members are isolated here and checked against the pinned Editor:
            // https://github.com/Unity-Technologies/UnityCsReference/tree/master/Editor/Mono/GameView
            var assembly = typeof(EditorWindow).Assembly;
            var sizesType = assembly.GetType("UnityEditor.GameViewSizes", true);
            var sizes = sizesType.GetProperty("instance", Members).GetValue(null);
            var groupType = sizesType.GetProperty("currentGroupType", Members).GetValue(sizes);
            var group = sizesType.GetMethod("GetGroup", Members).Invoke(sizes, new[] { groupType });
            var groupClass = group.GetType();
            int count = (int)groupClass.GetMethod("GetTotalCount", Members).Invoke(group, null);
            int selected = -1;
            for (int index = 0; index < count; index++)
            {
                var size = groupClass.GetMethod("GetGameViewSize", Members).Invoke(group, new object[] { index });
                if ((int)size.GetType().GetProperty("width", Members).GetValue(size) == width &&
                    (int)size.GetType().GetProperty("height", Members).GetValue(size) == height &&
                    size.GetType().GetProperty("sizeType", Members).GetValue(size).ToString() == "FixedResolution")
                { selected = index; break; }
            }
            if (selected < 0)
            {
                var fixedSize = Enum.Parse(assembly.GetType("UnityEditor.GameViewSizeType", true), "FixedResolution");
                var size = Activator.CreateInstance(assembly.GetType("UnityEditor.GameViewSize", true),
                    new[] { fixedSize, (object)width, height, "zKube evidence" });
                groupClass.GetMethod("AddCustomSize", Members).Invoke(group, new[] { size });
                selected = count;
            }
            var viewType = assembly.GetType("UnityEditor.GameView", true);
            var view = EditorWindow.GetWindow(viewType);
            viewType.GetProperty("selectedSizeIndex", Members).SetValue(view, selected);
            view.Show(); view.Focus(); view.Repaint();
            Debug.Log($"ZKUBE_EVIDENCE_VIEWPORT requested={width}x{height}; read runtime readiness before capture");
        }
    }
}
