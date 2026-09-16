using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.Scripting;

namespace ZKube.Integration.Android
{
    // Construct on Unity's main thread. JNI invocation is marshalled there;
    // wallet responses may arrive from Android's activity thread.
    public sealed class AndroidWalletTransport : INativeWalletTransport, IPublicClientStore
    {
        private const string BridgeClass = "com.zkorp.zkube.unitywallet.UnityWalletBridge";
        private readonly SynchronizationContext unityContext;
        private readonly int unityThread;
        private readonly object gate = new object();
        private Callback pending;
        public AndroidWalletTransport()
        {
            unityContext = SynchronizationContext.Current ?? throw new InvalidOperationException("Create wallet transport on Unity main thread");
            unityThread = Thread.CurrentThread.ManagedThreadId;
        }
        public Task<string> Request(string requestJson)
        {
            RequireAndroid();
            var result = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            Callback callback;
            lock (gate)
            {
                if (pending != null) throw new WalletRequestException("wallet-busy");
                callback = new Callback(json => {
                    lock (gate) { pending = null; }
                    result.TrySetResult(json);
                });
                pending = callback;
            }
            Dispatch(() => {
                try
                {
                    RequireAndroid();
                    using var unity = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                    using var activity = unity.GetStatic<AndroidJavaObject>("currentActivity");
                    using var bridge = new AndroidJavaClass(BridgeClass);
                    bridge.CallStatic("start", activity, requestJson, callback);
                }
                catch (Exception cause)
                {
                    lock (gate) { pending = null; }
                    result.TrySetException(cause);
                }
            });
            return result.Task;
        }
        public Task<string> Read(string owner, string field) => Store(owner, (bridge, activity, key) =>
            bridge.CallStatic<string>("read", activity, key, field));
        public Task<bool> CompareExchange(string owner, string field, string expected, string value) => Store(owner, (bridge, activity, key) =>
            bridge.CallStatic<bool>("compareExchange", activity, key, field, expected, value));
        private Task<T> Store<T>(string owner, Func<AndroidJavaClass, AndroidJavaObject, string, T> call) => OnUnityThread(() => {
            RequireAndroid();
            string key = Convert.ToBase64String(SolanaAddress.Bytes(owner));
            using var unity = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
            using var activity = unity.GetStatic<AndroidJavaObject>("currentActivity");
            using var bridge = new AndroidJavaClass("com.zkorp.zkube.unitywallet.ClientStore");
            return call(bridge, activity, key);
        });
        public Task<byte[]> LoadDeviceSeed(bool create) => OnUnityThread(() => {
            RequireAndroid();
            using var unity = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
            using var activity = unity.GetStatic<AndroidJavaObject>("currentActivity");
            using var bridge = new AndroidJavaClass(BridgeClass);
            string encoded = bridge.CallStatic<string>("loadDeviceSeed", activity, create);
            if (encoded == null) return null;
            if (encoded.Length != 44) throw new FormatException("Invalid native device seed");
            var bytes = Convert.FromBase64String(encoded);
            if (bytes.Length != 32) throw new FormatException("Invalid native device seed");
            return bytes;
        });
        private Task<T> OnUnityThread<T>(Func<T> call)
        {
            var result = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            Dispatch(() => { try { result.TrySetResult(call()); } catch (Exception cause) { result.TrySetException(cause); } });
            return result.Task;
        }
        private void Dispatch(Action action)
        {
            if (Thread.CurrentThread.ManagedThreadId == unityThread) action();
            else unityContext.Post(_ => action(), null);
        }
        private static void RequireAndroid()
        {
            if (Application.platform != RuntimePlatform.Android) throw new PlatformNotSupportedException("Native wallet requires Android");
        }
        [Preserve]
        private sealed class Callback : AndroidJavaProxy
        {
            private Action<string> complete;
            public Callback(Action<string> complete) : base("com.zkorp.zkube.unitywallet.BridgeCallback") { this.complete = complete; }
            [Preserve] public void onComplete(string resultJson) => Interlocked.Exchange(ref complete, null)?.Invoke(resultJson);
        }
    }
}
