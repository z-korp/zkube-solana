using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    public sealed class AudioPreferencesTests
    {
        private static JObject Fixture => JObject.Parse(File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath,
            "../../fixtures/unity-audio-v1.json"
        ))));
        public static IEnumerable Cases() { foreach (var item in Fixture["cases"]) yield return new TestCaseData((string)item["name"]); }
        private static void Levels(AudioPreferences actual, JToken expected)
        {
            Assert.That(actual.MusicVolume, Is.EqualTo((double)expected["musicVolume"]));
            Assert.That(actual.EffectsVolume, Is.EqualTo((double)expected["effectsVolume"]));
        }
        private static void Write((string Key, string Value) actual, JToken expected)
        {
            Assert.That(actual.Key, Is.EqualTo((string)expected["key"]));
            var parsed = JObject.Parse(actual.Value);
            CollectionAssert.AreEquivalent(new[] { "musicVolume", "effectsVolume" }, parsed.Properties().Select(property => property.Name));
            Assert.That((double)parsed["musicVolume"], Is.EqualTo((double)expected["value"]["musicVolume"]));
            Assert.That((double)parsed["effectsVolume"], Is.EqualTo((double)expected["value"]["effectsVolume"]));
        }
        [TestCaseSource(nameof(Cases))]
        public void ActualTypeScriptAudioManagerAgreesOnReadAndIndependentWrites(string name)
        {
            var fixture = Fixture["cases"].Single(item => (string)item["name"] == name);
            var writes = new List<(string, string)>();
            var audio = new AudioPreferences(key => {
                Assert.That(key, Is.EqualTo((string)Fixture["policy"]["storageKey"]));
                if ((bool?)fixture["failRead"] == true) throw new IOException("read failed");
                return (string)fixture["raw"];
            }, (key, value) => writes.Add((key, value)));
            Levels(audio, fixture["initial"]);
            foreach (var command in fixture["commands"])
                if ((string)command["channel"] == "music") audio.SetMusicVolume((double)command["value"]);
                else audio.SetEffectsVolume((double)command["value"]);
            Levels(audio, fixture["final"]); Assert.That(writes.Count, Is.EqualTo(fixture["writes"].Count()));
            for (int i = 0; i < writes.Count; i++) Write(writes[i], fixture["writes"][i]);
        }
        [Test]
        public void ActualSetterClampAndWriteFailureRetainAppliedLevels()
        {
            var writes = new List<(string, string)>(); bool failWrite = false;
            var audio = new AudioPreferences(null, (key, value) => { writes.Add((key, value)); if (failWrite) throw new IOException("write failed"); });
            foreach (var change in Fixture["changes"])
            {
                failWrite = (bool?)change["failWrite"] == true;
                string input = (string)change["input"];
                double number = input == "NaN" ? double.NaN : input == "Infinity" ? double.PositiveInfinity : input == "-Infinity" ? double.NegativeInfinity : double.Parse(input, CultureInfo.InvariantCulture);
                bool failed = false;
                try { if ((string)change["channel"] == "music") audio.SetMusicVolume(number); else audio.SetEffectsVolume(number); }
                catch (IOException) { failed = true; }
                Assert.That(failed, Is.EqualTo((bool)change["failed"]));
                Levels(audio, change["expected"]); Write(writes.Last(), change["write"]);
            }
        }
        [Test]
        public void GeneratedPolicyIsTheActualTypeScriptPublication()
        {
            var policy = Fixture["policy"];
            Assert.That(AudioPolicy.StorageKey, Is.EqualTo((string)policy["storageKey"]));
            Assert.That(AudioPolicy.DefaultMusicVolume, Is.EqualTo((double)policy["musicVolume"]));
            Assert.That(AudioPolicy.DefaultEffectsVolume, Is.EqualTo((double)policy["effectsVolume"]));
            Assert.That(AudioPolicy.ToggleOnLevel, Is.EqualTo((double)policy["toggleOnLevel"]));
        }
    }
}
