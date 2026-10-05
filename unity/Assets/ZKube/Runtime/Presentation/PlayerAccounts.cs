using System.Threading.Tasks;
using UnityEngine;

namespace ZKube.Presentation
{
    // The platform's player account a walletless product shows on its profile:
    // its display name and its avatar, if it has one.
    public sealed class PlayerAccount
    {
        public string Name;
        public Texture2D Avatar;
    }

    // A platform's player accounts, behind one interface per platform: Google
    // Play Games on Android, Game Center on iOS when that build exists. Nothing
    // waits for it and nothing needs it: signed out, refused or unavailable is
    // no account, and the game plays on without one.
    public interface IPlayerAccounts
    {
        // The signed-in player, or null. It never throws.
        Task<PlayerAccount> SignIn();
        // Whether the platform has a Daily leaderboard for the signed-in player.
        bool HasDailyLeaderboard { get; }
        // A finished Daily's score; the platform keeps the player's best per day, week and all time.
        void SubmitDailyScore(ulong score);
        // Opens the platform's own leaderboard screen and says whether it opened. It never throws.
        Task<bool> ShowDailyLeaderboard();
        // Today's top score on the platform's Daily leaderboard, or null (signed
        // out, no board, no score yet, or a failed read). It never throws.
        Task<ulong?> DailyTop();
    }

    // Where no platform account exists (the Editor, a desktop player).
    public sealed class NoPlayerAccounts : IPlayerAccounts
    {
        public Task<PlayerAccount> SignIn() => Task.FromResult<PlayerAccount>(null);
        public bool HasDailyLeaderboard => false;
        public void SubmitDailyScore(ulong score) { }
        public Task<bool> ShowDailyLeaderboard() => Task.FromResult(false);
        public Task<ulong?> DailyTop() => Task.FromResult<ulong?>(null);
    }
}
