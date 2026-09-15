using System;
using System.Collections.Generic;
using System.Linq;
using ZKube.Core.Generated;
using ZKube.Integration.Client;

namespace ZKube.Integration.App
{
    public enum ProfileEmblemKind { Automatic, Guardian, Realm, World }
    public sealed class ProfileEmblemDefinition
    {
        public byte Id { get; }
        public ProfileEmblemKind Kind { get; }
        public byte Realm { get; }
        public string Name { get; }
        public ProfileEmblemDefinition(byte id, ProfileEmblemKind kind, byte realm, string name)
        { Id = id; Kind = kind; Realm = realm; Name = name; }
    }
    public sealed class ProfileTierDefinition
    {
        public byte Id { get; }
        public string Name { get; }
        public string Color { get; }
        public ProfileTierDefinition(byte id, string name, string color)
        { Id = id; Name = name; Color = color; }
    }
    public sealed class ProfileEmblemChoice
    {
        public ProfileEmblemDefinition Definition { get; }
        public bool Earned { get; }
        public bool Gold { get; }
        internal ProfileEmblemChoice(ProfileEmblemDefinition definition, bool earned, bool gold)
        { Definition = definition; Earned = earned; Gold = gold; }
    }
    public sealed class MoneyProfileIdentity
    {
        public PlayerProfile Profile { get; }
        public IReadOnlyList<ProfileEmblemChoice> Emblems { get; }
        public byte StoredEmblem { get; }
        public byte DisplayedEmblem { get; }
        public bool ProgressAvailable { get; }
        public MoneyProfileIdentity(CampaignProgress campaign)
        {
            if (campaign == null) throw new ArgumentNullException(nameof(campaign));
            Profile = campaign.Player;
            StoredEmblem = (byte?)Profile.Fields?["featured_emblem"] ?? 0;
            ProgressAvailable = campaign.Maps.Count == Protocol.Realms.Length;
            Emblems = Array.AsReadOnly(ProfileIdentityCatalog.Emblems.Select(definition =>
                new ProfileEmblemChoice(definition, campaign.EmblemUnlocked[definition.Id] != 0,
                    campaign.EmblemUnlocked[definition.Id] != 0 && campaign.EmblemGold[definition.Id] != 0)).ToArray());
            DisplayedEmblem = StoredEmblem == 0 ? campaign.StrongestEmblem : StoredEmblem;
        }
        public bool CanWear(byte emblem, byte frame) => Profile.Exists &&
            Emblems.Any(choice => choice.Definition.Id == emblem && choice.Earned) &&
            ProfileIdentityCatalog.Tiers.Any(tier => tier.Id == frame && tier.Id <= Profile.HighestTier);
    }
}
