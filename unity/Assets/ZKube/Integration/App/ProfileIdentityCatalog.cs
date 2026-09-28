namespace ZKube.Integration.App
{
    public static class ProfileIdentityCatalog
    {
        public static readonly System.Collections.Generic.IReadOnlyList<ProfileTierDefinition> Tiers = System.Array.AsReadOnly(new[] {
            new ProfileTierDefinition(0, "Slate", "#6B7280"),
            new ProfileTierDefinition(1, "Copper", "#B4703C"),
            new ProfileTierDefinition(2, "Jade", "#10A37F"),
            new ProfileTierDefinition(3, "Azure", "#3B82F6"),
            new ProfileTierDefinition(4, "Prism", "#A855F7")
        });
    }
}
