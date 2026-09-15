using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;

public sealed class ProfilerSummaryTests
{
    private ResolveEventHandler resolver;
    [NUnit.Framework.TearDown]
    public void RemoveResolver() { if (resolver != null) AppDomain.CurrentDomain.AssemblyResolve -= resolver; }
    private const BindingFlags Fields = BindingFlags.Public | BindingFlags.Instance;
    [NUnit.Framework.Test]
    public void MissingMeasurementsAndRealZerosRemainDistinct()
    {
        string managed = Environment.GetEnvironmentVariable("ZKUBE_UNITY_MANAGED_PATH") ?? throw new InvalidOperationException("Run with unity/tools/harness.py");
        resolver = (_, args) => {
            string p = Path.Combine(managed, new AssemblyName(args.Name).Name + ".dll");
            return File.Exists(p) ? Assembly.LoadFrom(p) : null;
        };
        AppDomain.CurrentDomain.AssemblyResolve += resolver;
        var assembly = Assembly.LoadFrom(Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, "../Library/ScriptAssemblies/ZKube.Editor.dll")));
        var owner = assembly.GetType("ZKube.Editor.ZKubeProfilerEvidence");
        var number = owner.GetNestedType("Number", BindingFlags.NonPublic);
        var frame = owner.GetNestedType("Frame", BindingFlags.NonPublic);
        object Read(double v) => number.GetMethod("Read").Invoke(null, new object[] { v });
        object Missing() => number.GetMethod("Missing").Invoke(null, new object[] { "test-unavailable" });
        object Field(object obj, string field) => obj.GetType().GetField(field, Fields).GetValue(obj);
        void Assert(bool good, string name) { NUnit.Framework.Assert.IsTrue(good, name); }
        var list = (IList)Activator.CreateInstance(typeof(System.Collections.Generic.List<>).MakeGenericType(frame));
        void Add(int index, object measurement) {
            var f = Activator.CreateInstance(frame);
            frame.GetField("index").SetValue(f, index);
            frame.GetField("mainThreadFrameMs").SetValue(f, measurement);
            list.Add(f);
        }
        var argument = Expression.Parameter(frame);
        var selector = Expression.Lambda(typeof(Func<,>).MakeGenericType(frame, number), Expression.Field(argument, "mainThreadFrameMs"), argument).Compile();
        object Summary() => owner.GetMethod("Summarize", BindingFlags.NonPublic | BindingFlags.Static).Invoke(null, new object[] { list, "test", "ms", selector });
        Add(10, Read(0)); Add(20, Read(10)); Add(30, Read(20)); Add(40, Read(30)); Add(5, Read(30)); Add(50, Missing());
        var summary = Summary();
        Assert((int)Field(summary,"availableFrames") == 5 && (int)Field(summary,"unavailableFrames") == 1, "missing excluded, measured zero included");
        Assert((double)Field(Field(summary,"min"),"value") == 0 && (bool)Field(Field(summary,"min"),"available"), "real zero remains available");
        Assert((double)Field(Field(summary,"mean"),"value") == 18, "mean excludes unavailable placeholder");
        Assert((double)Field(Field(summary,"p50"),"value") == 20 && (double)Field(Field(summary,"p95"),"value") == 30 && (double)Field(Field(summary,"p99"),"value") == 30, "nearest-rank percentiles");
        Assert(((int[])Field(summary,"worstFrameIndices")).SequenceEqual(new[] {5,40,30,20,10}), "worst frames and deterministic ties");
        list.Clear(); Add(9,Missing()); summary = Summary();
        Assert((int)Field(summary,"availableFrames") == 0 && !(bool)Field(Field(summary,"mean"),"available") && ((int[])Field(summary,"worstFrameIndices")).Length == 0, "all unavailable has no synthetic distribution");
        Assert(!(bool)Field(Read(double.NaN),"available") && !(bool)Field(Read(double.PositiveInfinity),"available") && !(bool)Field(Read(-1),"available"), "invalid numbers unavailable");
    }
}
