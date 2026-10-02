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
            public string name, package, format, locks, productName;
            public string[] abis, excludedAssemblies;
            // The identity's own Maven dependencies (the store's Play Games), as
            // exact coordinates, and its Play Games project once the owner has one.
            public string[] dependencies;
            public string playGamesAppId;
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
            PlayerSettings.productName = Identity.productName;
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
            PlayerSettings.Android.targetArchitectures = identity.abis
                .Select(name => config.androidAbis.Single(abi => abi.name == name).unityCpu)
                .Select(cpu => (AndroidArchitecture)Enum.Parse(typeof(AndroidArchitecture), cpu, true))
                .Aggregate((left, right) => left | right);
            EditorUserBuildSettings.buildAppBundle = identity.format == "aab";
            PlayerSettings.Android.minSdkVersion = (AndroidSdkVersions)config.androidMinimumApi;
            PlayerSettings.Android.targetSdkVersion = (AndroidSdkVersions)config.androidApi;
            // System.Net.Http transport does not pass through UnityWebRequest,
            // so permission must not depend on Unity's networking usage scan.
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            // Signing is applied only around the Player build; settings never hold it.
            ClearSigning();
            if (production) MissingSigning();
            PlayerSettings.runInBackground = false;
            PlayerSettings.SplashScreen.show = false;
            PlayerSettings.SplashScreen.showUnityLogo = false;
            EditorSettings.serializationMode = SerializationMode.ForceText;

            // The selected product's own launcher icon, staged by build.py:
            // adaptive background and foreground layers, and the legacy icon
            // for the round and legacy slots.
            ImportBrand();
            Texture2D Icon(string name) => AssetDatabase.LoadAssetAtPath<Texture2D>(Brand + name)
                ?? throw new InvalidOperationException("Missing staged product icon " + name);
            foreach (var kind in new[] { AndroidPlatformIconKind.Adaptive, AndroidPlatformIconKind.Round, AndroidPlatformIconKind.Legacy })
            {
                var icons = PlayerSettings.GetPlatformIcons(NamedBuildTarget.Android, kind);
                foreach (var icon in icons)
                    icon.SetTextures(kind == AndroidPlatformIconKind.Adaptive
                        ? new[] { Icon("IconBackground.png"), Icon("IconForeground.png") }
                        : new[] { Icon("Icon.png") });
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

        // The owner supplies release signing for one production build through
        // these variables. It is applied to PlayerSettings in memory around the
        // Player build and cleared after it, so ProjectSettings never holds it;
        // no value is logged or echoed, and a missing one is named, not shown.
        public static readonly string[] SigningVariables =
            { "ZKUBE_ANDROID_KEYSTORE", "ZKUBE_ANDROID_KEYSTORE_PASS", "ZKUBE_ANDROID_KEY_ALIAS", "ZKUBE_ANDROID_KEY_PASS" };
        public static void MissingSigning()
        {
            var missing = SigningVariables.Where(name => string.IsNullOrEmpty(Environment.GetEnvironmentVariable(name))).ToArray();
            if (missing.Length > 0) throw new InvalidOperationException("Production signing requires " + string.Join(", ", missing));
        }
        public static void ApplySigning()
        {
            MissingSigning();
            string Value(int index) => Environment.GetEnvironmentVariable(SigningVariables[index]);
            PlayerSettings.Android.useCustomKeystore = true;
            PlayerSettings.Android.keystoreName = Value(0); PlayerSettings.Android.keystorePass = Value(1);
            PlayerSettings.Android.keyaliasName = Value(2); PlayerSettings.Android.keyaliasPass = Value(3);
        }
        public static void ClearSigning()
        {
            PlayerSettings.Android.keystorePass = PlayerSettings.Android.keyaliasPass = "";
            PlayerSettings.Android.keystoreName = PlayerSettings.Android.keyaliasName = "";
            PlayerSettings.Android.useCustomKeystore = false;
        }

        public const string Brand = "Assets/ZKube/Branding/Generated/";
        // Icons import uncompressed at their own size; the splash scene and the
        // lockup drawn over it are sprites the launch screen loads from Resources
        // before any realm art.
        private static void ImportBrand()
        {
            foreach (var name in new[] { "IconBackground.png", "IconForeground.png", "Icon.png", "Resources/ZKube/Splash.jpg", "Resources/ZKube/Wordmark.png" })
            {
                AssetDatabase.ImportAsset(Brand + name, ImportAssetOptions.ForceSynchronousImport);
                var importer = AssetImporter.GetAtPath(Brand + name) as TextureImporter
                    ?? throw new InvalidOperationException("Missing staged brand file " + name);
                bool splash = name.EndsWith(".jpg"), sprite = name.StartsWith("Resources/");
                importer.textureType = sprite ? TextureImporterType.Sprite : TextureImporterType.Default;
                importer.textureShape = TextureImporterShape.Texture2D;
                importer.spriteImportMode = sprite ? SpriteImportMode.Single : SpriteImportMode.None;
                importer.mipmapEnabled = false; importer.alphaIsTransparency = !splash;
                importer.maxTextureSize = splash ? 4096 : sprite ? 1024 : 512;
                importer.textureCompression = splash ? TextureImporterCompression.Compressed : TextureImporterCompression.Uncompressed;
                importer.SaveAndReimport();
            }
        }

        private static void FinishPreparation()
        {
            try
            {
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                AssetDatabase.LoadAssetAtPath<Shader>("Assets/TextMesh Pro/Shaders/TMP_SDF-Mobile.shader");
                ZKubeAssetImports.Prepare();
                ZKubeAppScene.Create(Identity.name);
                EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ZKubeAppScene.Path, true) };
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
            string scenePath = ZKubeAppScene.Path;
            if (!File.Exists(scenePath)) throw new InvalidOperationException("Prepare the selected application scene before building");
            var previousExport = EditorUserBuildSettings.exportAsGoogleAndroidProject;
            EditorUserBuildSettings.exportAsGoogleAndroidProject =
                Environment.GetEnvironmentVariable("ZKUBE_EXPORT_LOCKS") == "1";
            BuildReport report;
            try
            {
                if (Environment.GetEnvironmentVariable("ZKUBE_ANDROID_PRODUCTION") == "1") ApplySigning();
                report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { scenePath },
                locationPathName = output,
                target = BuildTarget.Android,
                options = BuildOptions.None,
                extraScriptingDefines = Identity.name == "store" ? new[] { "ZKUBE_STORE" } : Array.Empty<string>()
            });
            }
            finally { ClearSigning(); EditorUserBuildSettings.exportAsGoogleAndroidProject = previousExport; }
            if (report.summary.result != BuildResult.Succeeded)
                throw new InvalidOperationException("Android build failed: " + report.summary.result);
            Debug.Log("ZKUBE_ANDROID_BUILD " + output);
        }
    }
}
