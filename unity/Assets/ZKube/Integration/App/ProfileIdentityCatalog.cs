namespace ZKube.Integration.App
{
    public static class ProfileIdentityCatalog
    {
        public static readonly System.Collections.Generic.IReadOnlyList<ProfileEmblemDefinition> Emblems = System.Array.AsReadOnly(new[] {
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
        public static readonly System.Collections.Generic.IReadOnlyList<ProfileTierDefinition> Tiers = System.Array.AsReadOnly(new[] {
            new ProfileTierDefinition(0, "Slate", "#6B7280"),
            new ProfileTierDefinition(1, "Copper", "#B4703C"),
            new ProfileTierDefinition(2, "Jade", "#10A37F"),
            new ProfileTierDefinition(3, "Azure", "#3B82F6"),
            new ProfileTierDefinition(4, "Prism", "#A855F7")
        });
    }
}
