using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using UnityEditor.Android;
using UnityEditor.Build;
using UnityEngine;

namespace ZKube.Editor
{
    internal sealed class ZKubeAndroidProject : IPostGenerateGradleAndroidProject
    {
        [Serializable] private sealed class Dependencies { public string[] runtime; }
        public int callbackOrder => 100;

        public void OnPostGenerateGradleAndroidProject(string path)
        {
            var identity = ZKubeBuild.Identity;
            var gradlePath = Path.Combine(path, "build.gradle");
            var gradle = File.ReadAllText(gradlePath);
            const string include = "apply from: 'zkube-wallet.gradle'";
            var walletGradle = Path.Combine(path, "zkube-wallet.gradle");
            if (identity.name == "money")
            {
                var dependencies = JsonUtility.FromJson<Dependencies>(File.ReadAllText("NativeAndroid/dependencies.json"));
                if (dependencies.runtime == null || dependencies.runtime.Length == 0 ||
                    dependencies.runtime.Any(value => !Regex.IsMatch(value, @"^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$")))
                    throw new BuildFailedException("Native Android runtime dependencies must use exact Maven coordinates");
                File.WriteAllText(walletGradle, "dependencies {\n" +
                    string.Join("\n", dependencies.runtime.Select(value => "    implementation '" + value + "'")) + "\n}\n");
                if (!gradle.Contains(include)) File.AppendAllText(gradlePath, "\n" + include + "\n");
            }
            else
            {
                // A reused export must not retain the previous identity's wallet closure.
                File.WriteAllText(gradlePath, gradle.Replace(include, ""));
                if (File.Exists(walletGradle)) File.Delete(walletGradle);
            }
            File.WriteAllText(Path.GetFullPath(Path.Combine(path, "../zkube-identity.json")),
                JsonUtility.ToJson(identity, true));

            // App resolution includes Unity libraries beyond the wallet AAR.
            // Apply the reviewed variant locks on each generated module; normal
            // builds may never silently replace them with freshly resolved ones.
            foreach (var module in new[] { "launcher", "unityLibrary" })
            {
                var modulePath = Path.GetFullPath(Path.Combine(path, "..", module));
                var moduleGradle = Path.Combine(modulePath, "build.gradle");
                const string lockInclude = "apply from: 'zkube-dependencies.gradle'";
                if (identity.name == "store")
                {
                    File.WriteAllText(moduleGradle, File.ReadAllText(moduleGradle).Replace(lockInclude, ""));
                    foreach (var retired in new[] { "gradle.lockfile", "zkube-dependencies.gradle" })
                        if (File.Exists(Path.Combine(modulePath, retired))) File.Delete(Path.Combine(modulePath, retired));
                    continue;
                }
                var lockPath = Path.Combine(identity.locks, module, "gradle.lockfile");
                var exportedLock = Path.Combine(modulePath, "gradle.lockfile");
                if (!File.Exists(lockPath))
                    throw new BuildFailedException("Missing reviewed Android dependency lock: " + lockPath);
                File.Copy(lockPath, exportedLock, true);
                File.Copy("NativeAndroid/unity-dependencies.gradle",
                    Path.Combine(modulePath, "zkube-dependencies.gradle"), true);
                if (!File.ReadAllText(moduleGradle).Contains(lockInclude))
                    File.AppendAllText(moduleGradle, "\n" + lockInclude + "\n");
            }

            // The encrypted vault is bound to this installation's Android
            // Keystore. Restoring its ciphertext cannot restore authorization.
            var manifestPath = Path.GetFullPath(Path.Combine(path, "../launcher/src/main/AndroidManifest.xml"));
            var manifest = XDocument.Load(manifestPath);
            var application = manifest.Root?.Element("application");
            if (application == null) throw new BuildFailedException("Generated launcher manifest has no application");
            XNamespace android = "http://schemas.android.com/apk/res/android";
            application.SetAttributeValue(android + "allowBackup", "false");
            application.SetAttributeValue(android + "label", UnityEditor.PlayerSettings.productName);
            manifest.Save(manifestPath);

            // UnityPlayer reads this separate Java startup-overlay flag. The
            // generated template can retain True when SplashScreen.show is off;
            // bind it to that setting instead of adding another splash policy.
            var libraryManifestPath = Path.Combine(path, "src/main/AndroidManifest.xml");
            var libraryManifest = XDocument.Load(libraryManifestPath);
            var splash = libraryManifest.Root?.Element("application")?.Elements("meta-data")
                .SingleOrDefault(node => (string)node.Attribute(android + "name") == "unity.splash-enable");
            if (splash == null) throw new BuildFailedException("Generated Unity manifest has no splash setting");
            splash.SetAttributeValue(android + "value", UnityEditor.PlayerSettings.SplashScreen.show ? "true" : "false");
            libraryManifest.Save(libraryManifestPath);
        }
    }
}
