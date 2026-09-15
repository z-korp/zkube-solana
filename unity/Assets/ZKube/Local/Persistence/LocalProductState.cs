using System;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using ZKube.Persistence;

namespace ZKube.Local
{
    // Public local product data, never a wallet or device-secret store.
    public sealed class LocalDailyAttempt
    {
        public uint DayId { get; set; }
        public uint Realm { get; set; }
        public ulong ObjectiveKind { get; set; }
        public ulong ObjectiveValue { get; set; }
        public ulong DailyScore { get; set; }
        public string ObjectiveTotal { get; set; } = "0";
        public bool Finished { get; set; }
    }

    public sealed class LocalProductState
    {
        public int Version { get; set; } = LocalProductCodec.Version;
        public string Name { get; set; }
        public byte[] Stars { get; set; } = new byte[100];
        public LocalDailyAttempt DailyAttempt { get; set; }
        public ulong Streak { get; set; }
        public uint? LastAttemptDayId { get; set; }
        public ulong BestDailyScore { get; set; }
        public uint WornEmblem { get; set; }
        public bool CampaignOwned { get; set; }
        public string CampaignPrice { get; set; }
    }

    public static class LocalProductCodec
    {
        public const string StorageKey = "zkube:local-product:v1";
        public const int Version = 1;
        private const double MaximumSafeInteger = 9007199254740991d;

        public static LocalProductState Decode(string json)
        {
            if (json == null) return new LocalProductState();
            JObject parsed;
            try { parsed = StrictJson.Parse(json) as JObject; }
            catch (FormatException) { return new LocalProductState(); }
            if (parsed == null || Number(parsed["version"]) != Version) return new LocalProductState();
            var stars = new byte[100];
            if (parsed["stars"] is JArray array)
                for (int i = 0; i < Math.Min(array.Count, stars.Length); i++) stars[i] = (byte)Math.Min(3UL, Nonnegative(array[i]));
            string name;
            try { name = NormalizeName(parsed["name"]?.Type == JTokenType.String ? (string)parsed["name"] : null); }
            catch (ArgumentException) { name = null; }
            string price = parsed["campaignPrice"]?.Type == JTokenType.String ? StrictJson.TrimString((string)parsed["campaignPrice"]) : null;
            return new LocalProductState {
                Name = name, Stars = stars, DailyAttempt = Attempt(parsed["dailyAttempt"] as JObject),
                Streak = Nonnegative(parsed["streak"]),
                LastAttemptDayId = parsed["lastAttemptDayId"]?.Type == JTokenType.Null ? (uint?)null : Day(parsed["lastAttemptDayId"]),
                BestDailyScore = Nonnegative(parsed["bestDailyScore"]), WornEmblem = (uint)Math.Min(10UL, Nonnegative(parsed["wornEmblem"])),
                CampaignOwned = parsed["campaignOwned"]?.Type == JTokenType.Boolean && (bool)parsed["campaignOwned"],
                CampaignPrice = string.IsNullOrEmpty(price) ? null : Slice(price, 40),
            };
        }

        public static string Encode(LocalProductState state)
        {
            if (state == null) return "null";
            var attempt = state.DailyAttempt;
            var document = new JObject {
                ["version"] = state.Version, ["name"] = state.Name,
                ["stars"] = state.Stars == null ? JValue.CreateNull() : new JArray(Array.ConvertAll(state.Stars, item => (int)item)),
                ["dailyAttempt"] = attempt == null ? JValue.CreateNull() : new JObject {
                    ["dayId"] = attempt.DayId, ["realm"] = attempt.Realm,
                    ["objectiveKind"] = attempt.ObjectiveKind, ["objectiveValue"] = attempt.ObjectiveValue,
                    ["dailyScore"] = attempt.DailyScore, ["objectiveTotal"] = attempt.ObjectiveTotal, ["finished"] = attempt.Finished,
                },
                ["streak"] = state.Streak, ["lastAttemptDayId"] = state.LastAttemptDayId.HasValue ? new JValue(state.LastAttemptDayId.Value) : JValue.CreateNull(),
                ["bestDailyScore"] = state.BestDailyScore, ["wornEmblem"] = state.WornEmblem,
                ["campaignOwned"] = state.CampaignOwned, ["campaignPrice"] = state.CampaignPrice,
            };
            // Escape UTF-16 code units so a split/lone surrogate survives the
            // UTF-8 storage boundary exactly, as well-formed JSON.stringify does.
            return JsonConvert.SerializeObject(document, Formatting.None,
                new JsonSerializerSettings { StringEscapeHandling = StringEscapeHandling.EscapeNonAscii });
        }

        public static string NormalizeName(string value)
        {
            string normalized = Slice(StrictJson.TrimString(value ?? ""), 24);
            if (normalized.Length == 0) throw new ArgumentException("Enter a name");
            return normalized;
        }

        private static LocalDailyAttempt Attempt(JObject value)
        {
            if (value == null) return null;
            string total = value["objectiveTotal"]?.Type == JTokenType.String ? (string)value["objectiveTotal"] : null;
            // JavaScript \d is ASCII here; .NET's default \d also accepts Unicode digits.
            return new LocalDailyAttempt {
                DayId = Day(value["dayId"]), Realm = (uint)Math.Min(10UL, Math.Max(1UL, Nonnegative(value["realm"]))),
                ObjectiveKind = Nonnegative(value["objectiveKind"]), ObjectiveValue = Nonnegative(value["objectiveValue"]),
                DailyScore = Nonnegative(value["dailyScore"]), ObjectiveTotal = DecimalText(total) ? total : "0",
                Finished = value["finished"]?.Type == JTokenType.Boolean && (bool)value["finished"],
            };
        }
        private static bool DecimalText(string value)
        {
            if (string.IsNullOrEmpty(value)) return false;
            int length = value.Length;
            for (int i = 0; i < length; i++) if (value[i] < '0' || value[i] > '9') return false;
            return true;
        }
        private static double Number(JToken value) => value != null && (value.Type == JTokenType.Integer || value.Type == JTokenType.Float)
            ? (double)value : double.NaN;
        private static ulong Nonnegative(JToken value)
        {
            double number = Number(value);
            return number >= 0 && number <= MaximumSafeInteger && Math.Truncate(number) == number ? (ulong)number : 0;
        }
        private static uint Day(JToken value) => (uint)Math.Min(uint.MaxValue, Nonnegative(value));
        private static string Slice(string value, int length) => value.Length <= length ? value : value.Substring(0, length);
    }

    // The callbacks adapt public local storage; no platform dependency belongs in the codec.
    public sealed class LocalProductStore
    {
        private readonly Action<string, string> write;
        public LocalProductState Read { get; private set; }
        public LocalProductStore(Func<string, string> read = null, Action<string, string> write = null)
        { this.write = write; Read = LocalProductCodec.Decode(read?.Invoke(LocalProductCodec.StorageKey)); }
        public LocalProductState Write(Func<LocalProductState, LocalProductState> update)
        {
            Read = LocalProductCodec.Decode(LocalProductCodec.Encode(update(Read)));
            write?.Invoke(LocalProductCodec.StorageKey, LocalProductCodec.Encode(Read));
            return Read;
        }
    }
}
