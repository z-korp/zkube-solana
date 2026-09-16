using System;
using NUnit.Framework;
using UnityEditor;
using UnityEditor.Build;

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
    }
}
