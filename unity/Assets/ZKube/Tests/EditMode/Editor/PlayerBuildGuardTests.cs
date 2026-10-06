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

        // The art is authored and approved as composites blended in sRGB, so the
        // game blends in gamma space too: in linear space every translucent layer
        // (glows, halos, underpaints, scrim, the 3% cell dimple) draws stronger.
        [Test]
        public void ThePlayerBlendsInGammaSpaceAsTheArtIsApproved()
        {
            Assert.AreEqual(ColorSpace.Gamma, PlayerSettings.colorSpace);
            Assert.AreEqual(ColorSpace.Gamma, QualitySettings.activeColorSpace);
        }

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

        [Serializable] private sealed class ToolchainNetworks { public NamedNetwork[] androidIdentities; }
        [Serializable] private sealed class NamedNetwork { public string name; public NetworkValues network; }
        [Serializable] private sealed class NetworkValues { public string baseUri, secondBaseUri, routerUri, expectedGenesis, standingsUri; }

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
                    // The cluster is the identity's own, copied from toolchain.json, in every
                    // scene the money identity gets, including the one a test restores.
                    var network = JsonUtility.FromJson<ToolchainNetworks>(System.IO.File.ReadAllText("toolchain.json"))
                        .androidIdentities.Single(item => item.name == "money").network;
                    foreach (var (field, expected) in new[] { ("BaseUri", network.baseUri), ("SecondBaseUri", network.secondBaseUri), ("RouterUri", network.routerUri),
                        ("ExpectedGenesis", network.expectedGenesis), ("StandingsUri", network.standingsUri) })
                    {
                        Assert.That(config.FindPropertyRelative(field).stringValue, Is.Not.Empty, field);
                        Assert.That(config.FindPropertyRelative(field).stringValue, Is.EqualTo(expected), field);
                    }
                }
            }
            finally { ZKubeAppScene.Create(previousIdentity ?? "money"); }
        }
    }
}
