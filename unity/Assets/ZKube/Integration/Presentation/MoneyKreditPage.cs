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
            kreditRead = result; economyReadbackNeeded = false; pageNotice = null; AwaitLaunch(result.Value.Launched);
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
            !paused && !detached && isActiveAndEnabled && kreditRead != null && kreditRead.IsCurrent && kreditRead.Value.Pending == null && kreditRead.Value.Launched;

        public static string KreditPurchaseLabel(uint pack) => "Buy " + pack + (pack == 1 ? " Kredit" : " Kredits") + " · " + Price(pack);
        private static string Price(uint pack) => MoneyText.Sol(checked(pack * (ulong)Protocol.EntryLamports));
        public Task PurchaseKredits(uint pack)
        {
            if (!CanBuyKredits() || !SessionViewPolicy.KreditPacks.Contains(pack)) return Task.CompletedTask;
            return Act("kredit purchase", false, async token => (await Flow.BuyKredits(pack, token)).Value, RefreshKreditPage, () => _ = PurchaseKredits(pack));
        }

        // The shop: the confirmed balance, then one unit price and its packs, or
        // what stands before buying: a request still finishing, a pending
        // transaction to check, or a purchase that did not go through.
        private PanelPageView KreditPage()
        {
            var back = PageAction("Back", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            var page = new PanelPageView { Key = "Kredits", Title = "Kredits", Subtitle = "One Kredit enters one Daily", Back = back, Tab = AppPage.Home };
            var arcade = PageAction("Back to Arena", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            var refresh = PageAction("Refresh balance", () => _ = RefreshOverview(), () => PageAvailable() && !Busy, "Refresh Kredits");
            var blocks = new List<PanelBlock>();
            if (kreditRead == null)
            {
                var receipt = LastReceipt;
                if (failure != null && !Busy && receipt?.Outcome == ExecutionOutcome.ConfirmedSuccess && receiptFamily == "Kredits")
                {
                    // A confirmed purchase whose balance could not be read back keeps its receipt.
                    page.Blocks = new[] {
                        PanelBlock.Card("Operation card", PanelBlock.Title(MoneyReceiptText.Title(receipt)),
                            PanelBlock.Text("Transaction receipt", MoneyReceiptText.Describe(receipt, fullReceipt))),
                        PanelBlock.Card("Balance card", PanelBlock.Title("Balance unavailable"),
                            PanelBlock.Text("Balance failure", "The latest balance could not be read. Your confirmed receipt is retained.")),
                        PanelBlock.Button(refresh, true), PanelBlock.Button(arcade, false) };
                    return page;
                }
                var waiting = Waiting("Kredits", page.Title, page.Subtitle, AppPage.Home, pageNotice);
                waiting.Back = back; return waiting;
            }
            var state = kreditRead.Value;
            if (!state.Launched) { page.Blocks = OpensSoon(); return page; }
            blocks.Add(PanelBlock.Card("Balance card", PanelBlock.Figure("Kredit balance", "Confirmed balance",
                state.Profile.Kredits.ToString(CultureInfo.InvariantCulture), "Kredits", SkinSlots.IconKredit)));
            if (economyActionPending || sessionActionPending) Requesting(blocks);
            else if (state.Pending != null)
            {
                blocks.Add(PanelBlock.Card("Kredit notice", PanelBlock.Title("Purchase pending"),
                    PanelBlock.Text("Kredit notice text", RefusalOn("Kredits") ?? Confirming)));
                if (RefusalOn("Kredits") != null) blocks.Add(Retry(() => PageAvailable() && !Busy));
                blocks.Add(PanelBlock.Button(arcade, false));
            }
            else if (!Refused("Kredits", blocks, CanBuyKredits))
            {
                var packs = new List<PanelBlock> { PanelBlock.Eyebrow("Buy Kredits") };
                bool first = true;
                foreach (uint pack in SessionViewPolicy.KreditPacks)
                {
                    uint selected = pack;
                    packs.Add(PanelBlock.Row("Pack " + pack, pack + (pack == 1 ? " Kredit" : " Kredits"), null, icon: SkinSlots.IconKredit, primary: first,
                        action: PageAction(Price(pack), () => _ = PurchaseKredits(selected), CanBuyKredits, KreditPurchaseLabel(pack))));
                    first = false;
                }
                blocks.Add(PanelBlock.Card("Pack card", packs.ToArray()));
            }
            blocks.Add(PanelBlock.Text("Kredit terms", "Kredits cannot be withdrawn, transferred or exchanged for SOL.", SkinTokens.TextMuted));
            var row = ReceiptRow("Kredits");
            if (row != null) blocks.Insert(1, row);
            page.Blocks = blocks.ToArray();
            return page;
        }
    }
}
