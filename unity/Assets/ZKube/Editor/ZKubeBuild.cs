using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Android;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using ZKube.Core;

namespace ZKube.Editor
{
    public static class ZKubeBuild
    {
        [Serializable]
        internal sealed class Toolchain
        {
            public string editor;
            public int androidApi;
            public int androidMinimumApi;
            public AndroidIdentity[] androidIdentities;
            public AndroidAbi[] androidAbis;
        }

        [Serializable] internal sealed class AndroidIdentity
        {
            public string name, package, format, locks;
            public string[] abis;
        }
        [Serializable] internal sealed class AndroidAbi
        {
            public string name, rustTarget, linkerPrefix, unityCpu;
            public int elfMachine;
        }
        internal static AndroidIdentity Identity
        {
            get
            {
                var name = Environment.GetEnvironmentVariable("ZKUBE_UNITY_IDENTITY") ?? "money";
                var config = JsonUtility.FromJson<Toolchain>(File.ReadAllText("toolchain.json"));
                var profile = config.androidIdentities.SingleOrDefault(item => item.name == name);
                if (profile == null || (name != "money" && name != "store"))
                    throw new InvalidOperationException("Unknown Android identity");
                var store = name == "store";
                if (profile.package != (store ? "com.zkorp.zkube.store" : "com.zkorp.zkube") ||
                    profile.format != (store ? "aab" : "apk") ||
                    !profile.abis.SequenceEqual(store ? new[] { "arm64-v8a", "x86_64" } : new[] { "arm64-v8a" }) ||
                    Path.IsPathRooted(profile.locks) || profile.locks.Split('/').Contains("..") ||
                    config.androidIdentities.Select(item => item.locks).Distinct().Count() != config.androidIdentities.Length)
                    throw new InvalidOperationException("Android identity differs from its distribution contract");
                return profile;
            }
        }

        public static void Configure()
        {
            var config = JsonUtility.FromJson<Toolchain>(File.ReadAllText("toolchain.json"));
            if (Application.unityVersion != config.editor)
                throw new InvalidOperationException("Unity patch differs from toolchain.json");

            var android = Path.Combine(EditorApplication.applicationContentsPath,
                "PlaybackEngines", "AndroidPlayer");
            AndroidExternalToolsSettings.sdkRootPath = Path.Combine(android, "SDK");
            AndroidExternalToolsSettings.ndkRootPath = Path.Combine(android, "NDK");
            AndroidExternalToolsSettings.jdkRootPath = Path.Combine(android, "OpenJDK");

            PlayerSettings.companyName = "zKorp";
            PlayerSettings.productName = Environment.GetEnvironmentVariable("ZKUBE_UNITY_PRODUCT_NAME")
                ?? throw new InvalidOperationException("Build identity has no product name");
            var identity = Identity;
            var store = identity.name == "store";
            // Per-build extra defines control Player compilation. A persistent
            // define would contaminate a later money build and Editor imports.
            if (PlayerSettings.GetScriptingDefineSymbols(NamedBuildTarget.Android).Split(';').Contains("ZKUBE_STORE"))
                throw new InvalidOperationException("Remove persistent ZKUBE_STORE; the selected build identity supplies it");
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, identity.package);
            var production = Environment.GetEnvironmentVariable("ZKUBE_ANDROID_PRODUCTION") == "1";
            var versionCode = Environment.GetEnvironmentVariable("ZKUBE_ANDROID_VERSION_CODE") ?? (production ? "" : "1");
            if (!int.TryParse(versionCode, out var code) || code < 1)
                throw new InvalidOperationException("ZKUBE_ANDROID_VERSION_CODE must be a positive integer");
            PlayerSettings.Android.bundleVersionCode = code;
            PlayerSettings.bundleVersion = Environment.GetEnvironmentVariable("ZKUBE_ANDROID_VERSION_NAME") ?? "1.0";
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = store
                ? AndroidArchitecture.ARM64 | AndroidArchitecture.X86_64 : AndroidArchitecture.ARM64;
            EditorUserBuildSettings.buildAppBundle = store;
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)config.androidMinimumApi;
            PlayerSettings.Android.targetSdkVersion = (AndroidSdkVersions)config.androidApi;
            // System.Net.Http transport does not pass through UnityWebRequest,
            // so permission must not depend on Unity's networking usage scan.
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            if (production && !PlayerSettings.Android.useCustomKeystore)
                throw new InvalidOperationException("Production requires configured non-debug Android signing");
            if (!production) PlayerSettings.Android.useCustomKeystore = false;
            PlayerSettings.runInBackground = false;
            PlayerSettings.SplashScreen.show = false;
            PlayerSettings.SplashScreen.showUnityLogo = false;
            EditorSettings.serializationMode = SerializationMode.ForceText;

