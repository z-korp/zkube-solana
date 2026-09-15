using System;
using System.IO;
using UnityEngine;
using UnityEngine.EventSystems;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Local.App
{
    // A scene-owned lifetime: production connects to Google; the separate
    // evidence Player uses an explicit offline driver compiled out of release.
    public sealed class StoreStartup : MonoBehaviour
    {
        private CampaignBilling billing;
        private string failure;
        private void Start()
        {
#if UNITY_EDITOR || ZKUBE_EVIDENCE
            var diagnostic = gameObject.AddComponent<StoreStartupDiagnostic>();
#endif
            try
            {
                var directory = Path.Combine(Application.persistentDataPath, "local");
                var product = new LocalProductStore(key => Read(directory, key), (key, value) => Write(directory, key, value));
                var runs = new LocalRunClient(product, () => DateTimeOffset.UtcNow.ToUnixTimeSeconds(), StoreCampaignPolicy.PurchaseGate(product));
#if UNITY_EDITOR || ZKUBE_EVIDENCE
                var offlineStorePath = Path.Combine(directory, OfflineCampaignStoreDriver.FileName);
                billing = new CampaignBilling(new OfflineCampaignStoreDriver(
                    () => StartupFiles.Read(offlineStorePath), value => StartupFiles.Write(offlineStorePath, value)),
                    () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated),
                    runs.ApplyCampaignEntitlement);
#else
                billing = StoreCampaignBillingFactory.Create(product, runs);
#endif
                if (EventSystem.current == null)
                    new GameObject("Store input", typeof(EventSystem), typeof(StandaloneInputModule));
                var board = new GameObject("Store board", typeof(BoardController)).GetComponent<BoardController>();
                board.transform.SetParent(transform, false);
                gameObject.AddComponent<StoreAppController>().Initialize(product, runs, billing, board);
            }
            catch (Exception error)
            {
#if UNITY_EDITOR || ZKUBE_EVIDENCE
                diagnostic.RecordError("startup", error);
#endif
                billing?.Dispose(); billing = null;
                failure = "zKube could not open your saved progress. Close and reopen the app to try again.";
                Debug.LogException(error);
            }
        }
        private static string FilePath(string directory, string key)
        {
            if (key != LocalProductCodec.StorageKey) throw new InvalidOperationException("Unknown local product key");
            return Path.Combine(directory, key + ".json");
        }
        private static string Read(string directory, string key)
            => StartupFiles.Read(FilePath(directory, key));
        private static void Write(string directory, string key, string value)
            => StartupFiles.Write(FilePath(directory, key), value);
        private void OnGUI()
        {
            if (failure == null) return;
            GUI.Label(new Rect(24, 48, Screen.width - 48, Screen.height - 96), failure);
        }
        private void OnDestroy() { billing?.Dispose(); billing = null; }
    }
}
