using System;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;

namespace ZKube.Local.App
{
    public static class StoreResultSharing
    {
        public static bool NativeAvailable => Application.platform == RuntimePlatform.Android && !Application.isEditor;
        // User gesture only. ACTION_SEND opens the system chooser; its return
        // proves launch, never that another application delivered the result.
        public static Task<bool> Open(string text, CancellationToken cancellation)
        {
            cancellation.ThrowIfCancellationRequested();
#if UNITY_ANDROID && !UNITY_EDITOR && ZKUBE_STORE
            var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            using (var unity = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
            using (var activity = unity.GetStatic<AndroidJavaObject>("currentActivity"))
            {
                activity.Call("runOnUiThread", new AndroidJavaRunnable(() => {
                    if (cancellation.IsCancellationRequested) { completion.TrySetCanceled(); return; }
                    try
                    {
                        using var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                        using var current = player.GetStatic<AndroidJavaObject>("currentActivity");
                        using var intent = new AndroidJavaObject("android.content.Intent", "android.intent.action.SEND");
                        using var type = intent.Call<AndroidJavaObject>("setType", "text/plain");
                        using var extra = intent.Call<AndroidJavaObject>("putExtra", "android.intent.extra.TEXT", text);
                        using var title = intent.Call<AndroidJavaObject>("putExtra", "android.intent.extra.TITLE", "zKube Daily");
                        using var intents = new AndroidJavaClass("android.content.Intent");
                        using var chooser = intents.CallStatic<AndroidJavaObject>("createChooser", intent, "zKube Daily");
                        current.Call("startActivity", chooser); completion.TrySetResult(false);
                    }
                    catch (Exception error) { completion.TrySetException(error); }
                }));
            }
            return completion.Task;
#else
            GUIUtility.systemCopyBuffer = text;
            return Task.FromResult(true);
#endif
        }
    }
}
