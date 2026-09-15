using System;
using System.Collections.Generic;
using System.Linq;
using ZKube.Core;
using ZKube.Local;
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
    // UI projection uses the compiled catalog and the device-local saved run.
    public sealed class CampaignBrowseProjection
    {
        public IReadOnlyList<CampaignBrowseRealm> Realms { get; }
        public byte? SavedRealm { get; }
        public byte? SavedLevel { get; }
        private CampaignBrowseProjection(CampaignBrowseRealm[] realms, byte? savedRealm, byte? savedLevel)
        { Realms = Array.AsReadOnly(realms); SavedRealm = savedRealm; SavedLevel = savedLevel; }

        public static CampaignBrowseProjection Create(CampaignProgress progress, LocalRunView savedRun = null)
        {
            if (progress == null) throw new ArgumentNullException();
            byte? savedRealm = null, savedLevel = null; BuildConfigRequest saved = null;
            if (savedRun != null)
            {
                if (savedRun.Mode != "campaign") throw new FormatException("Campaign preview received another run mode");
                savedRealm = savedRun.Realm; savedLevel = savedRun.Level; saved = savedRun.Rules;
            }
            var realms = progress.Maps.Select(map => {
                int first = Array.FindIndex(map.Stars.ToArray(), stars => stars == 0);
                int current = first < 0 ? Protocol.CampaignTargets.Length - 1 : first;
                var levels = Enumerable.Range(0, Protocol.CampaignTargets.Length).Select(index => {
                    byte level = checked((byte)(index + 1));
                    bool playing = savedRealm == map.MapId && savedLevel == level;
                    bool cleared = map.Stars[index] > 0 || (map.Cleared && level == Protocol.CampaignTargets.Length);
                    string state = playing ? "playing" : cleared ? "cleared" : map.Enabled && map.LevelUnlocked[index] != 0 ? "current" : "locked";
                    bool blockedBySaved = savedRealm.HasValue && !playing;
                    var rules = playing ? saved : NativeEngine.CampaignRules(map.MapId, level);
                    return new CampaignBrowseLevel(level, map.Stars[index], state, (playing || map.LevelUnlocked[index] != 0) && !blockedBySaved, playing, rules);
                }).ToArray();
                return new CampaignBrowseRealm(map, map.MapId, current, levels);
            }).ToArray();
            return new CampaignBrowseProjection(realms, savedRealm, savedLevel);
        }
    }
}
