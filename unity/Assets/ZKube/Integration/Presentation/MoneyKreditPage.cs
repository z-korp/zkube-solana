using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyRead<MoneyKreditState> kreditRead;
        private bool browsingKredits, economyActionPending, economyReadbackNeeded;
        public bool BrowsingKredits => browsingKredits;
        public bool EconomyActionPending => economyActionPending;

        public Task OpenKredits() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingKredits = true;
            await RefreshKreditPage(epoch, token);
        });

        private void CloseKreditView() { ClearKreditObservation(); browsingKredits = false; }
        private void ClearKreditObservation() { kreditRead = null; pageNotice = null; Present(); }
        private async Task RefreshKreditPage(long epoch, CancellationToken token)
        {
            ClearKreditObservation();
            if (identity.Owner == null) { CloseKreditView(); return; }
            Notice("Checking your Kredit balance…"); Status = "Checking Kredits…";
            var result = await Flow.RefreshKredits(token);
            if (!Current(epoch) || !browsingKredits) return;
            kreditRead = result; economyReadbackNeeded = false; pageNotice = null;
            if (result.Value.PreviousOperation != null) ShowReceipt(result.Value.PreviousOperation, identity.Owner);
            Present(); Status = "Kredits updated";
        }
        private void RefreshKreditIdentity()
        {
            if (economyReadbackNeeded && browsingKredits && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingKredits || kreditRead == null || kreditRead.IsCurrent) return;
            ClearKreditObservation(); Notice("Your balance changed. Refresh before buying Kredits.");
            Status = "Kredits need refreshing";
        }
        private bool CanBuyKredits() => browsingKredits && !Busy && !sessionActionPending && !economyActionPending &&
            !paused && !detached && isActiveAndEnabled && kreditRead != null && kreditRead.IsCurrent && kreditRead.Value.Pending == null;

        public static string KreditPurchaseLabel(uint pack) => "Buy " + pack + (pack == 1 ? " Kredit" : " Kredits") + " · " + Price(pack);
        private static string Price(uint pack) => (pack * (decimal)Protocol.EntryLamports / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL";
        public Task PurchaseKredits(uint pack)
        {
            if (!CanBuyKredits() || !SessionViewPolicy.KreditPacks.Contains(pack)) return Task.CompletedTask;
            return Run(async (epoch, token) => {
                economyActionPending = true; Present();
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
                    if (Current(epoch)) Present(); else economyReadbackNeeded = true;
                }
            });
        }

        // The shop: the confirmed balance, then one unit price and its packs, or
        // what stands before buying: a request still finishing, a pending
        // transaction to check, or a wallet request that did not open.
        private PanelPageView KreditPage()
        {
            var back = PageAction("Back", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            var page = new PanelPageView { Key = "Kredits", Title = "Kredits", Subtitle = "arena", Back = back, Tab = 1 };
            var arcade = PageAction("Back to Arcade", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            var refresh = PageAction("Refresh balance", () => _ = RefreshOverview(), () => PageAvailable() && !Busy, "Refresh Kredits");
            var blocks = new List<PanelBlock>();
            if (kreditRead == null)
            {
                var receipt = LastReceipt;
                if (failure != null && !Busy && receipt?.Outcome == ExecutionOutcome.ConfirmedSuccess && receiptFamily == "Kredits")
                {
                    // A confirmed purchase whose balance could not be read back keeps its receipt.
                    page.Blocks = new[] {
                        PanelBlock.Card("Operation card", PanelBlock.Title(MoneyReceiptText.Title(receipt), 27, gap: 16),
                            PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt, fullReceipt), 16, gap: 0)),
                        PanelBlock.Card("Balance card", PanelBlock.Title("Balance unavailable", 23, gap: 14),
                            PanelBlock.Text("Balance failure", "The latest balance could not be read. Your confirmed receipt is retained.", 16, gap: 0)),
                        PanelBlock.Button(refresh, true, lead: 12), PanelBlock.Button(arcade, false) };
                    return page;
                }
                var waiting = Waiting("Kredits", page.Title, page.Subtitle, 1, pageNotice);
                waiting.Back = back; return waiting;
            }
            var state = kreditRead.Value;
            blocks.Add(PanelBlock.Card("Balance card", PanelBlock.Figure("Kredit balance", "Confirmed balance",
                state.Profile.Kredits.ToString(CultureInfo.InvariantCulture), 48, "Kredits", SkinSlots.IconKredit, gap: 0)));
            if (economyActionPending || sessionActionPending)
            {
                blocks.Add(PanelBlock.Card("Kredit notice", PanelBlock.Title("Wallet request open", 25, gap: 14),
                    PanelBlock.Text("Kredit notice text", "Your wallet request is still finishing.", 16, gap: 0)));
                blocks.Add(DisconnectButton());
            }
            else if (state.Pending != null)
            {
                blocks.Add(PanelBlock.Card("Kredit notice", PanelBlock.Title("Purchase pending", 27, gap: 18),
                    PanelBlock.Text("Kredit notice text", "Your confirmed balance has not changed. Check your pending transaction before buying more Kredits.", 16, gap: 0)));
                blocks.Add(PanelBlock.Button(PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy), true, lead: 20));
                blocks.Add(PanelBlock.Button(arcade, false));
            }
            else if (failure != null && walletFailure)
            {
                blocks.Add(PanelBlock.Card("Kredit notice", PanelBlock.Text("Kredit rate", "1 Kredit = " + Price(1), 20, SkinTokens.Accent, 30, true),
                    PanelBlock.Icon(SkinSlots.IconKredit, 56, SkinTokens.TextMuted, 24),
                    PanelBlock.Title("Purchase unavailable", 23, gap: 20, centered: true),
                    PanelBlock.Text("Kredit notice text", failure + " Your confirmed balance is unchanged.", 15, gap: 0)));
                blocks.Add(PanelBlock.Button(PageAction("Try again", () => { failure = null; walletFailure = false; Present(); }, () => PageAvailable() && !Busy), true, lead: 20));
            }
            else
            {
                var packs = new List<PanelBlock> { PanelBlock.Text("Kredit rate", "1 Kredit = " + Price(1), 20, SkinTokens.Accent, 24, true) };
                bool first = true;
                foreach (uint pack in SessionViewPolicy.KreditPacks)
                {
                    uint selected = pack;
                    packs.Add(PanelBlock.Button(PageAction(KreditPurchaseLabel(pack), () => _ = PurchaseKredits(selected), CanBuyKredits), first, 20));
                    first = false;
                }
                blocks.Add(PanelBlock.Card("Pack card", packs.ToArray()));
            }
            blocks.Add(PanelBlock.Card("Wallet card", PanelBlock.Eyebrow("Approved by your wallet", gap: 12),
                PanelBlock.Text("Kredit terms", "One Kredit enters one Daily. Your wallet shows transaction fees and any setup rent before you approve.", 15, gap: 14),
                PanelBlock.Text("Kredit limits", "Kredits cannot be transferred, withdrawn or exchanged back for SOL.", 13, SkinTokens.TextMuted, gap: 0)));
            var row = ReceiptRow("Kredits");
            if (row != null) blocks.Insert(1, row);
            page.Blocks = blocks.ToArray();
            return page;
        }
    }
}