            const string iconPath = "Assets/ZKube/Branding/Generated/AppIcon.png";
            var iconImporter = AssetImporter.GetAtPath(iconPath) as TextureImporter;
            if (iconImporter == null) throw new InvalidOperationException("Missing generated product icon importer");
            iconImporter.textureType = TextureImporterType.Default;
            iconImporter.textureShape = TextureImporterShape.Texture2D;
            iconImporter.mipmapEnabled = false;
            iconImporter.maxTextureSize = 512;
            iconImporter.SaveAndReimport();
            var appIcon = AssetDatabase.LoadAssetAtPath<Texture2D>(iconPath);
            if (appIcon == null) throw new InvalidOperationException("Missing generated product icon");
            foreach (var kind in new[] { AndroidPlatformIconKind.Adaptive, AndroidPlatformIconKind.Round, AndroidPlatformIconKind.Legacy })
            {
                var icons = PlayerSettings.GetPlatformIcons(NamedBuildTarget.Android, kind);
                foreach (var icon in icons)
                {
                    var layers = new Texture2D[icon.maxLayerCount];
                    layers[0] = appIcon;
                    if (layers.Length > 1) layers[1] = appIcon;
                    icon.SetTextures(layers);
                }
                PlayerSettings.SetPlatformIcons(NamedBuildTarget.Android, kind, icons);
            }

