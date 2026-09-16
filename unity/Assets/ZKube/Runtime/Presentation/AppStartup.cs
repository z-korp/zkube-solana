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
        public float TextScale => Configuration.TextScale == 0 ? AppPreferences.TextScale :
            BoardController.SupportedTextScale(Configuration.TextScale);
        public float? DisplayDensity => Configuration.DisplayDensity == 0 ? (float?)null : Configuration.DisplayDensity;

        private void Start()
        {
            if (stopping) return;
            try
            {
                if (EventSystem.current == null)
                    new GameObject("Application input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(transform, false);
                if (Configuration.Identity == null) throw new InvalidOperationException("Application identity is missing");
                Configuration.Identity.Open(this);
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
