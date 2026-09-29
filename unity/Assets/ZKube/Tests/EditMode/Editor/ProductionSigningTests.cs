using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;

namespace ZKube.Editor.Tests
{
    public sealed class ProductionSigningTests
    {
        private const string Settings = "ProjectSettings/ProjectSettings.asset";
        private readonly Dictionary<string, string> previous = new Dictionary<string, string>();
        private readonly List<string> logged = new List<string>();
        private static string Fake(string name) => "fake-" + name.ToLowerInvariant() + "-value";
        private void Log(string message, string stack, LogType type) => logged.Add(message + "\n" + stack);

        [SetUp] public void SetUp()
        {
            foreach (var name in ZKubeBuild.SigningVariables) { previous[name] = Environment.GetEnvironmentVariable(name); Environment.SetEnvironmentVariable(name, Fake(name)); }
            Application.logMessageReceived += Log;
        }
        [TearDown] public void TearDown()
        {
            Application.logMessageReceived -= Log;
            foreach (var pair in previous) Environment.SetEnvironmentVariable(pair.Key, pair.Value);
            ZKubeBuild.ClearSigning();
        }

        [Test] public void SigningIsAppliedInMemoryForOneBuildAndNeverSavedOrEchoed()
        {
            AssetDatabase.SaveAssets();
            var before = File.ReadAllBytes(Settings);
            ZKubeBuild.ApplySigning();
            Assert.IsTrue(PlayerSettings.Android.useCustomKeystore);
            Assert.AreEqual(Fake("ZKUBE_ANDROID_KEYSTORE"), PlayerSettings.Android.keystoreName);
            Assert.AreEqual(Fake("ZKUBE_ANDROID_KEY_ALIAS"), PlayerSettings.Android.keyaliasName);
            Assert.AreEqual(Fake("ZKUBE_ANDROID_KEY_PASS"), PlayerSettings.Android.keyaliasPass);
            ZKubeBuild.ClearSigning();
            AssetDatabase.SaveAssets();
            CollectionAssert.AreEqual(before, File.ReadAllBytes(Settings), "ProjectSettings is byte-identical");
            Assert.IsFalse(PlayerSettings.Android.useCustomKeystore);
            Assert.AreEqual("", PlayerSettings.Android.keystorePass + PlayerSettings.Android.keyaliasPass + PlayerSettings.Android.keystoreName);
            foreach (var name in ZKubeBuild.SigningVariables)
                Assert.IsFalse(logged.Any(entry => entry.Contains(Fake(name))), name + " was logged");
        }

        [Test] public void AMissingVariableIsNamedWithoutAnyValue()
        {
            foreach (var missing in ZKubeBuild.SigningVariables)
            {
                Environment.SetEnvironmentVariable(missing, null);
                var error = Assert.Throws<InvalidOperationException>(ZKubeBuild.ApplySigning);
                Assert.AreEqual("Production signing requires " + missing, error.Message);
                Assert.IsFalse(PlayerSettings.Android.useCustomKeystore, "Nothing is applied");
                Environment.SetEnvironmentVariable(missing, Fake(missing));
            }
        }
    }
}
