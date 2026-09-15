using System;
using System.IO;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using ZKube.Integration.Android;
using ZKube.Integration.Presentation;
using ZKube.Integration.Transport;
using ZKube.Presentation;
using ZKube.Local;
using ZKube.Persistence;

namespace ZKube.Integration.App
{
    // Scene-owned. The committed scene leaves deployment configuration unset.
    // Neither successful authorization nor an offline graph is a fallback.
    public sealed class MoneyStartup : MonoBehaviour
    {
        [SerializeField] private TextAsset solanaSchema, sessionSchema;
        [SerializeField] private TMP_FontAsset displayFont, bodyFont;
        [SerializeField] private string baseUri, routerUri, expectedGenesis;
        [SerializeField] private MoneyAppController controller;
        private HttpClientJsonRpc http;
        private MoneyAppFlow flow;
        private bool started, stopping;
        private Task stopped;
        private float? injectedTextScale;
        private float? injectedDensity;
        public TextAsset SolanaSchema => solanaSchema;
        public TextAsset SessionSchema => sessionSchema;
        public MoneyAppController Controller => controller;
#if UNITY_EDITOR || ZKUBE_EVIDENCE
        private MoneyClientServices evidence;
        private string evidenceLabel;
        private Func<long> evidenceClock;
        public void InitializeEvidence(MoneyClientServices services, string label = "Offline evidence", Func<long> clock = null)
        {
            if (started || stopping || evidence != null) throw new InvalidOperationException("Initialize evidence once before startup");
            if (string.IsNullOrWhiteSpace(label)) throw new ArgumentException("Evidence must be visibly labeled", nameof(label));
            evidence = services ?? throw new ArgumentNullException(nameof(services)); evidenceLabel = label; evidenceClock = clock;
        }
#endif
        // Root's scene preparation serializes these canonical asset references.
        public void Configure(TextAsset solana, TextAsset session, TMP_FontAsset heading, TMP_FontAsset body,
            string baseAddress = null, string routerAddress = null, string genesis = null, float? textScale = null, float? displayDensity = null)
        {
            if (started || stopping) throw new InvalidOperationException("Configure before startup");
            solanaSchema = solana; sessionSchema = session; displayFont = heading; bodyFont = body;
            baseUri = baseAddress; routerUri = routerAddress; expectedGenesis = genesis;
            injectedTextScale = textScale.HasValue ? BoardController.SupportedTextScale(textScale.Value) : (float?)null;
            injectedDensity = displayDensity;
        }
        private void Start()
        {
            if (started || stopping) return; started = true;
            if (controller == null) controller = gameObject.AddComponent<MoneyAppController>();
            try
            {
                MoneyClientServices services;
#if UNITY_EDITOR || ZKUBE_EVIDENCE
                if (evidence != null) services = evidence;
                else
#endif
                {
                    // Both constructors are local only. The graph validates
                    // configuration before using any platform dependency.
                    http = new HttpClientJsonRpc();
                    var native = new AndroidWalletTransport();
                    string campaignDirectory = Path.Combine(Application.persistentDataPath, "campaign");
                    services = new MoneyClientServices(solanaSchema == null ? null : solanaSchema.text,
                        sessionSchema == null ? null : sessionSchema.text,
                        new MoneyConnectionConfig(baseUri, routerUri, expectedGenesis), http, native, native,
                        () => DateTimeOffset.UtcNow.ToUnixTimeSeconds(), owner => {
                            string path = Path.Combine(campaignDirectory, owner + ".json");
                            return new LocalProductStore(_ => AtomicProductFile.Read(path),
                                (_, value) => AtomicProductFile.Write(path, value), owner);
                        });
#if !UNITY_ANDROID || UNITY_EDITOR
                    throw new PlatformNotSupportedException("Wallet support requires the Android money application.");
#endif
                }
                flow = new MoneyAppFlow(services);
                controller.Initialize(flow, services.Identity, displayFont, bodyFont,
#if UNITY_EDITOR || ZKUBE_EVIDENCE
                    evidence == null ? null : evidenceLabel, evidenceClock,
#else
                    null, null,
#endif
                    injectedTextScale ?? BoardController.ReadSavedTextScale(), injectedDensity
                );
                controller.AttachRunHost(gameObject.AddComponent<MoneyBoardHost>());
            }
            catch (Exception error)
            {
                if (flow != null) _ = StopAsync();
                else { http?.Dispose(); http = null; }
                // Root verifies serialized fonts before creating the scene;
                // configuration failures remain legible without realm assets.
                if (flow == null) controller.ShowUnavailable(displayFont, bodyFont,
                    error is MoneyConfigurationException ? "Network configuration is unavailable." :
                    error is PlatformNotSupportedException ? "Wallet support requires the Android money application." : "The application could not start.",
                    injectedTextScale ?? BoardController.ReadSavedTextScale(), injectedDensity);
                Debug.LogWarning("Money startup unavailable: " + error.GetType().Name);
            }
        }
        public Task StopAsync()
        {
            if (stopped != null) return stopped;
            stopping = true;
            return stopped = Stop();
        }
        private async Task Stop()
        {
            Exception failure = null;
            try { if (controller != null) controller.Detach(); }
            catch (Exception error) { failure = error; }
            try { if (flow != null) await flow.StopAsync(); }
            catch (Exception error) { failure = failure == null ? error : new AggregateException(failure, error); }
            finally { http?.Dispose(); http = null; }
            if (failure != null) Debug.LogException(failure);
        }
        private void OnDestroy() { _ = StopAsync(); }
    }
}
