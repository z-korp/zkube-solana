using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.PackageManager;
using UnityEngine;

namespace ZKube.Editor
{
    // Proposed root-owned build integration. Plugin callbacks avoid editing the
    // resolved package cache. Reapply after every Editor domain reload through
    // ZKubeBuild.Configure; actual money APK absence is still a required gate.
    internal static class ZKubeStoreBillingBuild
    {
        private const string PackagePath = "Packages/com.unity.purchasing/";
        [Serializable] private sealed class AssemblyDefinition { public string name; }
        internal static void ConfigurePlugins()
        {
            // IAP 5.2.1's AndroidDependencies callback reads this per-package
            // SessionState switch before injecting Google Billing into Gradle.
            // Reapply for every identity; managed exclusion alone is insufficient.
            SessionState.SetBool("SelfDeclaredAndroidDependenciesDisabled:com.unity.purchasing", ZKubeBuild.Identity.name != "store");
            foreach (var path in AssetDatabase.GetAllAssetPaths().Where(path => path.StartsWith(PackagePath, StringComparison.Ordinal)))
                if (AssetImporter.GetAtPath(path) is PluginImporter plugin)
                    plugin.SetIncludeInBuildDelegate(delegate { return ZKubeBuild.Identity.name == "store"; });
        }
        internal static string[] FilterAssemblies(string[] assemblies)
        {
            if (ZKubeBuild.Identity.name == "store") return assemblies;
            var package = UnityEditor.PackageManager.PackageInfo.FindForAssetPath(PackagePath + "package.json");
            if (package == null) return assemblies;
            var excluded = new HashSet<string>(StringComparer.Ordinal);
            foreach (var path in Directory.EnumerateFiles(package.resolvedPath, "*.asmdef", SearchOption.AllDirectories))
            {
                var definition = JsonUtility.FromJson<AssemblyDefinition>(File.ReadAllText(path));
                if (string.IsNullOrEmpty(definition?.name)) throw new BuildFailedException("IAP package assembly has no name: " + path);
                excluded.Add(definition.name);
            }
            foreach (var path in Directory.EnumerateFiles(package.resolvedPath, "*.dll", SearchOption.AllDirectories))
                excluded.Add(Path.GetFileNameWithoutExtension(path));
            // Our store adapters are already removed by their define constraints.
            // This also excludes IAP's auto-referenced SDK/codeless assemblies.
            // Any accidental remaining money reference fails Player linking.
            return assemblies.Where(path => !excluded.Contains(Path.GetFileNameWithoutExtension(path))).ToArray();
        }
    }
}
