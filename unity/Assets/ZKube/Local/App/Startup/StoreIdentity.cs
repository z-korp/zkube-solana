using System;
using System.IO;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Local.Billing;
using ZKube.Persistence;
using ZKube.Presentation;

namespace ZKube.Local.App
{
    public sealed class StoreIdentity : AppIdentity
    {
        private CampaignBilling billing;
        public override void Open(AppStartup startup)
        {
            string path = Path.Combine(Application.persistentDataPath, "local", LocalProductCodec.StorageKey + ".json");
            var product = new LocalProductStore(_ => AtomicProductFile.Read(path), (_, value) => AtomicProductFile.Write(path, value));
            var runs = new StoreRunClient(product, () => DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            billing = new CampaignBilling(new UnityCampaignStoreDriver(),
                () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated),
                runs.ApplyCampaignEntitlement);
            var board = new GameObject("Store board", typeof(BoardController)).GetComponent<BoardController>();
            board.transform.SetParent(transform, false);
            // The platform's player account: Google Play Games on an Android device, none elsewhere.
            IPlayerAccounts accounts = Application.platform == RuntimePlatform.Android ? new PlayGamesAccounts() : (IPlayerAccounts)new NoPlayerAccounts();
            gameObject.AddComponent<StoreAppAdapter>().Initialize(product, runs, billing, board, accounts);
        }
        public override Task Close() { billing?.Dispose(); billing = null; return Task.CompletedTask; }
    }
}
