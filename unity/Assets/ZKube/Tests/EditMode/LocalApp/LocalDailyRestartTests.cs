using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Core;
using ZKube.Local;
using ZKube.Local.App;

namespace ZKube.Local.App.Tests
{
    // The Realms Daily is one try a day. Its reservation is saved before its
    // opening is shown, so an unfinished attempt must survive the process: it
    // is replayed from its saved accepted log, as a Campaign run is.
    public sealed class LocalDailyRestartTests
    {
        private static readonly long Day = (long)NativeEngine.Daily(20705).OpensAt;
        private static (Func<LocalProductStore> open, Dictionary<string, string> disk) Disk()
        {
            var disk = new Dictionary<string, string>();
            return (() => new LocalProductStore(key => disk.TryGetValue(key, out var value) ? value : null, (key, value) => disk[key] = value), disk);
        }

        [Test] public void an_unfinished_realms_daily_survives_process_death_and_stays_one_try()
        {
            var (open, disk) = Disk(); long clock = Day + 3600;
            var runs = new StoreRunClient(open(), () => clock);
            var first = runs.StartDaily();
            Assert.That(open().Read.DailyAttempt.Actions, Is.Empty, "The reservation is saved with an empty log");
            var accepted = runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            Assert.That(open().Read.DailyAttempt.Actions.Select(action => action.Kind), Is.EqualTo(new[] { "Reroll" }));
            Assert.That(open().Read.DailyAttempt.Finished, Is.False);

            // The process dies and the app opens again the same day.
            var restored = new StoreRunClient(open(), () => clock + 600);
            var resumed = restored.Active("daily");
            Assert.That(resumed, Is.Not.Null, "The unfinished attempt is open again");
            CollectionAssert.AreEqual(accepted.View.Token.Config, resumed.Token.Config);
            CollectionAssert.AreEqual(accepted.View.Token.State, resumed.Token.State);
            Assert.Throws<InvalidOperationException>(() => restored.StartDaily(), "It is still the day's one try");
            string before = disk[LocalProductCodec.StorageKey];
            Assert.That(new StoreRunClient(open(), () => clock + 900).Active("daily"), Is.Not.Null);
            Assert.That(disk[LocalProductCodec.StorageKey], Is.EqualTo(before), "Restoring writes nothing");

            // Played on and finished, it keeps numeric metrics and no log, and nothing is open after that.
            restored.Act(resumed.RunId, resumed.Token, new LocalRunAction(LocalActionKind.Finish));
            var saved = JObject.Parse(LocalProductCodec.Encode(open().Read))["dailyAttempt"];
            Assert.That((bool)saved["finished"], Is.True); Assert.That(saved["actions"], Is.Null);
            Assert.That(saved["dailyScore"].Type, Is.EqualTo(JTokenType.Integer)); Assert.That(saved["objectiveTotal"].Type, Is.EqualTo(JTokenType.Integer));
            var after = new StoreRunClient(open(), () => clock + 1200);
            Assert.That(after.Active("daily"), Is.Null);
            Assert.Throws<InvalidOperationException>(() => after.StartDaily());
        }

        [Test] public void an_earlier_days_unfinished_daily_stays_used_and_the_new_day_starts_fresh()
        {
            var (open, _) = Disk(); long clock = Day + 3600;
            var runs = new StoreRunClient(open(), () => clock);
            var first = runs.StartDaily();
            runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            clock = (long)NativeEngine.Daily(20706).OpensAt + 60;
            var next = new StoreRunClient(open(), () => clock);
            Assert.That(next.Active("daily"), Is.Null, "Yesterday's attempt is not played on today");
            Assert.That(open().Read.DailyAttempt.DayId, Is.EqualTo(20705u));
            var today = next.StartDaily();
            Assert.That(open().Read.DailyAttempt.DayId, Is.EqualTo(20706u));
            Assert.That(open().Read.DailyAttempt.Actions, Is.Empty);
            Assert.That(next.Active("daily").RunId, Is.EqualTo(today.View.RunId));
        }

        [Test] public void a_daily_action_is_published_only_once_its_log_is_saved()
        {
            string saved = null; bool fail = false;
            var store = new LocalProductStore(_ => saved, (_, value) => { if (fail) throw new IOException("disk-full"); saved = value; });
            var runs = new StoreRunClient(store, () => Day + 3600);
            var first = runs.StartDaily();
            string before = saved; fail = true;
            Assert.Throws<IOException>(() => runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll)));
            CollectionAssert.AreEqual(first.View.Token.State, runs.Active("daily").Token.State, "The action was not accepted");
            Assert.That(saved, Is.EqualTo(before));
            fail = false;
            var accepted = runs.Act(first.View.RunId, first.View.Token, new LocalRunAction(LocalActionKind.Reroll));
            var restored = new StoreRunClient(new LocalProductStore(_ => saved), () => Day + 3600);
            CollectionAssert.AreEqual(accepted.View.Token.State, restored.Active("daily").Token.State);
        }

        [Test] public void a_log_that_cannot_be_replayed_leaves_the_attempt_used_and_the_app_opening()
        {
            var (open, disk) = Disk();
            var runs = new StoreRunClient(open(), () => Day + 3600);
            runs.StartDaily();
            // An action the engine refuses on this board: a slide of an empty cell out of range.
            var document = JObject.Parse(disk[LocalProductCodec.StorageKey]);
            document["dailyAttempt"]["actions"] = new JArray(new JObject { ["kind"] = "Move", ["row"] = 9, ["start"] = 7, ["destination"] = 0, ["reason"] = 0 });
            disk[LocalProductCodec.StorageKey] = document.ToString();
            var restored = new StoreRunClient(open(), () => Day + 3600);
            Assert.That(restored.Active("daily"), Is.Null);
            Assert.Throws<InvalidOperationException>(() => restored.StartDaily(), "The attempt stays used");
            // A log that is not a log at all is refused by the save contract, like a Campaign run's.
            document["dailyAttempt"]["actions"] = new JArray(new JObject { ["kind"] = "Teleport" });
            Assert.Throws<FormatException>(() => LocalProductCodec.Decode(document.ToString()));
        }
    }
}
