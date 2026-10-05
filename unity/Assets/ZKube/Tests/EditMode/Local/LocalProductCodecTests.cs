using System;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json.Linq;
using NUnit.Framework;

namespace ZKube.Local.Tests
{
    public sealed class LocalProductCodecTests
    {
        [Test]
        public void LocalProductRoundTripPreservesProgressAndSavedRun()
        {
            var state = new LocalProductState {
                CampaignPrice = "€4.99 🚀", CampaignOwned = true,
                Stars = Enumerable.Range(0, 100).Select(i => (byte)(i % 4)).ToArray(),
                WornEmblem = 7, Streak = 12, BestDailyScore = 9000,
                DailyAttempt = new LocalDailyAttempt { DayId = 20705, DailyScore = 840, ObjectiveTotal = 13, Tier = 4, Finished = true },
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
            Assert.That(restored.DailyAttempt.Tier, Is.EqualTo(4), "The run's final tier is kept for its multiplier");
            CollectionAssert.AreEqual(state.Stars, restored.Stars);
            CollectionAssert.AreEqual(state.CampaignRun.Seed, restored.CampaignRun.Seed);
            Assert.That(restored.CampaignRun.Actions[0].Destination, Is.EqualTo(3));
            Assert.That(restored.DailyAttempt.ObjectiveTotal, Is.EqualTo(13));
        }
        // An attempt not finished keeps its accepted log, the only thing its
        // replay needs beside its day; a finished one keeps its result and no log.
        [Test] public void AnUnfinishedDailyAttemptKeepsItsAcceptedLogAndAFinishedOneKeepsNone()
        {
            var open = new LocalProductState { DailyAttempt = new LocalDailyAttempt { DayId = 20705, Actions = {
                new LocalCampaignAction { Kind = "Move", Row = 2, Start = 1, Destination = 3 }, new LocalCampaignAction { Kind = "Reroll" } } } };
            string encoded = LocalProductCodec.Encode(open);
            var restored = LocalProductCodec.Decode(encoded);
            Assert.That(LocalProductCodec.Encode(restored), Is.EqualTo(encoded));
            Assert.That(restored.DailyAttempt.Actions.Select(action => action.Kind), Is.EqualTo(new[] { "Move", "Reroll" }));
            Assert.That(restored.DailyAttempt.Actions[0].Destination, Is.EqualTo(3));
            open.DailyAttempt.Finished = true;
            Assert.That(JObject.Parse(LocalProductCodec.Encode(open))["dailyAttempt"]["actions"], Is.Null);
            // A save written before the log existed still reads, with nothing to replay.
            Assert.That(LocalProductCodec.Decode("{\"version\":1,\"dailyAttempt\":{\"dayId\":20705}}").DailyAttempt.Actions, Is.Empty);
            // The money save carries no Daily at all.
            Assert.That(LocalProductCodec.Encode(open, campaignOnly: true), Does.Not.Contain("dailyAttempt").And.Not.Contain("actions"));
        }
        // The platform account names the player; a save written when it kept a name still reads, without one.
        [Test] public void AnEarlierSavesNameIsReadPastAndNeverWritten()
        {
            var restored = LocalProductCodec.Decode("{\"version\":1,\"name\":\"Mira\",\"streak\":3}");
            Assert.That(restored.Streak, Is.EqualTo(3));
            Assert.That(LocalProductCodec.Encode(restored), Does.Not.Contain("name").And.Not.Contain("Mira"));
        }

        [Test]
        public void WritesNormalizeThroughTheSameVersionedKey()
        {
            string savedKey = null, saved = null;
            var store = new LocalProductStore(key => null, (key, value) => { savedKey = key; saved = value; });
            store.Write(current => { current.Stars = new byte[] { 9, 2 }; current.WornEmblem = 99; current.CampaignPrice = "  €0.99  "; return current; });
            Assert.That(savedKey, Is.EqualTo(LocalProductCodec.StorageKey));
            var reloaded = new LocalProductStore(key => { Assert.That(key, Is.EqualTo(savedKey)); return saved; });
            Assert.That(reloaded.Read.Stars.Length, Is.EqualTo(100));
            Assert.That(reloaded.Read.Stars.Take(3), Is.EqualTo(new byte[] { 3, 2, 0 }));
            Assert.That(reloaded.Read.WornEmblem, Is.EqualTo(12), "The last emblem, World Perfect");
            Assert.That(reloaded.Read.CampaignPrice, Is.EqualTo("€0.99"));
        }
        [Test]
        public void StorageFailurePropagatesAfterNormalizedMemoryUpdate()
        {
            var store = new LocalProductStore(write: (_, __) => throw new IOException("disk-full"));
            Assert.Throws<IOException>(() => store.Write(current => { current.CampaignPrice = "  €0.99  "; return current; }));
            Assert.That(store.Read.CampaignPrice, Is.EqualTo("€0.99"));
            var memory = new LocalProductStore();
            Assert.That(memory.Write(current => { current.CampaignPrice = "€1.99"; return current; }).CampaignPrice, Is.EqualTo("€1.99"));
        }
        [Test] public void MoneySaveContainsOnlyCampaignDataAndDailyMetricsRemainNumbers()
        {
            string saved = null;
            var store = new LocalProductStore(write: (_, value) => saved = value, owner: "connected-owner");
            store.Write(state => {
                state.CampaignOwned = true; state.Streak = 8;
                state.DailyAttempt = new LocalDailyAttempt { DayId = 20000, ObjectiveTotal = 123 };
                state.Stars[0] = 3; state.CampaignWritePending = true; return state;
            });
            var document = JObject.Parse(saved);
            Assert.That(document.Properties().Select(value => value.Name), Is.EquivalentTo(new[] { "version", "stars", "campaignWritePending" }));
            Assert.That(new LocalProductStore(_ => saved, owner: "connected-owner").Read.Stars[0], Is.EqualTo(3));
            var local = JObject.Parse(LocalProductCodec.Encode(new LocalProductState {
                DailyAttempt = new LocalDailyAttempt { DayId = 20000, ObjectiveTotal = ulong.MaxValue } }));
            Assert.That(local["dailyAttempt"]["objectiveTotal"].Type, Is.EqualTo(JTokenType.Integer));
            Assert.That(LocalProductCodec.Decode(local.ToString()).DailyAttempt.ObjectiveTotal, Is.EqualTo(ulong.MaxValue));
        }
    }
}
