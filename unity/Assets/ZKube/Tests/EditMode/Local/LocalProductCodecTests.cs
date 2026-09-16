using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Local.Tests
{
    public sealed class LocalProductCodecTests
    {
        private static string Root => Path.GetFullPath(Path.Combine(Application.dataPath, "../.."));
        private static JObject Fixture => JObject.Parse(File.ReadAllText(Path.Combine(Root,
            "fixtures/store-save-format-v1.json"
        )));
        public static IEnumerable Cases()
        {
            foreach (var row in Fixture["cases"].Where(row => (string)row["name"] == "default" || (string)row["name"] == "full")) yield return new TestCaseData((string)row["name"]);
        }
        [TestCaseSource(nameof(Cases))]
        public void ReadsTheV1StoreSaveFormat(string name)
        {
            var row = (JObject)Fixture["cases"].Single(item => (string)item["name"] == name);
            var state = LocalProductCodec.Decode((string)row["raw"]);
            AssertState(state, row);
            AssertState(LocalProductCodec.Decode(LocalProductCodec.Encode(state)), row);
            var utf8 = new UTF8Encoding(false, true);
            AssertState(LocalProductCodec.Decode(utf8.GetString(utf8.GetBytes(LocalProductCodec.Encode(state)))), row);
        }
        private static void AssertState(LocalProductState state, JObject row)
        {
            CollectionAssert.AreEqual(Units(row["nameUnits"]), Units(state.Name), "UTF-16 name");
            CollectionAssert.AreEqual(Units(row["priceUnits"]), Units(state.CampaignPrice), "UTF-16 price");
            var actual = JObject.Parse(LocalProductCodec.Encode(state));
            var expected = (JObject)row["expected"].DeepClone();
            // The fixture transport parser can replace a lone surrogate. Its
            // code-unit arrays above remain the independent exact string oracle.
            actual.Remove("name"); expected.Remove("name"); actual.Remove("campaignPrice"); expected.Remove("campaignPrice");
            Assert.That(JToken.DeepEquals(expected, actual), Is.True, "expected " + expected + " actual " + actual);
        }
        [Test]
        public void WritesNormalizeThroughTheSameVersionedKey()
        {
            string savedKey = null, saved = null;
            var store = new LocalProductStore(key => null, (key, value) => { savedKey = key; saved = value; });
            store.Write(current => { current.Name = "  Mira  "; current.Stars = new byte[] { 9, 2 }; current.WornEmblem = 99; current.CampaignPrice = "  €0.99  "; return current; });
            var expected = Fixture["writes"].Single();
            Assert.That(savedKey, Is.EqualTo((string)expected[0]));
            Assert.That(JToken.DeepEquals(JObject.Parse(saved), JObject.Parse((string)expected[1])), Is.True);
            var reloaded = new LocalProductStore(key => { Assert.That(key, Is.EqualTo(savedKey)); return saved; });
            Assert.That(reloaded.Read.Name, Is.EqualTo("Mira"));
            Assert.That(reloaded.Read.Stars.Length, Is.EqualTo(100));
        }
        [Test]
        public void StorageFailurePropagatesAfterNormalizedMemoryUpdateAsInReference()
        {
            var store = new LocalProductStore(write: (_, __) => throw new IOException("disk-full"));
            Assert.Throws<IOException>(() => store.Write(current => { current.Name = "  Kept  "; return current; }));
            Assert.That(store.Read.Name, Is.EqualTo("Kept"));
            var memory = new LocalProductStore();
            Assert.That(memory.Write(current => { current.Name = "Memory"; return current; }).Name, Is.EqualTo("Memory"));
        }
        private static int[] Units(string value) => value == null ? null : value.Select(c => (int)c).ToArray();
        private static int[] Units(JToken value) => value.Type == JTokenType.Null ? null : value.Values<int>().ToArray();
    }
}
