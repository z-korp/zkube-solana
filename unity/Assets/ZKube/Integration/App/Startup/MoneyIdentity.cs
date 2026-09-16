using System;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Integration.Android;
using ZKube.Integration.Presentation;
using ZKube.Integration.Transport;
using ZKube.Local;
using ZKube.Persistence;
using ZKube.Presentation;

namespace ZKube.Integration.App
{
    // This holder belongs to the assembly excluded by !ZKUBE_STORE.
    [Serializable] public sealed class MoneyConfiguration
    {
        public TextAsset SolanaSchema, SessionSchema;
        public string BaseUri, RouterUri, ExpectedGenesis;
        [NonSerialized] public MoneyClientServices Services;
        [NonSerialized] public Func<long> Clock;
    }

    public sealed class MoneyIdentity : AppIdentity
    {
        public MoneyConfiguration Configuration = new MoneyConfiguration();
        public MoneyAppAdapter Controller { get; private set; }
        private HttpClientJsonRpc http;
        private MoneyAppFlow flow;
        public override void Open(AppStartup startup)
        {
            var clock = Configuration.Clock ?? (() => DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            var services = Configuration.Services;
            if (services == null)
            {
                http = new HttpClientJsonRpc();
                var native = new AndroidWalletTransport();
                string directory = Path.Combine(Application.persistentDataPath, "campaign");
                services = new MoneyClientServices(Configuration.SolanaSchema?.text, Configuration.SessionSchema?.text,
                    new MoneyConnectionConfig(Configuration.BaseUri, Configuration.RouterUri, Configuration.ExpectedGenesis),
                    http, native, native, clock, owner => {
                        string path = Path.Combine(directory, owner + ".json");
                        return new LocalProductStore(_ => AtomicProductFile.Read(path),
                            (_, value) => AtomicProductFile.Write(path, value), owner);
                    });
#if !UNITY_ANDROID || UNITY_EDITOR
                throw new PlatformNotSupportedException("Wallet support requires the Android money application.");
#endif
            }
            flow = new MoneyAppFlow(services);
            Controller = gameObject.AddComponent<MoneyAppAdapter>();
            Controller.Initialize(flow, services.Identity, startup.Configuration.DisplayFont, startup.Configuration.BodyFont,
                clock, startup.TextScale, startup.DisplayDensity);
            Controller.AttachRunHost(gameObject.AddComponent<MoneyBoardHost>());
        }
        public override string UnavailableMessage(Exception error) => error is MoneyConfigurationException ?
            "Network configuration is unavailable." : error is PlatformNotSupportedException ?
            "Wallet support requires the Android money application." : "The application could not start.";
        public override async Task Close()
        {
            Exception failure = null;
            try { Controller?.Detach(); }
            catch (Exception error) { failure = error; }
            try { if (flow != null) await flow.StopAsync(); }
            catch (Exception error) { failure = failure == null ? error : new AggregateException(failure, error); }
            finally { http?.Dispose(); http = null; }
            if (failure != null) throw failure;
        }
    }
}
