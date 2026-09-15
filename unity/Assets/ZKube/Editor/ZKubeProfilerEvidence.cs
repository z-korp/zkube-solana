using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using UnityEditor;
using UnityEditor.Profiling;
using UnityEditorInternal;
using UnityEngine;
using UnityEngine.Profiling;

namespace ZKube.Editor
{
    // Editor-only, one closed recording per invocation. Public APIs checked
    // against the pinned Editor DLL, and the 6000.3 reference documentation:
    // https://docs.unity3d.com/6000.3/Documentation/ScriptReference/Profiling.RawFrameDataView.html
    // https://github.com/Unity-Technologies/UnityCsReference/blob/6000.3/Modules/ProfilerEditor/Public/ProfilerAPI.bindings.cs
    // GC.Alloc metadata slot 0 is the allocation byte count in Unity's example.
    public static class ZKubeProfilerEvidence
    {
        private const long MaxRawBytes = 256L * 1024 * 1024;
        private const int MaxFrames = 5000, MaxThreads = 256, MaxSamplesPerThread = 500000;
        private const long MaxSamples = 20000000;
        private const double MaxSeconds = 30;
        private static bool exporting;
        private static readonly string[] MemoryNames = {
            "System Used Memory", "Total Used Memory", "Total Reserved Memory",
            "GC Used Memory", "GC Reserved Memory", "Gfx Reserved Memory",
            "Audio Used Memory", "Video Used Memory", "Profiler Used Memory",
            "Profiler Reserved Memory", "Texture Memory", "Mesh Memory",
            "Material Memory", "AnimationClip Memory", "GC Allocated In Frame"
        };

        // JsonUtility has no nullable numeric fields. available=false means
        // value MUST be ignored; reason distinguishes absent/invalid/ambiguous.
        [Serializable] private sealed class Number
        {
            public bool available;
            public double value;
            public string reason;
            public static Number Missing(string reason) => new Number { reason = reason };
            public static Number Read(double value) => double.IsNaN(value) || double.IsInfinity(value) || value < 0
                ? Missing("invalid-negative-or-nonfinite") : new Number { available = true, value = value, reason = "recorded" };
        }
        [Serializable] private sealed class Counter { public string name; public Number bytes; }
        [Serializable] private sealed class ThreadRow
        {
            public int index, samples, gcAllocationSamples, gcMissingMetadataSamples;
            public string id, name, group;
            public Number gcAllocatedBytes;
            public long gcReadableMetadataBytes;
        }
        [Serializable] private sealed class Frame
        {
            public int index, threadCount, mainThreadIndex = -1;
            public Number mainThreadFrameMs, mainThreadFrameStartMs, gcAllocatedBytesAllRecordedThreads;
            public Counter[] mainThreadMemoryCounters;
            public ThreadRow[] threads;
        }
        [Serializable] private sealed class Distribution
        {
            public string metric, units;
            public int availableFrames, unavailableFrames;
            public Number min, mean, p50, p95, p99, max;
            public int[] worstFrameIndices;
        }
        [Serializable] private sealed class Sidecar
        {
            public string path, sha256, platform, buildMode, unityVersion, fixture, fixtureOrigin, sourceSha256;
        }
        [Serializable] private sealed class Report
        {
            public int schemaVersion = 1;
            public string rawPath, rawSha256, decoderUnityVersion, decoderEditorAssemblySha256, exportedUtc;
            public long rawBytes, inspectedSamples;
            public int firstLoadedFrame, lastLoadedFrame, loadedFrameCount;
            public string scope = "Instrumented Editor board workload; includes Editor and profiler overhead. Not Android or Seeker performance.";
            public string provenance = "Capture scope is reported by adjacent before/after sidecars; those are hashed but are not embedded authentication of the raw recording.";
            public string timing = "mainThreadFrameMs is RawFrameDataView.frameTimeMs for the unique thread named Main Thread. Elapsed recorded CPU frame duration can include waits; it is not active CPU utilization. Nested sample durations are never summed.";
            public string allocations = "GC.Alloc metadata slot 0 is summed once per allocation sample across recorded threads. This is recorded managed allocation traffic, not retained heap growth or proof that unrecorded allocations did not occur. No marker or unreadable metadata is unavailable, not zero.";
            public string memory = "Last recorded counter value in the selected main-thread frame; HasCounterValue distinguishes unavailable from zero. No counter values are summed across threads. Units are bytes.";
            public string distributions = "All loaded frames, including startup/teardown/outliers; no trimming. Nearest-rank percentiles. Worst frames sort descending by value, then ascending frame index. available=false numeric placeholders must be ignored.";
            public string coverage = "All frames exposed by LoadProfile(false) are exported; raw-file completeness and recorder buffer loss cannot be independently established by this public API.";
            public Sidecar before, after;
            public Frame[] frames;
            public Distribution[] summary;
            public double exportSeconds;
        }

