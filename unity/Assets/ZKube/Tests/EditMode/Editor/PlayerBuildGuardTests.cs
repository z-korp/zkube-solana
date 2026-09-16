using System;
using System.Linq;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;
using UnityEngine;
using UnityEngine.SceneManagement;
using ZKube.Presentation;

namespace ZKube.Editor.Tests
{
    public sealed class PlayerBuildGuardTests
    {
        private string previousIdentity;
        private IFilterBuildAssemblies guard;

        [SetUp]
        public void SetUp()
        {
            previousIdentity = Environment.GetEnvironmentVariable("ZKUBE_UNITY_IDENTITY");
            guard = (IFilterBuildAssemblies)Activator.CreateInstance(
                typeof(ZKubeBuild).Assembly.GetType("ZKube.Editor.ZKubePlayerBuildGuard", true));
        }

        [TearDown]
        public void TearDown() => Environment.SetEnvironmentVariable("ZKUBE_UNITY_IDENTITY", previousIdentity);

        [TestCase("store", "ZKube.Chain")]
        [TestCase("store", "ZKube.Money")]
        [TestCase("store", "Chaos.NaCl")]
        [TestCase("money", "ZKube.Store")]
        public void PlayerBuildRejectsOtherIdentityAssemblies(string identity, string assembly)
        {
            Environment.SetEnvironmentVariable("ZKUBE_UNITY_IDENTITY", identity);
            Assert.Throws<BuildFailedException>(() => guard.OnFilterAssemblies(
                BuildOptions.None, new[] { "Library/ScriptAssemblies/" + assembly + ".dll" }));
        }

        [TestCase("ZKube.Core.Tests")]
        [TestCase("ZKube.Store.PlayTests")]
        [TestCase("ZKube.Money.PlayTests")]
        public void PlayerBuildRejectsTestAssemblies(string assembly)
        {
            Environment.SetEnvironmentVariable("ZKUBE_UNITY_IDENTITY", "store");
            Assert.Throws<BuildFailedException>(() => guard.OnFilterAssemblies(
                BuildOptions.Development, new[] { assembly + ".dll" }));
        }

        [TestCase("store")]
        [TestCase("money")]
        public void PlayerBuildRetainsSharedAssemblies(string identity)
        {
            Environment.SetEnvironmentVariable("ZKUBE_UNITY_IDENTITY", identity);
            var assemblies = new[] { "ZKube.Core.dll", "ZKube.Presentation.dll", "ZKube.Local.dll" };
            CollectionAssert.AreEqual(assemblies, guard.OnFilterAssemblies(BuildOptions.None, assemblies));
        }

        [TestCase("store", "ZKube.Store")]
        [TestCase("money", "ZKube.Money")]
        public void SelectedSceneHasOneSharedStartupAndOnlyItsIdentityConfiguration(string identity, string assembly)
        {
            try
            {
                ZKubeAppScene.Create(identity);
                var scene = SceneManager.GetActiveScene();
                Assert.That(scene.path, Is.EqualTo(ZKubeAppScene.Path));
                var root = scene.GetRootGameObjects().Single();
                var startup = root.GetComponent<AppStartup>();
                Assert.That(root.GetComponents<MonoBehaviour>().Length, Is.EqualTo(2));
                Assert.That(startup.Configuration.Identity.GetType().Assembly.GetName().Name, Is.EqualTo(assembly));
                var shared = new SerializedObject(startup).FindProperty("Configuration");
                Assert.That(shared.FindPropertyRelative("DisplayFont").objectReferenceValue, Is.Not.Null);
                Assert.That(shared.FindPropertyRelative("BodyFont").objectReferenceValue, Is.Not.Null);
                if (identity == "money")
                {
                    var config = new SerializedObject(startup.Configuration.Identity).FindProperty("Configuration");
                    Assert.That(config.FindPropertyRelative("SolanaSchema").objectReferenceValue, Is.Not.Null);
                    Assert.That(config.FindPropertyRelative("SessionSchema").objectReferenceValue, Is.Not.Null);
                }
            }
            finally { ZKubeAppScene.Create(previousIdentity ?? "money"); }
        }
    }
}
