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
    // Cosmetic presentation over validated Campaign facts. The program oracle
    // and actual TS resolver guard this projection, including sparse records.
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
            bool cleared = ProgressAvailable && campaign.Maps.All(map => map.Cleared);
            bool perfect = ProgressAvailable && campaign.Maps.All(map => map.Perfected);
            var choices = new List<ProfileEmblemChoice>();
            foreach (var definition in ProfileIdentityCatalog.Emblems.Where(value => value.Kind != ProfileEmblemKind.Automatic))
            {
                var realm = campaign.Maps.SingleOrDefault(map => map.MapId == definition.Realm);
                bool earned = definition.Kind switch {
                    ProfileEmblemKind.Guardian => realm?.Cleared == true,
                    ProfileEmblemKind.Realm => cleared,
                    ProfileEmblemKind.World => perfect,
                    _ => false
                };
                bool gold = definition.Kind == ProfileEmblemKind.Guardian ? realm?.Perfected == true : perfect;
                choices.Add(new ProfileEmblemChoice(definition, earned, earned && gold));
            }
            var strongest = choices.Where(value => value.Earned).OrderBy(value => value.Definition.Id).LastOrDefault();
            var automatic = ProfileIdentityCatalog.Emblems.Single(value => value.Kind == ProfileEmblemKind.Automatic);
            choices.Add(new ProfileEmblemChoice(automatic, true, strongest?.Gold == true));
            Emblems = Array.AsReadOnly(choices.OrderBy(value => value.Definition.Id).ToArray());
            DisplayedEmblem = StoredEmblem == automatic.Id ? strongest?.Definition.Id ?? automatic.Id : StoredEmblem;
        }
        public bool CanWear(byte emblem, byte frame) => Profile.Exists &&
            Emblems.Any(choice => choice.Definition.Id == emblem && choice.Earned) &&
            ProfileIdentityCatalog.Tiers.Any(tier => tier.Id == frame && tier.Id <= Profile.HighestTier);
    }
}
