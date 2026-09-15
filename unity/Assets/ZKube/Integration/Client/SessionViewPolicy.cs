namespace ZKube.Integration.Client
{
    public static class SessionViewPolicy
    {
        public const ulong ReadyReserveLamports = 10000UL;
        public const long ExpiringSeconds = 86400L;
        public static System.Collections.Generic.IReadOnlyList<uint> KreditPacks { get; } = System.Array.AsReadOnly(new uint[] { 1U, 10U, 25U });
    }
}
