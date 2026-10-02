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
        public const string LaunchTheme = "ZKubeLaunchTheme";
        public const string LaunchWindowClass = "com.zkorp.zkube.launch.LaunchWindow";
        public const string PlayGamesAppId = "com.google.android.gms.games.APP_ID";

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
                gradle = gradle.Replace(include, "");
                File.WriteAllText(gradlePath, gradle);
                if (File.Exists(walletGradle)) File.Delete(walletGradle);
            }
            // The identity's own dependencies (the store's Play Games), as exact coordinates.
            const string identityInclude = "apply from: 'zkube-identity.gradle'";
            var identityGradle = Path.Combine(path, "zkube-identity.gradle");
            var own = identity.dependencies ?? Array.Empty<string>();
            if (own.Any(value => !Regex.IsMatch(value, @"^[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$")))
                throw new BuildFailedException("Identity dependencies must use exact Maven coordinates");
            if (own.Length != 0)
            {
                File.WriteAllText(identityGradle, "dependencies {\n" + string.Join("\n", own.Select(value => "    implementation '" + value + "'")) + "\n}\n");
                if (!gradle.Contains(identityInclude)) File.AppendAllText(gradlePath, "\n" + identityInclude + "\n");
            }
            else
            {
                File.WriteAllText(gradlePath, File.ReadAllText(gradlePath).Replace(identityInclude, ""));
                if (File.Exists(identityGradle)) File.Delete(identityGradle);
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
                var lockPath = Path.Combine(identity.locks, module, "gradle.lockfile");
                var exportedLock = Path.Combine(modulePath, "gradle.lockfile");
                // Only the export that writes an identity's first locks may run without them.
                if (File.Exists(lockPath)) File.Copy(lockPath, exportedLock, true);
                else if (Environment.GetEnvironmentVariable("ZKUBE_EXPORT_LOCKS") != "1")
                    throw new BuildFailedException("Missing reviewed Android dependency lock: " + lockPath);
                else if (File.Exists(exportedLock)) File.Delete(exportedLock);
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
            // Play Games reads its project from the manifest. Until the owner has
            // one the app carries none, and the bridge reports no account.
            var meta = application.Elements("meta-data").Where(node => (string)node.Attribute(android + "name") == PlayGamesAppId).ToArray();
            foreach (var node in meta) node.Remove();
            var strings = Path.GetFullPath(Path.Combine(path, "../launcher/src/main/res/values/zkube_play_games.xml"));
            if (File.Exists(strings)) File.Delete(strings);
            if (!string.IsNullOrEmpty(identity.playGamesAppId))
            {
                if (!Regex.IsMatch(identity.playGamesAppId, "^[0-9]{6,20}$")) throw new BuildFailedException("The Play Games app ID is its project's number");
                var appId = new XElement("meta-data");
                appId.SetAttributeValue(android + "name", PlayGamesAppId);
                appId.SetAttributeValue(android + "value", "@string/zkube_play_games_app_id");
                application.Add(appId);
                Directory.CreateDirectory(Path.GetDirectoryName(strings));
                File.WriteAllText(strings, "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n" +
                    "  <string name=\"zkube_play_games_app_id\" translatable=\"false\">" + identity.playGamesAppId + "</string>\n</resources>\n");
            }
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

            // The launch window shows the product's staged splash until the
            // first frame instead of a black window: drawn at 3 px per dp and
            // centred, exactly as the launch screen draws it.
            var activity = libraryManifest.Root.Element("application")?.Elements("activity")
                .SingleOrDefault(node => (string)node.Attribute(android + "name") == "com.unity3d.player.UnityPlayerGameActivity")
                ?? throw new BuildFailedException("Generated Unity manifest has no game activity");
            activity.SetAttributeValue(android + "theme", "@style/" + LaunchTheme);
            // The launch window keeps the splash over Unity's surface until
            // startup releases it after the first frame (LaunchWindow.java).
            var launchProvider = libraryManifest.Root.Element("application").Elements("provider")
                .SingleOrDefault(node => (string)node.Attribute(android + "name") == LaunchWindowClass);
            if (launchProvider == null)
            {
                launchProvider = new XElement("provider");
                libraryManifest.Root.Element("application").Add(launchProvider);
            }
            launchProvider.SetAttributeValue(android + "name", LaunchWindowClass);
            launchProvider.SetAttributeValue(android + "authorities", "${applicationId}.zkubelaunch");
            launchProvider.SetAttributeValue(android + "exported", "false");
            libraryManifest.Save(libraryManifestPath);
            var resources = Path.Combine(path, "src/main/res");
            Directory.CreateDirectory(Path.Combine(resources, "drawable-xxhdpi"));
            File.Copy(ZKubeBuild.Brand + "Resources/ZKube/Splash.jpg", Path.Combine(resources, "drawable-xxhdpi/zkube_splash.jpg"), true);
            Directory.CreateDirectory(Path.Combine(resources, "drawable"));
            File.WriteAllText(Path.Combine(resources, "drawable/zkube_launch.xml"),
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<layer-list xmlns:android=\"http://schemas.android.com/apk/res/android\">\n" +
                "  <item android:drawable=\"@android:color/black\"/>\n" +
                "  <item><bitmap android:gravity=\"center\" android:src=\"@drawable/zkube_splash\"/></item>\n</layer-list>\n");
            File.WriteAllText(Path.Combine(resources, "values/zkube_launch.xml"),
                "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n  <style name=\"" + LaunchTheme + "\" parent=\"BaseUnityGameActivityTheme\">\n" +
                "    <item name=\"android:windowBackground\">@drawable/zkube_launch</item>\n  </style>\n</resources>\n");
        }
    }
}
