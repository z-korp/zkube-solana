using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

namespace ZKube.Editor
{
    // The performance package creates these Resources for ordinary Players too.
    // Remove its generated test metadata before Player asset collection starts.
    internal sealed class ZKubePlayerBuildGuard : IPreprocessBuildWithReport, IFilterBuildAssemblies
    {
        public int callbackOrder => int.MaxValue;

        public void OnPreprocessBuild(BuildReport report)
        {
            if ((report.summary.options & BuildOptions.IncludeTestAssemblies) != 0) return;
            foreach (var name in new[] { "PerformanceTestRunInfo.json", "PerformanceTestRunSettings.json" })
            {
                var path = "Assets/Resources/" + name;
                if (File.Exists(path) && !AssetDatabase.DeleteAsset(path))
                    throw new BuildFailedException("Could not exclude generated test resource: " + path);
            }
        }

        public string[] OnFilterAssemblies(BuildOptions options, string[] assemblies)
        {
            if ((options & BuildOptions.IncludeTestAssemblies) != 0) return assemblies;
            var excluded = ZKubeBuild.Identity.name == "store"
                ? new[] { "ZKube.Chain", "ZKube.Money", "Chaos.NaCl" }
                : new[] { "ZKube.Store" };
            var included = assemblies.Where(path => excluded.Contains(Path.GetFileNameWithoutExtension(path))).ToArray();
            if (included.Length != 0)
                throw new BuildFailedException("Player includes another identity's assemblies: " + string.Join(", ", included));
            var forbidden = assemblies.Where(path =>
            {
                var name = Path.GetFileNameWithoutExtension(path);
                return name.StartsWith("ZKube.", StringComparison.Ordinal) &&
                    (name.EndsWith(".Tests", StringComparison.Ordinal) ||
                     name.EndsWith(".PlayTests", StringComparison.Ordinal));
            }).ToArray();
            if (forbidden.Length != 0)
                throw new BuildFailedException("Player includes test assemblies: " + string.Join(", ", forbidden));
            return ZKubeStoreBillingBuild.FilterAssemblies(assemblies);
        }
    }
}
