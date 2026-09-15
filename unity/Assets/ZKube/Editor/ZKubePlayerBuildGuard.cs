using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;

namespace ZKube.Editor
{
    // The Assistant's transitive performance package creates these Resources
    // even for ordinary Players. Its callback runs at order 0; remove only its
    // generated test metadata before the Player asset collection starts.
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
            if (ZKubeBuild.Identity.name == "store")
            {
                var money = new[] { "ZKube.Integration", "ZKube.Client", "ZKube.Planning", "ZKube.Transport",
                    "ZKube.Execution", "ZKube.RunReconciliation", "ZKube.AndroidWallet",
                    "ZKube.SolanaPrimitives", "ZKube.MoneyPresentation", "Chaos.NaCl" };
                var included = assemblies.Where(path => money.Contains(Path.GetFileNameWithoutExtension(path))).ToArray();
                if (included.Length != 0)
                    throw new BuildFailedException("Store includes money assemblies: " + string.Join(", ", included));
            }
            var forbidden = assemblies.Where(path =>
            {
                var name = Path.GetFileNameWithoutExtension(path);
                return name.StartsWith("ZKube.", StringComparison.Ordinal) &&
                    (name.EndsWith(".Tests", StringComparison.Ordinal) ||
                     (name == "ZKube.Evidence" && (options & BuildOptions.Development) == 0));
            }).ToArray();
            if (forbidden.Length != 0)
                throw new BuildFailedException("Player includes excluded test/evidence assemblies: " + string.Join(", ", forbidden));
            return ZKubeStoreBillingBuild.FilterAssemblies(assemblies);
        }
    }
}