            ConfigurePlugin("Assets/Plugins/x86_64/libzkube_core_ffi.so", null, true);
            foreach (var abi in config.androidAbis)
            {
                var path = "Assets/Plugins/Android/" + abi.name + "/libzkube_core_ffi.so";
                var enabled = identity.abis.Contains(abi.name);
                if (enabled || File.Exists(path)) ConfigurePlugin(path, abi.unityCpu, enabled);
            }
            const string cryptoPath = "Assets/ThirdParty/Solana/Chaos.NaCl.dll";
            var crypto = AssetImporter.GetAtPath(cryptoPath) as PluginImporter;
            if (crypto == null) throw new InvalidOperationException("Missing pinned managed crypto plugin");
            crypto.SetCompatibleWithAnyPlatform(false);
            crypto.SetCompatibleWithEditor(true);
            crypto.SetCompatibleWithPlatform(BuildTarget.StandaloneLinux64, true);
            crypto.SetCompatibleWithPlatform(BuildTarget.Android, !store);
            crypto.DefineConstraints = new[] { "!ZKUBE_STORE" };
            crypto.SaveAndReimport();
            const string walletPath = "Assets/Plugins/Android/zkube-unity-wallet-release.aar";
            if (File.Exists(walletPath))
            {
                var wallet = AssetImporter.GetAtPath(walletPath) as PluginImporter;
                if (wallet == null) throw new InvalidOperationException("Native wallet plugin did not import");
                wallet.SetCompatibleWithAnyPlatform(false);
                wallet.SetCompatibleWithEditor(false);
                wallet.SetCompatibleWithPlatform(BuildTarget.Android, !store);
                wallet.SaveAndReimport();
            }
            ZKubeStoreBillingBuild.ConfigurePlugins();
            AssetDatabase.SaveAssets();
        }

        private static void ConfigurePlugin(string path, string androidCpu, bool enabled)
        {
            var plugin = AssetImporter.GetAtPath(path) as PluginImporter;
            if (plugin == null) throw new InvalidOperationException("Missing native plugin: " + path);
            plugin.SetCompatibleWithAnyPlatform(false);
            var android = androidCpu != null;
            plugin.SetCompatibleWithEditor(!android && enabled);
            plugin.SetCompatibleWithPlatform(BuildTarget.Android, android && enabled);
            plugin.SetCompatibleWithPlatform(BuildTarget.StandaloneLinux64, !android && enabled);
            if (android) plugin.SetPlatformData(BuildTarget.Android, "CPU", androidCpu);
            else
            {
                plugin.SetEditorData("OS", "Linux");
                plugin.SetEditorData("CPU", "x86_64");
                plugin.SetPlatformData(BuildTarget.StandaloneLinux64, "CPU", "x86_64");
            }
            plugin.SaveAndReimport();
        }

        public static void Probe()
        {
            Configure();
            if (NativeEngine.AbiVersion() != ZKube.Core.Generated.NativeSchema.AbiVersion)
                throw new InvalidOperationException("Native boundary probe failed");
            Debug.Log($"ZKUBE_NATIVE_PROBE abi={NativeEngine.AbiVersion()}");
        }

        public static void Prepare()
        {
            try
            {
                Probe();
                EditorSettings.spritePackerMode = SpritePackerMode.SpriteAtlasV2;
                const string settings = "Assets/TextMesh Pro/Resources/TMP Settings.asset";
                if (!File.Exists(settings))
                {
                    var package = UnityEditor.PackageManager.PackageInfo.FindForAssetPath("Packages/com.unity.ugui");
                    if (package == null) throw new InvalidOperationException("Pinned uGUI package is unavailable");
                    // ImportPackage completes on a later Editor update. The CLI
                    // omits -quit and exits only after the import callback.
                    AssetDatabase.importPackageCompleted += EssentialResourcesImported;
                    AssetDatabase.importPackageFailed += EssentialResourcesFailed;
                    AssetDatabase.importPackageCancelled += EssentialResourcesCancelled;
                    AssetDatabase.ImportPackage(Path.Combine(package.resolvedPath,
                        "Package Resources", "TMP Essential Resources.unitypackage"), false);
                    return;
                }
                FinishPreparation();
            }
            catch (Exception error) { PreparationFailed(error); }
        }

        private static void ClearImportHandlers()
        {
            AssetDatabase.importPackageCompleted -= EssentialResourcesImported;
            AssetDatabase.importPackageFailed -= EssentialResourcesFailed;
            AssetDatabase.importPackageCancelled -= EssentialResourcesCancelled;
        }

        private static void EssentialResourcesImported(string package)
        {
            ClearImportHandlers();
            FinishPreparation();
        }

        private static void EssentialResourcesFailed(string package, string error)
            => PreparationFailed(new InvalidOperationException(package + ": " + error));

        private static void EssentialResourcesCancelled(string package)
            => PreparationFailed(new InvalidOperationException(package + " import was cancelled"));

        private static void PreparationFailed(Exception error)
        {
            ClearImportHandlers();
            Debug.LogException(error);
            EditorApplication.Exit(1);
        }

        private static void FinishPreparation()
        {
            try
            {
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                AssetDatabase.LoadAssetAtPath<Shader>("Assets/TextMesh Pro/Shaders/TMP_SDF-Mobile.shader");
                ZKubeAssetImports.Prepare();
                if (!File.Exists(ZKubeStoreScene.Path)) ZKubeStoreScene.Create();
                if (!File.Exists(ZKubeMoneyScene.Path)) ZKubeMoneyScene.Create();
                EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ZKubeMoneyScene.Path, true) };
                AssetDatabase.SaveAssets();
                ZKubeBatchCommand.Complete();
                EditorApplication.Exit(0);
            }
            catch (Exception error) { PreparationFailed(error); }
        }

        public static void BuildAndroid()
        {
            Probe();
            const string walletPath = "Assets/Plugins/Android/zkube-unity-wallet-release.aar";
            if (Identity.name == "money" && !File.Exists(walletPath)) throw new InvalidOperationException("Missing verified native wallet plugin");
            var output = Environment.GetEnvironmentVariable("ZKUBE_UNITY_APK");
            if (string.IsNullOrEmpty(output)) throw new InvalidOperationException("ZKUBE_UNITY_APK is required");
            string scenePath = Identity.name == "store" ? ZKubeStoreScene.Path : ZKubeMoneyScene.Path;
            if (!File.Exists(scenePath)) throw new InvalidOperationException("Prepare the selected application scene before building");
            var previousExport = EditorUserBuildSettings.exportAsGoogleAndroidProject;
            EditorUserBuildSettings.exportAsGoogleAndroidProject = false;
            BuildReport report;
            try { report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { scenePath },
                locationPathName = output,
                target = BuildTarget.Android,
                options = BuildOptions.None,
                extraScriptingDefines = Identity.name == "store" ? new[] { "ZKUBE_STORE" } : Array.Empty<string>()
            }); }
            finally { EditorUserBuildSettings.exportAsGoogleAndroidProject = previousExport; }
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Android build failed: " + report.summary.result);
            Debug.Log("ZKUBE_ANDROID_BUILD " + output);
        }
    }
}
