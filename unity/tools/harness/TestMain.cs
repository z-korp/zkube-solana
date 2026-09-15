// Shared safe runner: discovery and every lifecycle failure are test results.
using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;

namespace ZKube
{
    public static class TestMain
    {
        public sealed class Case
        {
            public string Name { get; }
            public Func<Task> Body { get; }
            public Func<Task> Setup { get; }
            public IReadOnlyList<Func<Task>> Teardowns { get; }
            public Func<Task> Dispose { get; }
            public Case(string name, Func<Task> body, Func<Task> setup = null,
                IEnumerable<Func<Task>> teardowns = null, Func<Task> dispose = null)
            {
                Name = name; Body = body; Setup = setup;
                Teardowns = (teardowns ?? Array.Empty<Func<Task>>()).ToArray(); Dispose = dispose;
            }
        }
        // Explicit lists and reflection discovery share this runner. A case
        // passes only after cleanup; each failure receives its own diagnostic.
        public static async Task<int> Run(IEnumerable<Case> cases, TextWriter output = null)
        {
            output ??= Console.Out;
            int passed = 0, failed = 0, errors = 0;
            bool outputFailed = false;
            void Write(string text) { try { output.WriteLine(text); } catch { outputFailed = true; } }
            void Failure(string name, string phase, Exception error)
            {
                errors++;
                var actual = Unwrap(error);
                Write("FAIL " + name + " [" + phase + "]: " + actual.GetType().Name + ": " +
                    actual.Message.Replace('\r', ' ').Replace('\n', ' ') + Frame(actual));
            }
            try
            {
                foreach (var item in cases)
                {
                    int before = errors;
                    string name = item?.Name ?? "<invalid case>";
                    try
                    {
                        if (item == null || item.Body == null) throw new ArgumentException("Case has no body");
                        if (item.Setup != null) await item.Setup().ConfigureAwait(false);
                    }
                    catch (Exception error) { Failure(name, "setup", error); }
                    if (errors == before)
                        try { await item.Body().ConfigureAwait(false); }
                        catch (Exception error) { Failure(name, "body", error); }
                    if (item != null)
                    {
                        foreach (var cleanup in item.Teardowns)
                            try { await cleanup().ConfigureAwait(false); }
                            catch (Exception error) { Failure(name, "teardown", error); }
                        if (item.Dispose != null)
                            try { await item.Dispose().ConfigureAwait(false); }
                            catch (Exception error) { Failure(name, "dispose", error); }
                    }
                    if (errors == before) { passed++; Write("PASS " + name); }
                    else failed++;
                }
            }
            catch (Exception error) { failed++; Failure("harness", "discovery", error); }
            Write($"{passed} passed, {failed} failed, {errors} errors" + (passed + failed == 0 ? " (no cases matched)" : ""));
            return failed != 0 || passed == 0 || outputFailed ? 1 : 0;
        }
        private static Exception Unwrap(Exception error)
        {
            while ((error is TargetInvocationException || error is AggregateException aggregate && aggregate.InnerExceptions.Count == 1)
                && error.InnerException != null) error = error.InnerException;
            return error;
        }
        private static string Frame(Exception error)
        {
            var frame = (error.StackTrace ?? "").Split('\n').Select(s => s.Trim())
                .FirstOrDefault(s => s.Length > 0 && !s.Contains("ZKube.TestMain.") &&
                    !s.Contains("NUnit.Framework.") && !s.Contains("System.Reflection.") && !s.Contains("System.RuntimeMethodHandle."));
            return frame == null ? "" : " @ " + frame;
        }
        private static bool Has(MemberInfo member, string name) => member.GetCustomAttributes(false)
            .Any(a => a.GetType().FullName == "NUnit.Framework." + name + "Attribute");
        private static async Task Invoke(object instance, MethodInfo method, object[] arguments)
        {
            if (method.ReturnType == typeof(void) && method.IsDefined(typeof(System.Runtime.CompilerServices.AsyncStateMachineAttribute), false))
                throw new NotSupportedException("async void would escape the case boundary; return Task: " + method.Name);
            // Reporting unwraps reflection failures without rethrowing the
            // inner exception and losing its original test stack frame.
            var result = method.Invoke(instance, arguments);
            if (result is Task task) await task.ConfigureAwait(false);
            else if (method.ReturnType != typeof(void)) throw new NotSupportedException("Cases must return void or Task: " + method.Name);
        }
        public static IReadOnlyList<Case> Discover(Assembly assembly, string filter = "")
        {
            var cases = new List<Case>();
            void Broken(string name, Exception error) => cases.Add(new Case(name, () => Task.FromException(error)));
            Type[] types;
            try { types = assembly.GetTypes(); }
            catch (ReflectionTypeLoadException error)
            {
                foreach (var loader in error.LoaderExceptions.Where(e => e != null)) Broken("discovery.type-load", loader);
                types = error.Types.Where(t => t != null).ToArray();
            }
            foreach (var type in types.Where(t => t.IsClass && !t.IsAbstract).OrderBy(t => t.FullName))
            {
                MethodInfo[] methods;
                try { methods = type.GetMethods(BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance | BindingFlags.Static); }
                catch (Exception error) { Broken(type.FullName + ".discovery", error); continue; }
                foreach (var method in methods.OrderBy(m => m.Name))
                {
                    string name = type.FullName + "." + method.Name;
                    if (!name.Contains(filter, StringComparison.Ordinal)) continue;
                    try
                    {
                        if (!Has(method, "Test") && !Has(method, "TestCase") && !Has(method, "TestCaseSource")) continue;
                        if (methods.Any(m => Has(m, "OneTimeSetUp") || Has(m, "OneTimeTearDown")))
                            throw new NotSupportedException("One-time NUnit fixtures require the Unity test runner");
                        var setups = methods.Where(m => Has(m, "SetUp")).OrderBy(m => Depth(m.DeclaringType)).ThenBy(m => m.MetadataToken).ToArray();
                        var teardowns = methods.Where(m => Has(m, "TearDown")).OrderByDescending(m => Depth(m.DeclaringType)).ThenBy(m => m.MetadataToken).ToArray();
                        foreach (var arguments in Arguments(method))
                        {
                            var captured = arguments;
                            string label = name + (captured.Length == 0 ? "" : "(" + string.Join(", ", captured) + ")");
                            object instance = null;
                            cases.Add(new Case(label, () => Invoke(instance, method, captured), async () => {
                                if (!method.IsStatic) instance = Activator.CreateInstance(type, true);
                                foreach (var setup in setups) await Invoke(instance, setup, Array.Empty<object>()).ConfigureAwait(false);
                            }, teardowns.Select<MethodInfo, Func<Task>>(cleanup => () => instance == null && !cleanup.IsStatic
                                ? Task.CompletedTask : Invoke(instance, cleanup, Array.Empty<object>())), async () => {
                                if (instance is IAsyncDisposable disposable) await disposable.DisposeAsync().ConfigureAwait(false);
                                else (instance as IDisposable)?.Dispose();
                            }));
                        }
                    }
                    catch (Exception error) { Broken(name + ".discovery", error); }
                }
            }
            return cases;
        }
        private static int Depth(Type type) => type?.BaseType == null ? 0 : 1 + Depth(type.BaseType);
        private static IEnumerable<object[]> Arguments(MethodInfo method)
        {
            bool found = false;
            foreach (var attribute in method.GetCustomAttributes(false))
            {
                var type = attribute.GetType();
                if (type.FullName == "NUnit.Framework.TestCaseAttribute")
                {
                    if ((bool)type.GetProperty("HasExpectedResult").GetValue(attribute))
                        throw new NotSupportedException("ExpectedResult cases require the Unity test runner");
                    found = true; yield return (object[])type.GetProperty("Arguments").GetValue(attribute);
                }
                if (type.FullName == "NUnit.Framework.TestCaseSourceAttribute")
                {
                    found = true;
                    var sourceType = (Type)type.GetProperty("SourceType").GetValue(attribute) ?? method.DeclaringType;
                    var sourceName = (string)type.GetProperty("SourceName").GetValue(attribute);
                    var member = sourceType.GetMember(sourceName, BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static).Single();
                    var source = member is FieldInfo field ? field.GetValue(null) : member is PropertyInfo property ? property.GetValue(null) :
                        ((MethodInfo)member).Invoke(null, (object[])type.GetProperty("MethodParams").GetValue(attribute));
                    foreach (var value in (IEnumerable)source)
                    {
                        var args = value?.GetType().GetProperty("Arguments");
                        yield return args != null ? (object[])args.GetValue(value) : value is object[] array ? array : new[] { value };
                    }
                }
            }
            if (!found) yield return Array.Empty<object>();
        }
        private static async Task<int> Main(string[] args)
        {
            try { return await Run(Discover(Assembly.GetEntryAssembly(), args.Length == 0 ? "" : args[0])).ConfigureAwait(false); }
            catch (Exception error)
            {
                try { return await Run(new[] { new Case("harness.discovery", () => Task.FromException(error)) }).ConfigureAwait(false); }
                catch { return 1; }
            }
        }
    }
}