        // The caller must serialize this with recording/import operations.
        // Loading deliberately replaces the Profiler window's in-memory history;
        // it never changes the raw file or enables recording.
        internal static string RecordingStem(string path) => path.EndsWith(".raw", StringComparison.OrdinalIgnoreCase)
            ? path.Substring(0, path.Length - 4) : path;

        public static string Export(string rawInput, string jsonOutput)
        {
            if (exporting) throw new InvalidOperationException("A profiler export is already running");
            RefuseRecording();
            if (EditorApplication.isCompiling || EditorApplication.isUpdating)
                throw new InvalidOperationException("Finish Editor compilation/import before decoding a profiler recording");
            string raw = EvidencePath(rawInput), output = EvidencePath(jsonOutput);
            if (!raw.EndsWith(".raw", StringComparison.OrdinalIgnoreCase) || !output.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                throw new ArgumentException("Export requires a .raw input and a fresh .json output");
            if (File.Exists(output)) throw new IOException("Use a fresh profiler summary output");
            var file = new FileInfo(raw);
            if (!file.Exists || file.Length <= 0 || file.Length > MaxRawBytes)
                throw new IOException("Profiler input must contain 1–268435456 bytes");
            var timer = Stopwatch.StartNew();
            exporting = true;
            try
            {
                string stem = RecordingStem(raw);
                var report = new Report { rawPath = raw, rawBytes = file.Length,
                    rawSha256 = Hash(raw), before = ReadSidecar(stem + ".before.json"), after = ReadSidecar(stem + ".after.json"),
                    decoderUnityVersion = Application.unityVersion, exportedUtc = DateTime.UtcNow.ToString("O"),
                    decoderEditorAssemblySha256 = Hash(typeof(RawFrameDataView).Assembly.Location) };
                if (report.before.unityVersion != report.after.unityVersion || report.before.fixture != report.after.fixture)
                    throw new FormatException("Recording sidecar versions/fixtures disagree");
                RefuseRecording();
                // LoadProfile is a synchronous native call. The file size limits
                // its input; the managed deadline cannot interrupt native loading.
                if (!ProfilerDriver.LoadProfile(raw, false)) throw new IOException("Unity rejected the profiler recording");
                Deadline(timer);
                report.firstLoadedFrame = ProfilerDriver.firstFrameIndex;
                report.lastLoadedFrame = ProfilerDriver.lastFrameIndex;
                if (report.firstLoadedFrame < 0 || report.lastLoadedFrame < report.firstLoadedFrame)
                    throw new IOException("Recording contains no readable frames");
                var frames = new List<Frame>();
                int index = report.firstLoadedFrame;
                while (true)
                {
                    Deadline(timer);
                    if (frames.Count == MaxFrames) throw new IOException("Recording exceeds the 5000-frame export bound");
                    frames.Add(ReadFrame(index, timer, ref report.inspectedSamples));
                    if (index == report.lastLoadedFrame) break;
                    int next = ProfilerDriver.GetNextFrameIndex(index);
                    if (next <= index || next > report.lastLoadedFrame) throw new IOException("Profiler frame traversal is incomplete");
                    index = next;
                }
                report.frames = frames.ToArray(); report.loadedFrameCount = frames.Count;
                var summary = new List<Distribution> {
                    Summarize(frames, "mainThreadFrameMs", "ms", f => f.mainThreadFrameMs),
                    Summarize(frames, "gcAllocatedBytesAllRecordedThreads", "bytes", f => f.gcAllocatedBytesAllRecordedThreads)
                };
                foreach (string name in MemoryNames)
                    summary.Add(Summarize(frames, name, "bytes", f => f.mainThreadMemoryCounters.First(c => c.name == name).bytes));
                report.summary = summary.ToArray();
                RefuseRecording();
                if (new FileInfo(raw).Length != report.rawBytes || Hash(raw) != report.rawSha256)
                    throw new IOException("Recording changed during export; no summary was written");
                Deadline(timer);
                report.exportSeconds = timer.Elapsed.TotalSeconds;
                // Thousands of frame/thread rows make indentation larger than
                // the data itself. Keep all observations in compact JSON.
                string json = JsonUtility.ToJson(report, false) + "\n";
                if (Encoding.UTF8.GetByteCount(json) > 64 * 1024 * 1024) throw new IOException("Summary exceeds its 64 MiB bound");
                Directory.CreateDirectory(Path.GetDirectoryName(output));
                // CreateNew prevents overwriting evidence even if another caller
                // created the file after the initial existence check.
                using (var stream = new FileStream(output, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                using (var writer = new StreamWriter(stream, new UTF8Encoding(false))) writer.Write(json);
                return output;
            }
            finally { exporting = false; }
        }

        private static Frame ReadFrame(int index, Stopwatch timer, ref long inspectedSamples)
        {
            var frame = new Frame { index = index, mainThreadFrameMs = Number.Missing("main-thread-not-found"),
                mainThreadFrameStartMs = Number.Missing("main-thread-not-found"),
                mainThreadMemoryCounters = MissingCounters("main-thread-not-found") };
            var threads = new List<ThreadRow>();
            int mainCount = 0;
            for (int threadIndex = 0; ; threadIndex++)
            {
                Deadline(timer);
                using (var view = ProfilerDriver.GetRawFrameDataView(index, threadIndex))
                {
                    if (!view.valid) break;
                    if (threadIndex == MaxThreads) throw new IOException("Frame exceeds the 256-thread export bound");
                    int samples = view.sampleCount;
                    if (samples < 0 || samples > MaxSamplesPerThread || inspectedSamples + samples > MaxSamples)
                        throw new IOException("Recording exceeds its sample traversal bound");
                    inspectedSamples += samples;
                    var row = new ThreadRow { index = threadIndex, id = view.threadId.ToString(), name = view.threadName,
                        group = view.threadGroupName, samples = samples };
                    int gc = view.GetMarkerId("GC.Alloc");
                    if (gc != FrameDataView.invalidMarkerId)
                    {
                        for (int sample = 0; sample < samples; sample++)
                        {
                            if ((sample & 4095) == 0) Deadline(timer);
                            if (view.GetSampleMarkerId(sample) != gc) continue;
                            row.gcAllocationSamples++;
                            if (view.GetSampleMetadataCount(sample) < 1) { row.gcMissingMetadataSamples++; continue; }
                            long bytes = view.GetSampleMetadataAsLong(sample, 0);
                            if (bytes < 0) { row.gcMissingMetadataSamples++; continue; }
                            row.gcReadableMetadataBytes = checked(row.gcReadableMetadataBytes + bytes);
                        }
                    }
                    row.gcAllocatedBytes = gc == FrameDataView.invalidMarkerId ? Number.Missing("GC.Alloc-marker-not-present")
                        : row.gcMissingMetadataSamples > 0 ? Number.Missing("GC.Alloc-metadata-incomplete") : Number.Read(row.gcReadableMetadataBytes);
                    threads.Add(row);
                    if (view.threadName != "Main Thread") continue;
                    mainCount++;
                    if (mainCount != 1) continue;
                    frame.mainThreadIndex = threadIndex;
                    frame.mainThreadFrameMs = Number.Read(view.frameTimeMs);
                    frame.mainThreadFrameStartMs = Number.Read(view.frameStartTimeMs);
                    frame.mainThreadMemoryCounters = MemoryNames.Select(name => ReadCounter(view, name)).ToArray();
                }
            }
            if (mainCount > 1)
            {
                frame.mainThreadIndex = -1;
                frame.mainThreadFrameMs = Number.Missing("ambiguous-main-thread");
                frame.mainThreadFrameStartMs = Number.Missing("ambiguous-main-thread");
                frame.mainThreadMemoryCounters = MissingCounters("ambiguous-main-thread");
            }
            frame.threads = threads.ToArray(); frame.threadCount = threads.Count;
            frame.gcAllocatedBytesAllRecordedThreads = threads.Count == 0 || threads.Any(t => !t.gcAllocatedBytes.available)
                ? Number.Missing("one-or-more-recorded-threads-unavailable") : Number.Read(threads.Sum(t => t.gcReadableMetadataBytes));
            return frame;
        }

        private static Counter[] MissingCounters(string reason) => MemoryNames.Select(name => new Counter { name = name, bytes = Number.Missing(reason) }).ToArray();
        private static Counter ReadCounter(RawFrameDataView view, string name)
        {
            int id = view.GetMarkerId(name);
            return new Counter { name = name, bytes = id == FrameDataView.invalidMarkerId ? Number.Missing("counter-marker-not-present")
                : !view.HasCounterValue(id) ? Number.Missing("counter-value-not-recorded-this-frame") : Number.Read(view.GetCounterValueAsLong(id)) };
        }
        private static Distribution Summarize(List<Frame> frames, string metric, string units, Func<Frame, Number> select)
        {
            var values = frames.Select(f => new { f.index, number = select(f) }).Where(v => v.number.available).OrderBy(v => v.number.value).ThenBy(v => v.index).ToArray();
            var d = new Distribution { metric = metric, units = units, availableFrames = values.Length, unavailableFrames = frames.Count - values.Length,
                worstFrameIndices = values.OrderByDescending(v => v.number.value).ThenBy(v => v.index).Take(10).Select(v => v.index).ToArray() };
            if (values.Length == 0) { d.min = d.mean = d.p50 = d.p95 = d.p99 = d.max = Number.Missing("no-available-frames"); return d; }
            d.min = Number.Read(values[0].number.value); d.max = Number.Read(values[values.Length - 1].number.value);
            d.mean = Number.Read(values.Average(v => v.number.value));
            d.p50 = Number.Read(values[(int)Math.Ceiling(values.Length * .50) - 1].number.value);
            d.p95 = Number.Read(values[(int)Math.Ceiling(values.Length * .95) - 1].number.value);
            d.p99 = Number.Read(values[(int)Math.Ceiling(values.Length * .99) - 1].number.value);
            return d;
        }
        private static Sidecar ReadSidecar(string input)
        {
            string path = EvidencePath(input);
            var info = new FileInfo(path);
            if (!info.Exists || info.Length > 65536) throw new IOException("A bounded adjacent Editor recording sidecar is required");
            byte[] bytes = File.ReadAllBytes(path);
            var sidecar = JsonUtility.FromJson<Sidecar>(Encoding.UTF8.GetString(bytes));
            if (sidecar == null || sidecar.buildMode != "Editor" || sidecar.platform == null || !sidecar.platform.EndsWith("Editor", StringComparison.Ordinal))
                throw new FormatException("This exporter requires sidecars declaring an Editor capture");
            sidecar.path = path;
            using (var sha = SHA256.Create()) sidecar.sha256 = Hex(sha.ComputeHash(bytes));
            return sidecar;
        }
        private static void RefuseRecording()
        {
            if (Profiler.enabled || Profiler.enableBinaryLog || ProfilerDriver.enabled)
                throw new InvalidOperationException("Stop active recording before exporting existing profiler evidence");
        }
        private static void Deadline(Stopwatch timer)
        { if (timer.Elapsed.TotalSeconds > MaxSeconds) throw new TimeoutException("Profiler export exceeded its 30-second managed traversal budget"); }
        private static string EvidencePath(string input)
        {
            if (string.IsNullOrWhiteSpace(input)) throw new ArgumentException("An evidence path is required");
            string root = Path.GetFullPath(Path.Combine(Application.dataPath, "../../build/unity"));
            string path = Path.GetFullPath(input);
            if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new ArgumentException("Profiler inputs and outputs must be under build/unity");
            for (string part = path; part != null; part = Path.GetDirectoryName(part))
            {
                if ((File.Exists(part) || Directory.Exists(part)) && (File.GetAttributes(part) & FileAttributes.ReparsePoint) != 0)
                    throw new IOException("Profiler evidence paths cannot traverse symbolic links");
                if (part == root) break;
            }
            return path;
        }
        private static string Hash(string path)
        { using (var stream = File.OpenRead(path)) using (var hash = SHA256.Create()) return Hex(hash.ComputeHash(stream)); }
        private static string Hex(byte[] hash) => BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }
}
