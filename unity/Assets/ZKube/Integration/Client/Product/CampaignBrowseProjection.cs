using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration.Client
{
    public sealed class CampaignBrowseLevel
    {
        public byte Level { get; }
        public byte Stars { get; }
        public string State { get; }
        public bool CanInspect { get; }
        public bool SavedRules { get; }
        private readonly byte[] request;
        public BuildConfigRequest Rules => BuildConfigRequest.Decode(request);
        internal CampaignBrowseLevel(byte level, byte stars, string state, bool canInspect, bool saved, BuildConfigRequest rules)
        { Level = level; Stars = stars; State = state; CanInspect = canInspect; SavedRules = saved; request = rules.Encode(); }
    }
    public sealed class CampaignBrowseRealm
    {
        public byte MapId { get; }
        public byte ThemeId { get; }
        public bool Unlocked { get; }
        public bool Enabled { get; }
        public int CurrentIndex { get; }
        public IReadOnlyList<CampaignBrowseLevel> Levels { get; }
        internal CampaignBrowseRealm(CampaignMapProgress map, byte theme, int current, CampaignBrowseLevel[] levels)
        { MapId = map.MapId; ThemeId = theme; Unlocked = map.Unlocked; Enabled = map.Enabled; CurrentIndex = current; Levels = Array.AsReadOnly(levels); }
    }
    // UI projection agrees with actual TS generateMapData. Published catalog
    // values are preserved; a matching saved run supplies its own preview rules.
    public sealed class CampaignBrowseProjection
    {
        public IReadOnlyList<CampaignBrowseRealm> Realms { get; }
        public byte? SavedRealm { get; }
        public byte? SavedLevel { get; }
        private CampaignBrowseProjection(CampaignBrowseRealm[] realms, byte? savedRealm, byte? savedLevel)
        { Realms = Array.AsReadOnly(realms); SavedRealm = savedRealm; SavedLevel = savedLevel; }

        public static CampaignBrowseProjection Create(CampaignProgress progress, AccountEnvelope savedRun, AccountBindings accounts)
        {
            if (progress == null || accounts == null) throw new ArgumentNullException();
            byte? savedRealm = null, savedLevel = null; BuildConfigRequest saved = null;
            if (savedRun != null)
            {
                var fields = accounts.ActiveRun(savedRun, progress.Player.Owner);
                if (((JObject)fields["mode"]).Properties().Single().Name != "Campaign") throw new FormatException("Campaign preview received another run mode");
                savedRealm = (byte)fields["map_id"]; savedLevel = (byte)fields["level"];
                var native = new ActiveRunReconciler(accounts);
                // Reconcile validates the entire accepted snapshot, not just its label.
                native.Reconcile(savedRun, progress.Player.Owner); saved = native.BuildConfiguration(savedRun, progress.Player.Owner);
            }
            var realms = progress.Maps.Select(map => {
                var catalog = map.Catalog;
                int first = Array.FindIndex(map.Stars.ToArray(), stars => stars == 0);
                int current = first < 0 ? Protocol.CampaignTargets.Length - 1 : first;
                var levels = Enumerable.Range(0, Protocol.CampaignTargets.Length).Select(index => {
                    byte level = checked((byte)(index + 1));
                    bool playing = savedRealm == map.MapId && savedLevel == level;
                    bool cleared = map.Stars[index] > 0 || (map.Cleared && level == Protocol.CampaignTargets.Length);
                    string state = playing ? "playing" : cleared ? "cleared" : map.Enabled && map.Unlocked && index == current ? "current" : "locked";
                    bool blockedBySaved = savedRealm.HasValue && !playing;
                    var rules = playing ? saved : CatalogRules(catalog, level);
                    return new CampaignBrowseLevel(level, map.Stars[index], state, state != "locked" && !blockedBySaved, playing, rules);
                }).ToArray();
                return new CampaignBrowseRealm(map, (byte)catalog["theme_id"], current, levels);
            }).ToArray();
            return new CampaignBrowseProjection(realms, savedRealm, savedLevel);
        }
        private static BuildConfigRequest CatalogRules(JObject catalog, byte level)
        {
            var snapshot = catalog["levels"][level - 1]; var map = catalog["map_rules"];
            if ((byte)snapshot["level"] != level) throw new FormatException("Campaign catalog level index differs from its declared level");
            byte tier = (byte)snapshot["difficulty"];
            var config = new BuildConfigRequest {
                RulesHash = new byte[32], InitialReplay = new byte[32],
                MaxMoves = NativeEngine.CampaignMoveBudget(level, tier), PointsRequired = Protocol.CampaignTargets[level - 1],
                FixedTier = tier, TierPolicy = 0, StartingHeight = (byte)map["starting_rows"],
                BonusType = (byte)map["guardian"]["bonus"], Trigger = (byte)map["guardian"]["trigger"], TriggerThreshold = (ushort)map["guardian"]["threshold"],
                PrimaryKind = (byte)snapshot["primary"]["kind"], PrimaryValue = (byte)snapshot["primary"]["value"], PrimaryCount = (byte)snapshot["primary"]["required_count"],
                SecondaryKind = (byte)snapshot["secondary"]["kind"], SecondaryValue = (byte)snapshot["secondary"]["value"], SecondaryCount = (byte)snapshot["secondary"]["required_count"]
            };
            NativeEngine.BuildConfig(config); return config;
        }
    }
}
