using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Scripting;

namespace ZKube.Integration.Android
{
    // A call into the Android plugin that did not go through, named by the Java
    // class and member that was asked, so a log line never carries a bare JNI message.
    public sealed class PluginCallException : Exception
    {
        public string Member { get; }
        public PluginCallException(string member, Exception cause)
            : base("Android plugin call " + member + " failed: " + cause.GetType().Name + ": " + cause.Message, cause) { Member = member; }
    }

    // The plugin's Java surface, one method per Java member. Every JNI object is
    // made and used inside these calls, and nowhere else.
    public interface IAndroidPlugin
    {
        // UnityWalletBridge.start: complete is called once with the result, from any thread.
        void Start(string requestJson, Action<string> complete);
        string LoadDeviceSeed(bool create);
        string SavedOwner();
        string Read(string key, string field);
        bool CompareExchange(string key, string field, string expected, string value);
    }

    // Construct on Unity's main thread. JNI finds the application's classes
    // only on that thread, so every plugin call is made there, whichever
    // thread asked; wallet responses may arrive from Android's activity thread.
    public sealed class AndroidWalletTransport : INativeWalletTransport, IPublicClientStore
    {
        private const string Bridge = "UnityWalletBridge", Store = "ClientStore";
        private readonly IAndroidPlugin plugin;
        private readonly SynchronizationContext unityContext;
        private readonly int unityThread;
        private readonly object gate = new object();
        private bool pending;
        public AndroidWalletTransport() : this(new UnityAndroidPlugin()) { }
        public AndroidWalletTransport(IAndroidPlugin plugin)
        {
            this.plugin = plugin ?? throw new ArgumentNullException(nameof(plugin));
            unityContext = SynchronizationContext.Current ?? throw new InvalidOperationException("Create wallet transport on Unity main thread");
            unityThread = Thread.CurrentThread.ManagedThreadId;
        }
        public Task<string> Request(string requestJson)
        {
            var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            lock (gate)
            {
                if (pending) throw new WalletRequestException("wallet-busy");
                pending = true;
            }
            Dispatch(() => {
                try
                {
                    Named(Bridge + ".start", () => {
                        plugin.Start(requestJson, json => { lock (gate) { pending = false; } result.TrySetResult(json); });
                        return true;
                    });
                }
                catch (Exception cause)
                {
                    lock (gate) { pending = false; }
                    result.TrySetException(cause);
                }
            });
            return result.Task;
        }
        public Task<string> Read(string owner, string field) =>
            OnUnityThread(Store + ".read", () => plugin.Read(Key(owner), field));
        public Task<bool> CompareExchange(string owner, string field, string expected, string value) =>
            OnUnityThread(Store + ".compareExchange", () => plugin.CompareExchange(Key(owner), field, expected, value));
        private static string Key(string owner) => Convert.ToBase64String(SolanaAddress.Bytes(owner));
        public Task<byte[]> LoadDeviceSeed(bool create) => OnUnityThread(Bridge + ".loadDeviceSeed", () => Seed(plugin.LoadDeviceSeed(create), "device seed"));
        public Task<byte[]> LoadAuthorizedOwner() => OnUnityThread(Bridge + ".savedOwner", () => Seed(plugin.SavedOwner(), "saved wallet identity"));
        // 32 bytes in canonical base64, or nothing saved.
        private static byte[] Seed(string encoded, string what)
        {
            if (encoded == null) return null;
            if (encoded.Length != 44) throw new FormatException("Invalid native " + what);
            var bytes = Convert.FromBase64String(encoded);
            if (bytes.Length != 32) throw new FormatException("Invalid native " + what);
            return bytes;
        }
        private Task<T> OnUnityThread<T>(string member, Func<T> call)
        {
            var result = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            Dispatch(() => { try { result.TrySetResult(Named(member, call)); } catch (Exception cause) { result.TrySetException(cause); } });
            return result.Task;
        }
        // The plugin is only ever reached here: on Unity's thread, and a failure carries the member that was asked.
        private T Named<T>(string member, Func<T> call)
        {
            if (Thread.CurrentThread.ManagedThreadId != unityThread)
                throw new PluginCallException(member, new InvalidOperationException("called off the application thread"));
            try { return call(); }
            catch (Exception cause) { throw new PluginCallException(member, cause); }
        }
        private void Dispatch(Action action)
        {
            if (Thread.CurrentThread.ManagedThreadId == unityThread) action();
            else unityContext.Post(_ => action(), null);
        }
    }

    // The real plugin over JNI. A Java class, activity or object that is not
    // there fails by its name instead of as a null pointer.
    public sealed class UnityAndroidPlugin : IAndroidPlugin
    {
        private const string Package = "com.zkorp.zkube.unitywallet.";
        // The open request's callback stays referenced until the next request replaces it.
        private Callback open;
        public void Start(string requestJson, Action<string> complete) => Call("UnityWalletBridge", (bridge, activity) => {
            open = new Callback(complete);
            bridge.CallStatic("start", activity, requestJson, open); return true; });
        public string LoadDeviceSeed(bool create) => Call("UnityWalletBridge", (bridge, activity) => bridge.CallStatic<string>("loadDeviceSeed", activity, create));
        public string SavedOwner() => Call("UnityWalletBridge", (bridge, activity) => bridge.CallStatic<string>("savedOwner", activity));
        public string Read(string key, string field) => Call("ClientStore", (bridge, activity) => bridge.CallStatic<string>("read", activity, key, field));
        public bool CompareExchange(string key, string field, string expected, string value) =>
            Call("ClientStore", (bridge, activity) => bridge.CallStatic<bool>("compareExchange", activity, key, field, expected, value));
        private static T Call<T>(string type, Func<AndroidJavaClass, AndroidJavaObject, T> call)
        {
            if (Application.platform != RuntimePlatform.Android) throw new PlatformNotSupportedException("Native wallet requires Android");
            using var unity = Class("com.unity3d.player.UnityPlayer");
            using var activity = unity.GetStatic<AndroidJavaObject>("currentActivity")
                ?? throw new InvalidOperationException("com.unity3d.player.UnityPlayer.currentActivity is null");
            using var bridge = Class(Package + type);
            return call(bridge, activity);
        }
        private static AndroidJavaClass Class(string name)
        {
            try { return new AndroidJavaClass(name); }
            catch (Exception cause) { throw new InvalidOperationException("Java class " + name + " was not found (" + cause.Message + ")", cause); }
        }
        [Preserve]
        private sealed class Callback : AndroidJavaProxy
        {
            private Action<string> complete;
            public Callback(Action<string> complete) : base(Package + "BridgeCallback") { this.complete = complete; }
            [Preserve] public void onComplete(string resultJson) => Interlocked.Exchange(ref complete, null)?.Invoke(resultJson);
        }
    }
}
