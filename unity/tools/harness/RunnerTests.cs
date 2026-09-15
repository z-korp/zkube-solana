using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using NUnit.Framework;

namespace ZKube.HarnessRegression
{
    public sealed class HarnessRunnerTests
    {
        [Test] public async Task EveryLifecycleFailureCountsAndLaterCasesContinue()
        {
            int later = 0, cleanup = 0;
            var output = new StringWriter();
            var cases = new[] {
                new TestMain.Case("all-phases", () => throw new InvalidOperationException("body broke"),
                    teardowns: new Func<Task>[] { () => throw new Exception("cleanup one"), () => { cleanup++; throw new Exception("cleanup two"); } },
                    dispose: () => throw new Exception("dispose broke")),
                new TestMain.Case("setup", () => { Assert.Fail("Body must not run after failed setup"); return Task.CompletedTask; },
                    setup: () => throw new Exception("setup broke"), dispose: () => { cleanup++; return Task.CompletedTask; }),
                new TestMain.Case("later", () => { later++; return Task.CompletedTask; })
            };
            Assert.AreEqual(1, await TestMain.Run(cases, output));
            Assert.AreEqual(1, later); Assert.AreEqual(2, cleanup);
            StringAssert.Contains("1 passed, 2 failed, 5 errors", output.ToString());
            StringAssert.DoesNotContain("PASS all-phases", output.ToString());
            StringAssert.Contains("PASS later", output.ToString());
        }
        [Test] public async Task ReflectionFailuresKeepTheirOriginalFrameAndDoNotStopDiscovery()
        {
            var output = new StringWriter();
            var discovered = TestMain.Discover(Assembly.GetExecutingAssembly(), "RunnerProbe");
            Assert.AreEqual(1, await TestMain.Run(discovered, output));
            string report = output.ToString();
            StringAssert.Contains("source broke", report);
            StringAssert.Contains("constructor broke", report);
            StringAssert.Contains("[teardown]", report); StringAssert.Contains("[dispose]", report);
            StringAssert.Contains("RunnerProbeBody.OriginalThrowSite", report);
            StringAssert.Contains("RunnerProbeAsync.OriginalAsyncSite", report);
            StringAssert.Contains("async void would escape the case boundary", report);
            StringAssert.Contains("PASS ZKube.HarnessRegression.RunnerProbeZ.Later", report);
            StringAssert.Contains("PASS ZKube.HarnessRegression.RunnerProbeCases.Multiple(2)", report);
            StringAssert.Contains("PASS ZKube.HarnessRegression.RunnerProbeCases.FromSource(3)", report);
        }
        [Test] public async Task EmptyDiscoveryAndEnumeratorDisposalCannotSucceed()
        {
            Assert.AreEqual(1, await TestMain.Run(Array.Empty<TestMain.Case>(), new StringWriter()));
            var output = new StringWriter();
            Assert.AreEqual(1, await TestMain.Run(BrokenEnumeration(), output));
            StringAssert.Contains("enumerator dispose broke", output.ToString());
            StringAssert.Contains("1 passed, 1 failed, 1 errors", output.ToString());
        }
        private static IEnumerable<TestMain.Case> BrokenEnumeration()
        {
            try { yield return new TestMain.Case("enumerated", () => Task.CompletedTask); }
            finally { throw new InvalidOperationException("enumerator dispose broke"); }
        }
    }
    // Deliberately failing reflection fixtures are run only by the regression
    // above. The outer invocation filters HarnessRunnerTests, not these probes.
    public sealed class RunnerProbeSource
    {
        public static IEnumerable<object[]> Source => throw new InvalidOperationException("source broke");
        [TestCaseSource(nameof(Source))] public void Body(int value) { }
    }
    public sealed class RunnerProbeConstructor
    {
        public RunnerProbeConstructor() { throw new InvalidOperationException("constructor broke"); }
        [Test] public void Body() { }
    }
    public sealed class RunnerProbeBody
    {
        [System.Runtime.CompilerServices.MethodImpl(System.Runtime.CompilerServices.MethodImplOptions.NoInlining)]
        [Test] public void OriginalThrowSite() { throw new InvalidOperationException("body source frame"); }
    }
    public sealed class RunnerProbeAsync
    {
        [Test] public async Task OriginalAsyncSite() { await Task.Yield(); throw new InvalidOperationException("async source frame"); }
    }
    public sealed class RunnerProbeCleanup : IDisposable
    {
        [Test] public void Body() { }
        [TearDown] public void Cleanup() { throw new InvalidOperationException("teardown broke"); }
        public void Dispose() { throw new InvalidOperationException("dispose broke"); }
    }
    public sealed class RunnerProbeAsyncVoid
    {
        [Test] public async void NeverInvoke() { await Task.Yield(); throw new InvalidOperationException("This must never be invoked"); }
    }
    public sealed class RunnerProbeCases
    {
        [TestCase(1)] [TestCase(2)] public void Multiple(int value) { Assert.Greater(value, 0); }
        public static object[] Source => new object[] { new object[] { 3 } };
        [TestCaseSource(nameof(Source))] public void FromSource(int value) { Assert.AreEqual(3, value); }
    }
    public sealed class RunnerProbeZ { [Test] public void Later() { } }
}
