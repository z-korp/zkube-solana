using System;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace ZKube.Presentation
{
    public abstract class AppIdentity : MonoBehaviour
    {
        public abstract void Open(AppStartup startup);
        public abstract Task Close();
        public virtual string UnavailableMessage(Exception error) =>
            Application.productName + " could not open your saved progress. Close and reopen the app to try again.";
    }

    [Serializable] public sealed class AppStartupConfiguration
    {
        public AppIdentity Identity;
        public TMP_FontAsset DisplayFont, BodyFont;
        public float TextScale, DisplayDensity;
    }

    public sealed class AppStartup : MonoBehaviour
    {
        public AppStartupConfiguration Configuration = new AppStartupConfiguration();
        private AppShell unavailable;
        private Task cleanup, stopped;
        private bool stopping;
        public string UnavailableText { get; private set; }
        public LaunchScreen Launch { get; private set; }
        // The first page has drawn once a shell holds page content (an error
        // page counts); an unavailable app shows why instead.
        private bool FirstPageDrawn()
        {
            if (unavailable != null) return true;
            foreach (var shell in FindObjectsByType<PageShell>(FindObjectsSortMode.None))
                if (!shell.Loading && shell.Page != null && shell.Page.childCount > 0) return true;
            foreach (var shell in FindObjectsByType<AppShell>(FindObjectsSortMode.None))
                if (!shell.Loading && shell.Content != null && shell.Content.childCount > 0) return true;
            return false;
        }
        public float TextScale => Configuration.TextScale == 0 ? AppPreferences.TextScale :
            BoardController.SupportedTextScale(Configuration.TextScale);
        public float? DisplayDensity => Configuration.DisplayDensity == 0 ? (float?)null : Configuration.DisplayDensity;

        // The motion spec is drawn for 60 fps; Android otherwise runs at 30.
        public const int FrameRate = 60;
        private void Start()
        {
            if (stopping) return;
            Application.targetFrameRate = FrameRate;
            StartCoroutine(ReleaseLaunchWindow());
            try
            {
                if (EventSystem.current == null)
                    new GameObject("Application input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(transform, false);
                if (Configuration.Identity == null) throw new InvalidOperationException("Application identity is missing");
                Configuration.Identity.Open(this);
                // Over the pages by sorting order, and after them in the hierarchy.
                Launch = LaunchScreen.Create(transform, FirstPageDrawn, DisplayDensity ?? BoardController.ReadDisplayDensity());
            }
            catch (Exception error)
            {
                _ = CloseIdentity();
                UnavailableText = Configuration.Identity == null ? "The application could not start." : Configuration.Identity.UnavailableMessage(error);
                var root = new GameObject("Application unavailable"); root.transform.SetParent(transform, false);
                unavailable = root.AddComponent<AppShell>(); unavailable.Initialize(Application.productName);
                var label = AppPages.Rect("Unavailable status", unavailable.Content).gameObject.AddComponent<TextMeshProUGUI>();
                label.font = Configuration.BodyFont ?? TMP_Settings.defaultFontAsset;
                label.fontSize = 24 * TextScale; label.text = UnavailableText; label.color = Color.white;
                label.gameObject.AddComponent<LayoutElement>().preferredHeight = 160 * TextScale;
                Debug.LogWarning("Application unavailable: " + error.GetType().Name);
            }
        }
        // The Android launch window draws the splash until Unity's first frame
        // (see ZKubeAndroidProject). Once frames are up it is hidden behind
        // them, so a plain colour replaces it and the decoded splash is freed.
        public bool LaunchWindowReleased { get; private set; }
        private System.Collections.IEnumerator ReleaseLaunchWindow()
        {
            yield return null; yield return new WaitForEndOfFrame(); yield return null;
#if UNITY_ANDROID && !UNITY_EDITOR
            static AndroidJavaObject Activity()
            {
                using var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer");
                return player.GetStatic<AndroidJavaObject>("currentActivity");
            }
            using (var activity = Activity())
                activity.Call("runOnUiThread", new AndroidJavaRunnable(() =>
                {
                    using var owner = Activity();
                    using var window = owner.Call<AndroidJavaObject>("getWindow");
                    using var black = new AndroidJavaObject("android.graphics.drawable.ColorDrawable", unchecked((int)0xFF000000));
                    window.Call("setBackgroundDrawable", black);
                }));
#endif
            LaunchWindowReleased = true;
        }
        public Task StopAsync()
        {
            if (stopped != null) return stopped;
            stopping = true; unavailable?.Show(false);
            foreach (var canvas in GetComponentsInChildren<Canvas>()) canvas.gameObject.SetActive(false);
            return stopped = CloseIdentity();
        }
        private Task CloseIdentity() => cleanup ??= Close();
        private async Task Close()
        {
            try { if (!ReferenceEquals(Configuration.Identity, null)) await Configuration.Identity.Close(); }
            catch (Exception error) { Debug.LogException(error); }
        }
        private void OnApplicationPause(bool paused) { if (unavailable != null && !stopping) unavailable.Show(!paused); }
        private void OnDestroy() { _ = StopAsync(); }
    }
}
