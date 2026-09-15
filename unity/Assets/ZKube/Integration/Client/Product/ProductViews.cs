using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration.Client
{
    // Query values carry the viewing identity lease. There is no shared cache;
    // hosts retain the lease and use IsCurrent before displaying retained values.
    public sealed class PlayerProfile
    {
        private readonly JObject fields;
        public string Owner { get; }
        public ulong Slot { get; }
        public bool Exists => fields != null;
        public ulong Kredits => fields == null ? 0 : (ulong)fields["kredit_balance"];
        public ulong LadderPoints => fields == null ? 0 : (ulong)fields["ladder_points"];
        public byte CurrentTier { get; }
        public byte HighestTier => fields == null ? (byte)0 : (byte)fields["highest_ladder_tier"];
        public byte WornTier => fields == null ? (byte)0 : (byte)fields["featured_frame_tier"];
        public ulong CurrentTierFloor { get; }
        public ulong? NextTierFloor { get; }
        // Preserve independent Score/Theme records and all profile fields through
        // an isolated copy. UI code never receives the validator's mutable object.
        public JObject Fields => (JObject)fields?.DeepClone();
        internal PlayerProfile(string owner, ulong slot, JObject source)
        {
            Owner = owner; Slot = slot; fields = (JObject)source?.DeepClone();
            CurrentTier = NativeEngine.LadderTier(LadderPoints);
            CurrentTierFloor = NativeEngine.LadderTierFloor(CurrentTier);
            NextTierFloor = CurrentTier < NativeEngine.LadderTier(ulong.MaxValue) ? NativeEngine.LadderTierFloor((byte)(CurrentTier + 1)) : (ulong?)null;
        }
    }
    public sealed class CampaignMapProgress
    {
        private readonly JObject catalog;
        public byte MapId { get; }
        public bool Enabled { get; }
        public bool Unlocked { get; }
        public bool Cleared { get; }
        public bool Perfected { get; }
        public IReadOnlyList<byte> Stars { get; }
        public JObject Catalog => (JObject)catalog.DeepClone();
        internal CampaignMapProgress(byte map, JObject source, byte[] stars, bool unlocked)
        { MapId = map; catalog = (JObject)source.DeepClone(); Enabled = (bool)catalog["enabled"];
            Stars = Array.AsReadOnly((byte[])stars.Clone()); Unlocked = unlocked;
            Cleared = stars[stars.Length - 1] > 0; Perfected = stars.All(value => value == 3); }
    }
    public sealed class CampaignProgress
    {
        public string Status { get; }
        public uint? ContentVersion { get; }
        public PlayerProfile Player { get; }
        public IReadOnlyList<CampaignMapProgress> Maps { get; }
        public int? TotalStars => Maps.Count == 0 ? (int?)null : Maps.Sum(map => map.Stars.Sum(stars => stars));
        public static CampaignProgress FromStars(string owner, byte[] stars, PlayerProfile player = null)
        {
            if (stars == null || stars.Length != 100 || stars.Any(value => value > 3))
                throw new ArgumentException("Campaign stars have an invalid layout");
            var maps = Protocol.Realms.Select(realm => {
                int start = (realm.MapId - 1) * Protocol.CampaignTargets.Length;
                var guardian = realm.GuardianAndHeight;
                var catalog = new JObject {
                    ["map_id"] = realm.MapId, ["theme_id"] = realm.MapId, ["enabled"] = true,
                    ["map_rules"] = new JObject {
                        ["guardian"] = new JObject { ["bonus"] = guardian[0], ["trigger"] = guardian[1], ["threshold"] = guardian[2] },
                        ["starting_rows"] = guardian[3],
                    },
                    ["levels"] = new JArray(realm.Levels.Select((level, index) => new JObject {
                        ["level"] = index + 1, ["difficulty"] = level.Tier,
                        ["primary"] = Constraint(level.Primary), ["secondary"] = Constraint(level.Secondary),
                    })),
                };
                return new CampaignMapProgress(realm.MapId, catalog, stars.Skip(start).Take(Protocol.CampaignTargets.Length).ToArray(),
                    realm.MapId == 1 || stars[start - 1] > 0);
            }).ToArray();
            return new CampaignProgress("ready", Protocol.CatalogVersion, player ?? new PlayerProfile(owner, 0, null), maps);
        }
        private static JObject Constraint(byte[] value) => new JObject {
            ["kind"] = value[0], ["value"] = value[1], ["required_count"] = value[2],
        };
        internal CampaignProgress(string status, uint? version, PlayerProfile player, CampaignMapProgress[] maps)
        { Status = status; ContentVersion = version; Player = player; Maps = Array.AsReadOnly(maps); }
    }
    public sealed class DailyLobby
    {
        private readonly JObject daily, player;
        public uint DayId { get; }
        public string Status { get; }
        public bool Suspended { get; }
        public bool ProtocolPaused { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        public ulong? PotLamports { get; }
        public PlayerProfile Profile { get; }
        public JObject Daily => (JObject)daily?.DeepClone();
        public JObject DailyPlayer => (JObject)player?.DeepClone();
        internal DailyLobby(uint day, string status, bool suspended, bool paused, byte realm, byte kind, byte value,
            ulong? pool, PlayerProfile profile, JObject dailyFields, JObject playerFields)
        { DayId = day; Status = status; Suspended = suspended; ProtocolPaused = paused;
            Realm = realm; ObjectiveKind = kind; ObjectiveValue = value; PotLamports = pool; Profile = profile;
            daily = (JObject)dailyFields?.DeepClone(); player = (JObject)playerFields?.DeepClone(); }
    }
    public sealed class PrizeRow
    {
        public ValidatedBoardRow Record { get; }
        public uint Rank => Record.Position + 1;
        public ulong Metric { get; }
        public ulong PayoutLamports { get; }
        internal PrizeRow(ValidatedBoardRow row, string kind, ulong payout)
        { Record = row; Metric = kind == "score" ? row.Score : row.ObjectiveTotal; PayoutLamports = payout; }
    }
    public sealed class PrizeBoard
    {
        public string Kind { get; }
        public string Status { get; }
        public string ClaimStatus { get; }
        public long? ExpiresAt { get; }
        public IReadOnlyList<PrizeRow> Rows { get; }
        public PrizeRow Yours { get; }
        public ValidatedBoardAccount Account { get; }
        internal PrizeBoard(string kind, string status, string claim, long? expiresAt, PrizeRow[] rows, string owner, ValidatedBoardAccount account)
        { Kind = kind; Status = status; ClaimStatus = claim; ExpiresAt = expiresAt; Rows = Array.AsReadOnly(rows);
            Yours = rows.SingleOrDefault(row => row.Record.Player == owner); Account = account; }
    }
    public sealed class DailyBoards
    {
        public uint DayId { get; }
        public ulong Slot { get; }
        public string DailyStatus { get; }
        public PrizeBoard Score { get; }
        public PrizeBoard Theme { get; }
        internal DailyBoards(uint day, ulong slot, string status, PrizeBoard score, PrizeBoard theme)
        { DayId = day; Slot = slot; DailyStatus = status; Score = score; Theme = theme; }
    }
}
