using System;
using System.Collections.Generic;
using System.Linq;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The profile emblems both products show: the guardians' emblems 1–10 and
    // the two achievements. The core decides which are unlocked.
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
    public static class ProfileEmblems
    {
        public static readonly IReadOnlyList<ProfileEmblemDefinition> All = System.Array.AsReadOnly(new[] {
            new ProfileEmblemDefinition(0, ProfileEmblemKind.Automatic, 0, "Automatic"),
            new ProfileEmblemDefinition(1, ProfileEmblemKind.Guardian, 1, "Mako"),
            new ProfileEmblemDefinition(2, ProfileEmblemKind.Guardian, 2, "Sobek"),
            new ProfileEmblemDefinition(3, ProfileEmblemKind.Guardian, 3, "Fenris"),
            new ProfileEmblemDefinition(4, ProfileEmblemKind.Guardian, 4, "Noctua"),
            new ProfileEmblemDefinition(5, ProfileEmblemKind.Guardian, 5, "Long"),
            new ProfileEmblemDefinition(6, ProfileEmblemKind.Guardian, 6, "Lamassu"),
            new ProfileEmblemDefinition(7, ProfileEmblemKind.Guardian, 7, "Kitsune"),
            new ProfileEmblemDefinition(8, ProfileEmblemKind.Guardian, 8, "Balam"),
            new ProfileEmblemDefinition(9, ProfileEmblemKind.Guardian, 9, "Mamba"),
            new ProfileEmblemDefinition(10, ProfileEmblemKind.Guardian, 10, "Kuntur"),
            new ProfileEmblemDefinition(11, ProfileEmblemKind.Realm, 0, "Realm Conqueror"),
            new ProfileEmblemDefinition(12, ProfileEmblemKind.World, 0, "World Perfect")
        });
        public static byte Last => All.Max(emblem => emblem.Id);
        // The kit slot an achievement emblem's painting is in; guardians wear their portrait.
        public static string Painting(byte id) => id == 11 ? SkinSlots.Emblem11 : id == 12 ? SkinSlots.Emblem12 :
            throw new ArgumentOutOfRangeException(nameof(id), "Only the achievement emblems have their own painting");
    }
}
