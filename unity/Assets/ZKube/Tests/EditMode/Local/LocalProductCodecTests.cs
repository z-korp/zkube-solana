using System;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;

namespace ZKube.Local.Tests
{
    public sealed class LocalProductCodecTests
    {
        [Test]
        public void LocalProductRoundTripPreservesProgressAndSavedRun()
        {
            var state = new LocalProductState {
                Name = "Mira 🚀", CampaignPrice = "€4.99", CampaignOwned = true,
                Stars = Enumerable.Range(0, 100).Select(i => (byte)(i % 4)).ToArray(),
                WornEmblem = 7, Streak = 12, LastAttemptDayId = 20705, BestDailyScore = 9000,
                DailyAttempt = new LocalDailyAttempt { DayId = 20705, Realm = 3, ObjectiveKind = 4,
                    ObjectiveValue = 2, DailyScore = 840, ObjectiveTotal = "13", Finished = true },
                CampaignRun = new LocalCampaignRun { Id = "1", CatalogVersion = ZKube.Core.Generated.Protocol.CatalogVersion, Realm = 2, Level = 5,
                    Seed = Enumerable.Range(0, 32).ToArray(), Actions = {
                        new LocalCampaignAction { Kind = "Move", Row = 2, Start = 1, Destination = 3 },
                        new LocalCampaignAction { Kind = "Reroll" } } },
                CampaignWritePending = true,
            };
            string encoded = LocalProductCodec.Encode(state);
            var utf8 = new UTF8Encoding(false, true);
            var restored = LocalProductCodec.Decode(utf8.GetString(utf8.GetBytes(encoded)));
            Assert.That(LocalProductCodec.Encode(restored), Is.EqualTo(encoded));
            CollectionAssert.AreEqual(state.Stars, restored.Stars);
            CollectionAssert.AreEqual(state.CampaignRun.Seed, restored.CampaignRun.Seed);
            Assert.That(restored.CampaignRun.Actions[0].Destination, Is.EqualTo(3));
            Assert.That(restored.DailyAttempt.ObjectiveTotal, Is.EqualTo("13"));
        }
        [TestCase(null)]
        [TestCase("{}")]
        [TestCase("{\"version\":1,\"name\":\"   \"}")]
        public void MissingOrBlankNamesUseTheDefault(string json) =>
            Assert.That(LocalProductCodec.Decode(json).Name, Is.EqualTo(LocalProductCodec.DefaultName));

        [Test]
        public void WritesNormalizeThroughTheSameVersionedKey()
        {
            string savedKey = null, saved = null;
            var store = new LocalProductStore(key => null, (key, value) => { savedKey = key; saved = value; });
            store.Write(current => { current.Name = "  Mira  "; current.Stars = new byte[] { 9, 2 }; current.WornEmblem = 99; current.CampaignPrice = "  €0.99  "; return current; });
            Assert.That(savedKey, Is.EqualTo(LocalProductCodec.StorageKey));
            var reloaded = new LocalProductStore(key => { Assert.That(key, Is.EqualTo(savedKey)); return saved; });
            Assert.That(reloaded.Read.Name, Is.EqualTo("Mira"));
            Assert.That(reloaded.Read.Stars.Length, Is.EqualTo(100));
            Assert.That(reloaded.Read.Stars.Take(3), Is.EqualTo(new byte[] { 3, 2, 0 }));
            Assert.That(reloaded.Read.WornEmblem, Is.EqualTo(10));
            Assert.That(reloaded.Read.CampaignPrice, Is.EqualTo("€0.99"));
        }
        [Test]
        public void StorageFailurePropagatesAfterNormalizedMemoryUpdate()
        {
            var store = new LocalProductStore(write: (_, __) => throw new IOException("disk-full"));
            Assert.Throws<IOException>(() => store.Write(current => { current.Name = "  Kept  "; return current; }));
            Assert.That(store.Read.Name, Is.EqualTo("Kept"));
            var memory = new LocalProductStore();
            Assert.That(memory.Write(current => { current.Name = "Memory"; return current; }).Name, Is.EqualTo("Memory"));
        }
    }
}
