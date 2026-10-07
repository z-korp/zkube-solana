using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ZKube.Local
{
    // Public local product data, never a wallet or device-secret store.
    public sealed class LocalDailyAttempt
    {
        public uint DayId { get; set; }
        public ulong DailyScore { get; set; }
        public ulong ObjectiveTotal { get; set; }
        // The pressure tier the run finished on, for the multiplier it reached.
        public byte Tier { get; set; }
        public bool Finished { get; set; }
        // The accepted actions of an attempt not finished yet. Its seed and its
        // rules come from its day, so this log alone replays the run after a
        // restart. A finished attempt keeps its result and no log.
        public List<LocalCampaignAction> Actions { get; set; } = new List<LocalCampaignAction>();
    }

    public sealed class LocalCampaignAction
    {
        [JsonProperty("kind")] public string Kind { get; set; }
        [JsonProperty("row")] public byte Row { get; set; }
        [JsonProperty("start")] public byte Start { get; set; }
        [JsonProperty("destination")] public byte Destination { get; set; }
        [JsonProperty("reason")] public byte Reason { get; set; }
    }

    public sealed class LocalCampaignRun
    {
        [JsonProperty("id")] public string Id { get; set; }
        [JsonProperty("catalogVersion")] public uint CatalogVersion { get; set; }
        [JsonProperty("realm")] public byte Realm { get; set; }
        [JsonProperty("level")] public byte Level { get; set; }
        [JsonProperty("seed")] public int[] Seed { get; set; }
        // The rules the run was started under: its run configuration, as the core encodes it. A level's rules
        // can change with the app; a run resumes only under the rules it was played under.
        [JsonProperty("rules", NullValueHandling = NullValueHandling.Ignore)] public string Rules { get; set; }
        [JsonProperty("actions")] public List<LocalCampaignAction> Actions { get; set; } = new List<LocalCampaignAction>();
    }

    public sealed class LocalProductState
    {
        public int Version { get; set; } = LocalProductCodec.Version;
        public byte[] Stars { get; set; } = new byte[100];
        public LocalDailyAttempt DailyAttempt { get; set; }
        public ulong Streak { get; set; }
        public ulong BestDailyScore { get; set; }
        public uint WornEmblem { get; set; }
        public bool CampaignOwned { get; set; }
        public string CampaignPrice { get; set; }
        public LocalCampaignRun CampaignRun { get; set; }
        public bool CampaignWritePending { get; set; }
    }

    public static class LocalProductCodec
    {
        public const string StorageKey = "zkube:local-product:v1";
        public const int Version = 1;

        public static LocalProductState Decode(string json)
        {
            if (json == null) return new LocalProductState();
            JObject parsed;
            try { parsed = JToken.Parse(json) as JObject; }
            catch (JsonException) { return new LocalProductState(); }
            if (parsed == null || parsed["version"]?.Type != JTokenType.Integer || Nonnegative(parsed["version"]) != Version) return new LocalProductState();
            var stars = new byte[100];
            if (parsed["stars"] is JArray array)
                for (int i = 0; i < Math.Min(array.Count, stars.Length); i++) stars[i] = (byte)Math.Min(3UL, Nonnegative(array[i]));
            string price = parsed["campaignPrice"]?.Type == JTokenType.String ? ((string)parsed["campaignPrice"]).Trim() : null;
            return new LocalProductState {
                Stars = stars, DailyAttempt = Attempt(parsed["dailyAttempt"] as JObject),
                Streak = Nonnegative(parsed["streak"]),
                BestDailyScore = Nonnegative(parsed["bestDailyScore"]), WornEmblem = (uint)Math.Min(ZKube.Presentation.ProfileEmblems.Last, Nonnegative(parsed["wornEmblem"])),
                CampaignOwned = parsed["campaignOwned"]?.Type == JTokenType.Boolean && (bool)parsed["campaignOwned"],
                CampaignPrice = string.IsNullOrEmpty(price) ? null : Slice(price, 40),
                CampaignRun = Campaign(parsed["campaignRun"]),
                CampaignWritePending = parsed["campaignWritePending"]?.Type == JTokenType.Boolean && (bool)parsed["campaignWritePending"],
            };
        }

        public static string Encode(LocalProductState state, bool campaignOnly = false)
        {
            if (state == null) return "null";
            var document = new JObject {
                ["version"] = state.Version,
                ["stars"] = state.Stars == null ? JValue.CreateNull() : new JArray(Array.ConvertAll(state.Stars, item => (int)item)),
            };
            if (!campaignOnly)
            {
                var attempt = state.DailyAttempt;
                document["dailyAttempt"] = attempt == null ? JValue.CreateNull() : new JObject {
                    ["dayId"] = attempt.DayId, ["dailyScore"] = attempt.DailyScore,
                    ["objectiveTotal"] = attempt.ObjectiveTotal, ["tier"] = attempt.Tier, ["finished"] = attempt.Finished,
                };
                if (attempt != null && !attempt.Finished && attempt.Actions != null && attempt.Actions.Count > 0)
                    document["dailyAttempt"]["actions"] = JArray.FromObject(attempt.Actions);
                document["streak"] = state.Streak; document["bestDailyScore"] = state.BestDailyScore;
                document["wornEmblem"] = state.WornEmblem;
                document["campaignOwned"] = state.CampaignOwned; document["campaignPrice"] = state.CampaignPrice;
            }
            if (state.CampaignRun != null) document["campaignRun"] = JObject.FromObject(state.CampaignRun);
            if (state.CampaignWritePending) document["campaignWritePending"] = true;
            // Escape UTF-16 code units so a split/lone surrogate survives the
            // UTF-8 storage boundary exactly.
            return JsonConvert.SerializeObject(document, Formatting.None,
                new JsonSerializerSettings { StringEscapeHandling = StringEscapeHandling.EscapeNonAscii });
        }

        private static LocalCampaignRun Campaign(JToken value)
        {
            if (value == null || value.Type == JTokenType.Null) return null;
            try
            {
                var run = value.ToObject<LocalCampaignRun>();
                if (run == null || !ulong.TryParse(run.Id, out var id) || id == 0 ||
                    run.Realm < 1 || run.Realm > 10 || run.Level < 1 || run.Level > 10 ||
                    run.Seed == null || run.Seed.Length != 32 || Array.Exists(run.Seed, item => item < 0 || item > 255) || !Log(run.Actions))
                    throw new FormatException("Saved Campaign run is malformed");
                return run;
            }
            catch (JsonException error) { throw new FormatException("Saved Campaign run is malformed", error); }
        }

        // A saved accepted log: bounded, and every action one the engine knows.
        private static bool Log(List<LocalCampaignAction> actions) => actions != null && actions.Count <= 65535 && !actions.Exists(item => item == null ||
            (item.Kind != "Move" && item.Kind != "Bonus" && item.Kind != "Reroll" && item.Kind != "Finish"));
        private static LocalDailyAttempt Attempt(JObject value)
        {
            if (value == null) return null;
            var attempt = new LocalDailyAttempt {
                DayId = Day(value["dayId"]), DailyScore = Nonnegative(value["dailyScore"]),
                ObjectiveTotal = Nonnegative(value["objectiveTotal"]), Tier = (byte)Math.Min(byte.MaxValue, Nonnegative(value["tier"])),
                Finished = value["finished"]?.Type == JTokenType.Boolean && (bool)value["finished"],
            };
            if (attempt.Finished || value["actions"] == null || value["actions"].Type == JTokenType.Null) return attempt;
            try
            {
                attempt.Actions = value["actions"].ToObject<List<LocalCampaignAction>>();
                if (!Log(attempt.Actions)) throw new FormatException("Saved Daily run is malformed");
            }
            catch (JsonException error) { throw new FormatException("Saved Daily run is malformed", error); }
            return attempt;
        }
        private static ulong Nonnegative(JToken value)
        {
            if (value?.Type != JTokenType.Integer) return 0;
            return ulong.TryParse(value.ToString(), System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out var number) ? number : 0;
        }
        private static uint Day(JToken value) => (uint)Math.Min(uint.MaxValue, Nonnegative(value));
        private static string Slice(string value, int length) => value.Length <= length ? value : value.Substring(0, length);
    }

    // The callbacks adapt public local storage; no platform dependency belongs in the codec.
    public sealed class LocalProductStore
    {
        private readonly object gate = new object();
        private readonly Action<string, string> write;
        private readonly string key;
        public string Owner { get; }
        public LocalProductState Read { get; private set; }
        public LocalProductStore(Func<string, string> read = null, Action<string, string> write = null, string owner = null)
        {
            if (owner != null && string.IsNullOrWhiteSpace(owner)) throw new ArgumentException("A connected owner address is required");
            this.write = write; Owner = owner;
            key = owner == null ? LocalProductCodec.StorageKey : LocalProductCodec.StorageKey + ":" + owner;
            Read = LocalProductCodec.Decode(read?.Invoke(key));
        }
        public LocalProductState Write(Func<LocalProductState, LocalProductState> update)
        {
            lock (gate)
            {
                Read = LocalProductCodec.Decode(LocalProductCodec.Encode(update(Read), Owner != null));
                write?.Invoke(key, LocalProductCodec.Encode(Read, Owner != null));
                return Read;
            }
        }
        // Campaign accepts a state only after its complete record reaches storage.
        public LocalProductState WriteCampaign(Func<LocalProductState, LocalProductState> update)
        {
            lock (gate)
            {
                var next = LocalProductCodec.Decode(LocalProductCodec.Encode(update(Read), Owner != null));
                write?.Invoke(key, LocalProductCodec.Encode(next, Owner != null));
                Read = next;
                return next;
            }
        }
    }
}
