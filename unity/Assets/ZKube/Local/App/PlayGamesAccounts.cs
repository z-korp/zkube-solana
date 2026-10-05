using System;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Presentation;

namespace ZKube.Local.App
{
    // Google Play Games (v2) as the Realms player account, through the store
    // package's PlayGamesAccount bridge: the platform signs the player in on its
    // own at launch, and this reads who that is. Any failure is no account.
    public sealed class PlayGamesAccounts : IPlayerAccounts
    {
        private const string Bridge = "com.zkorp.zkube.store.PlayGamesAccount";
        private const int AvatarSize = 96;
        private sealed class Listener : AndroidJavaProxy
        {
            private readonly TaskCompletionSource<(string name, string avatar)> done;
            public Listener(TaskCompletionSource<(string, string)> done) : base(Bridge + "$Listener") { this.done = done; }
            // Called by the bridge on Android's main thread.
            public void signedIn(string name, string avatar) => done.TrySetResult((name, avatar));
            public void unavailable(string reason) => done.TrySetResult((null, null));
        }

        private sealed class TopListener : AndroidJavaProxy
        {
            private readonly TaskCompletionSource<ulong?> done;
            public TopListener(TaskCompletionSource<ulong?> done) : base(Bridge + "$TopListener") { this.done = done; }
            public void top(long score) => done.TrySetResult(score > 0 ? (ulong)score : (ulong?)null);
            public void none(string reason) => done.TrySetResult(null);
        }

        private sealed class OpenListener : AndroidJavaProxy
        {
            private readonly TaskCompletionSource<string> done;
            public OpenListener(TaskCompletionSource<string> done) : base(Bridge + "$OpenListener") { this.done = done; }
            public void opened() => done.TrySetResult(null);
            public void failed(string reason) => done.TrySetResult(reason ?? "unavailable");
        }

        public async Task<PlayerAccount> SignIn()
        {
            try
            {
                var done = new TaskCompletionSource<(string name, string avatar)>(TaskCreationOptions.RunContinuationsAsynchronously);
                Call("signIn", new Listener(done));
                // Awaited from Unity's main thread, so the rest runs there.
                var (name, avatar) = await done.Task;
                if (string.IsNullOrEmpty(name)) return null;
                Texture2D picture = null;
                if (!string.IsNullOrEmpty(avatar))
                {
                    // The bridge hands over AvatarSize x AvatarSize RGBA pixels, bottom row first.
                    var pixels = Convert.FromBase64String(avatar);
                    if (pixels.Length == AvatarSize * AvatarSize * 4)
                    {
                        picture = new Texture2D(AvatarSize, AvatarSize, TextureFormat.RGBA32, false);
                        picture.LoadRawTextureData(pixels); picture.Apply(false, true);
                    }
                }
                return new PlayerAccount { Name = name, Avatar = picture };
            }
            catch (Exception) { return null; }
        }

        public bool HasDailyLeaderboard
        {
            get { try { return Call<bool>("hasDailyLeaderboard"); } catch (Exception) { return false; } }
        }
        public void SubmitDailyScore(ulong score)
        {
            try { Call("submitDailyScore", (long)Math.Min(score, long.MaxValue)); } catch (Exception) { }
        }
        public async Task<bool> ShowDailyLeaderboard()
        {
            string reason;
            try
            {
                var done = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                Call("showDailyLeaderboard", new OpenListener(done));
                reason = await done.Task;
            }
            catch (Exception error) { reason = error.GetType().Name; }
            // The bridge's reason is a short word or an exception's class, nothing of the player's.
            if (reason != null) Debug.LogWarning("Play Games leaderboard did not open: " + reason);
            return reason == null;
        }

        public async Task<ulong?> DailyTop()
        {
            try
            {
                var done = new TaskCompletionSource<ulong?>(TaskCreationOptions.RunContinuationsAsynchronously);
                Call("dailyTop", new TopListener(done));
                return await done.Task;
            }
            catch (Exception) { return null; }
        }

        private static void Call(string method, params object[] arguments) => Call<object>(method, arguments);
        private static T Call<T>(string method, params object[] arguments)
        {
            using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
            using (var bridge = new AndroidJavaClass(Bridge))
            {
                var all = new object[arguments.Length + 1]; all[0] = activity; arguments.CopyTo(all, 1);
                if (typeof(T) == typeof(object)) { bridge.CallStatic(method, all); return default; }
                return bridge.CallStatic<T>(method, all);
            }
        }
    }
}
