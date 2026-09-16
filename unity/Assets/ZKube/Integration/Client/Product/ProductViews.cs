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
        internal PlayerProfile(string owner, JObject source)
        {
            Owner = owner; fields = (JObject)source?.DeepClone();
            CurrentTier = NativeEngine.LadderTier(LadderPoints);
            CurrentTierFloor = NativeEngine.LadderTierFloor(CurrentTier);
            NextTierFloor = CurrentTier < NativeEngine.LadderTier(ulong.MaxValue) ? NativeEngine.LadderTierFloor((byte)(CurrentTier + 1)) : (ulong?)null;
        }
    }
    public sealed class CampaignMapProgress
    {
        public byte MapId { get; }
        public bool Unlocked { get; }
        public bool Cleared { get; }
        public bool Perfected { get; }
        public IReadOnlyList<byte> Stars { get; }
        public IReadOnlyList<byte> LevelUnlocked { get; }
        internal CampaignMapProgress(byte map, CampaignProgressSummary progress)
        {
            MapId = map; int start = (map - 1) * Protocol.CampaignTargets.Length;
            Stars = Array.AsReadOnly(progress.Stars.Skip(start).Take(Protocol.CampaignTargets.Length).ToArray());
            LevelUnlocked = Array.AsReadOnly(progress.LevelUnlocked.Skip(start).Take(Protocol.CampaignTargets.Length).ToArray());
            Unlocked = progress.RealmUnlocked[map - 1] != 0;
            Cleared = progress.Cleared[map - 1] != 0; Perfected = progress.Perfected[map - 1] != 0;
        }
    }
    public sealed class CampaignProgress
    {
        public PlayerProfile Player { get; }
        public IReadOnlyList<CampaignMapProgress> Maps { get; }
        public int? TotalStars => facts.Total;
        private readonly CampaignProgressSummary facts;
        public IReadOnlyList<byte> EmblemUnlocked { get; }
        public IReadOnlyList<byte> EmblemGold { get; }
        public byte StrongestEmblem => facts.StrongestEmblem;
        public static CampaignProgress FromStars(string owner, byte[] stars, PlayerProfile player = null) =>
            new CampaignProgress(player ?? new PlayerProfile(owner, null),
                NativeEngine.CampaignProgress(stars));
        private CampaignProgress(PlayerProfile player, CampaignProgressSummary facts)
        {
            Player = player; this.facts = facts;
            EmblemUnlocked = Array.AsReadOnly(facts.EmblemUnlocked); EmblemGold = Array.AsReadOnly(facts.EmblemGold);
            Maps = Array.AsReadOnly(Protocol.Realms.Select(realm => new CampaignMapProgress(realm.MapId, facts)).ToArray());
        }
    }
    public sealed class DailyLobby
    {
        public uint DayId { get; }
        public string Status { get; }
        public bool Suspended { get; }
        public bool ProtocolPaused { get; }
        public byte Realm { get; }
        public byte ObjectiveKind { get; }
        public byte ObjectiveValue { get; }
        public ulong? PotLamports { get; }
        public PlayerProfile Profile { get; }
        internal DailyLobby(uint day, string status, bool suspended, bool paused, byte realm, byte kind, byte value,
            ulong? pool, PlayerProfile profile)
        { DayId = day; Status = status; Suspended = suspended; ProtocolPaused = paused;
            Realm = realm; ObjectiveKind = kind; ObjectiveValue = value; PotLamports = pool; Profile = profile;
        }
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
        public string DailyStatus { get; }
        public PrizeBoard Score { get; }
        public PrizeBoard Theme { get; }
        internal DailyBoards(uint day, string status, PrizeBoard score, PrizeBoard theme)
        { DayId = day; DailyStatus = status; Score = score; Theme = theme; }
    }
}
