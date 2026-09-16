using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private RectTransform kreditPanel;
        private MoneyRead<MoneyKreditState> kreditRead;
        private bool browsingKredits, economyActionPending, economyReadbackNeeded;
        public bool BrowsingKredits => browsingKredits;
        public bool EconomyActionPending => economyActionPending;

        public Task OpenKredits() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingKredits = true;
            overviewPanel.gameObject.SetActive(false);
            await RefreshKreditPage(epoch, token);
        });

        private void CloseKreditView()
        {
            ClearKreditObservation(); browsingKredits = false;
            if (overviewPanel != null) overviewPanel.gameObject.SetActive(true);
        }
        private void ClearKreditObservation()
        {
            kreditRead = null;
            if (kreditPanel != null) { kreditPanel.gameObject.SetActive(false); Destroy(kreditPanel.gameObject); kreditPanel = null; }
        }
        private async Task RefreshKreditPage(long epoch, CancellationToken token)
        {
            ClearKreditObservation();
            if (identity.Owner == null) { CloseKreditView(); return; }
            DrawKreditNotice("Checking your Kredit balance…"); status.text = "Checking Kredits…";
            var result = await Flow.RefreshKredits(token);
            if (!Current(epoch) || !browsingKredits) return;
            kreditRead = result; economyReadbackNeeded = false;
            if (result.Value.PreviousOperation != null) ShowReceipt(result.Value.PreviousOperation, identity.Owner);
            DrawKredits(); status.text = "Kredits updated";
        }
        private void RefreshKreditIdentity()
        {
            if (economyReadbackNeeded && browsingKredits && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingKredits || kreditRead == null || kreditRead.IsCurrent) return;
            ClearKreditObservation(); DrawKreditNotice("Your balance changed. Refresh before buying Kredits.");
            status.text = "Kredits need refreshing";
        }
        private bool CanBuyKredits() => browsingKredits && !Busy && !sessionActionPending && !economyActionPending &&
            !paused && !detached && isActiveAndEnabled && kreditRead != null && kreditRead.IsCurrent && kreditRead.Value.Pending == null;

        private void BeginKreditPanel()
        {
            ReplacePagePanel(ref kreditPanel, "Kredit shop");
            Label(kreditPanel, "Kredits", 32, true);
        }
        private void KreditNavigation()
        {
            Button(kreditPanel, "Refresh Kredits", () => _ = RefreshOverview());
            shared.Navigation(kreditPanel);
        }
        private void DrawKreditNotice(string message)
        { BeginKreditPanel(); Label(kreditPanel, message, 20, false); KreditNavigation(); }
        private void DrawKredits()
        {
            var state = kreditRead.Value;
            BeginKreditPanel();
            Label(kreditPanel, "Balance · " + state.Profile.Kredits, 28, true);
            Label(kreditPanel, "One Kredit enters one Daily. Your wallet approves every purchase.", 20, false);
            Label(kreditPanel, "Kredits cannot be transferred, withdrawn or exchanged back for SOL.", 18, false);
            if (economyActionPending || sessionActionPending)
                Label(kreditPanel, "Your wallet request is still finishing.", 20, false);
            else if (state.Pending != null)
            {
                Label(kreditPanel, "Check your pending transaction before buying more Kredits.", 20, false);
                Button(kreditPanel, "Check transaction", () => _ = CheckTransaction());
            }
            else
            {
                Label(kreditPanel, "Transaction fees and any account setup rent are shown by your wallet.", 18, false);
                foreach (uint pack in SessionViewPolicy.KreditPacks)
                {
                    uint selected = pack;
                    Button(kreditPanel, KreditPurchaseLabel(pack), () => _ = PurchaseKredits(selected));
                }
            }
            KreditNavigation(); Controls();
        }
        public static string KreditPurchaseLabel(uint pack) => "Buy " + pack + (pack == 1 ? " Kredit" : " Kredits") + " · " +
            (pack * (decimal)Protocol.EntryLamports / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL";
        public Task PurchaseKredits(uint pack)
        {
            if (!CanBuyKredits() || !SessionViewPolicy.KreditPacks.Contains(pack)) return Task.CompletedTask;
            return Run(async (epoch, token) => {
                economyActionPending = true; DrawKredits();
                try
                {
                    var result = await Flow.BuyKredits(pack, token);
                    if (!Current(epoch)) return;
                    ShowReceipt(result.Value, identity.Owner);
                    await RefreshKreditPage(epoch, token);
                }
                finally
                {
                    economyActionPending = false;
                    if (Current(epoch)) { if (kreditRead != null && kreditRead.IsCurrent) DrawKredits(); Controls(); }
                    else economyReadbackNeeded = true;
                }
            });
        }
        private void KreditControls(bool available)
        {
            if (kreditPanel == null) return;
            foreach (var button in kreditPanel.GetComponentsInChildren<Button>(true))
                button.interactable = available && (button.name == "Disconnect" || (!Busy &&
                    (!button.name.StartsWith("Buy ") || CanBuyKredits())));
        }
    }
}
