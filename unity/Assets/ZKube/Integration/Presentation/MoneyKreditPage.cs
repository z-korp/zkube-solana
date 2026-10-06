using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using UnityEngine;
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
        }, true);

        private void CloseKreditView() { ClearKreditObservation(); browsingKredits = false; shownKredits = null; kreditGainUntil = 0; actingPack = 0; }
        private void ClearKreditObservation() { kreditRead = null; pageNotice = null; Present(); }
        private async Task RefreshKreditPage(long epoch, CancellationToken token)
        {
            ClearKreditObservation();
            if (identity.Owner == null) { CloseKreditView(); return; }
            Notice("Checking your Kredit balance…"); Status = "Checking Kredits…";
            var result = await Flow.RefreshKredits(token);
            if (!Current(epoch) || !browsingKredits) return;
            kreditRead = result; economyReadbackNeeded = false; pageNotice = null; AwaitLaunch(result.Value.Launched);
            // A balance that grew while the page was open shows its gain for a moment.
            ulong balance = result.Value.Profile.Kredits;
            if (shownKredits.HasValue && balance > shownKredits.Value) { kreditsBefore = shownKredits.Value; kreditGainUntil = Time.unscaledTime + KreditGainSeconds; }
            shownKredits = balance;
            if (result.Value.PreviousOperation != null) ShowReceipt(result.Value.PreviousOperation, identity.Owner);
            Present(); Status = "Kredits updated";
        }
        private void RefreshKreditIdentity()
        {
            if (economyReadbackNeeded && browsingKredits && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            // The gain has shown: the page settles to its plain balance.
            if (browsingKredits && kreditGainUntil > 0 && Time.unscaledTime >= kreditGainUntil) { kreditGainUntil = 0; Present(); }
            if (!browsingKredits || kreditRead == null || kreditRead.IsCurrent) return;
            ClearKreditObservation();
        }
        private bool CanBuyKredits() => browsingKredits && !Busy && !sessionActionPending && !economyActionPending &&
            !paused && !detached && isActiveAndEnabled && kreditRead != null && kreditRead.IsCurrent && kreditRead.Value.Pending == null && kreditRead.Value.Launched;

        public static string KreditPurchaseLabel(uint pack) => "Buy " + pack + (pack == 1 ? " Kredit" : " Kredits") + " · " + Price(pack);
        private static string Price(uint pack) => MoneyText.Sol(checked(pack * (ulong)Protocol.EntryLamports));
        // The pack whose purchase is in progress or did not go through, for its card.
        private uint actingPack;
        // A balance that just grew on this page: what it was, until the gain has shown.
        private ulong? shownKredits;
        private ulong kreditsBefore;
        private float kreditGainUntil;
        public const float KreditGainSeconds = 2.5f;
        public Task PurchaseKredits(uint pack)
        {
            if (!CanBuyKredits() || !SessionViewPolicy.KreditPacks.Contains(pack)) return Task.CompletedTask;
            actingPack = pack;
            return Act("kredit purchase", false, async token => (await Flow.BuyKredits(pack, token)).Value, RefreshKreditPage, () => _ = PurchaseKredits(pack));
        }

        // The shop: the confirmed balance as the page's hero with what it means,
        // then the packs as three equal cards. A purchase lives on the card that
        // was tapped: its progress, its reason and its retry. No pack is marked,
        // discounted or pushed, and the one-way rule stays in view.
        private PanelPageView KreditPage()
        {
            var back = PageAction(null, () => _ = OpenDaily(), PageAvailable);
            var page = new PanelPageView { Key = "Kredits", Title = "Kredits", Back = back, Tab = AppPage.Home };
            var terms = PanelBlock.Text("Kredit terms", "Kredits can’t be withdrawn, transferred or exchanged.", SkinTokens.TextMuted, true);
            PackView[] Cards(Func<uint, PackView> card) => SessionViewPolicy.KreditPacks.Select(card).ToArray();
            PackView Plain(uint pack) => new PackView { Name = "Pack " + pack, Art = pack == 1 ? SkinSlots.Pack1 : pack == 10 ? SkinSlots.Pack10 : SkinSlots.Pack25,
                Count = pack.ToString(CultureInfo.InvariantCulture), Price = Price(pack), Dim = true };
            if (kreditRead == null)
            {
                // The balance is being read, or could not be: the loader stands for the figure, and a failed read says why.
                bool failed = failure != null && !Busy;
                var waiting = new List<PanelBlock> { PanelBlock.Space(), PanelBlock.Balance(null, null, null, failed ? "Balance not loaded." : pageNotice ?? "Reading your balance") };
                waiting.Add(PanelBlock.PackRow(Cards(Plain), failed ? failure : null));
                if (failed) page.Primary = PageAction("Try again", () => _ = RefreshOverview(), () => PageAvailable() && !Busy, icon: SkinSlots.IconRetry);
                waiting.Add(terms);
                page.Key = "Kredits waiting"; page.Blocks = waiting.ToArray();
                return page;
            }
            var state = kreditRead.Value; ulong balance = state.Profile.Kredits;
            string figure = balance.ToString(CultureInfo.InvariantCulture), entries = balance == 1 ? "1 entry" : figure + " entries";
            // The hero and the packs sit in the middle of the page, with air round them.
            var blocks = new List<PanelBlock> { PanelBlock.Space() };
            if (!state.Launched)
            {
                blocks.Add(PanelBlock.Balance(figure, null, null, "The Arena opens soon."));
                blocks.Add(PanelBlock.PackRow(Cards(Plain)));
                // Before launch the one step is the Campaign, lit, as on the device page.
                page.Primary = PageAction("Play Campaign", () => _ = OpenCampaign(), () => PageAvailable(), icon: SkinSlots.IconPlay);
                blocks.Add(terms); page.Blocks = blocks.ToArray();
                return page;
            }
            bool acting = economyActionPending || sessionActionPending, pending = state.Pending != null, waits = acting || pending;
            string refused = RefusalOn("Kredits");
            // Without the card it belongs to (a purchase found on arrival), the progress stands on the balance.
            bool known = SessionViewPolicy.KreditPacks.Contains(actingPack), onBalance = waits && !known && refused == null;
            bool gained = Time.unscaledTime < kreditGainUntil && balance > kreditsBefore;
            blocks.Add(onBalance ? PanelBlock.Balance(null, null, null, "Confirming your purchase")
                : PanelBlock.Balance(figure, entries, Price(1), null, gained ? "+" + (balance - kreditsBefore).ToString(CultureInfo.InvariantCulture) : null,
                    gained ? kreditsBefore.ToString(CultureInfo.InvariantCulture) : null));
            var cards = Cards(pack => {
                var card = Plain(pack); bool own = known && pack == actingPack;
                if (refused != null && own)
                { card.Dim = false; card.Refused = true; card.Price = "Try again"; card.Buy = PageAction("Try again", refusalRetry, () => PageAvailable() && !Busy); }
                else if (waits && refused == null) { if (own) { card.Dim = false; card.Buy = Progressing(); card.Price = card.Buy.Label; } }
                else { card.Dim = false; uint selected = pack; card.Buy = PageAction(Price(pack), () => _ = PurchaseKredits(selected), CanBuyKredits, KreditPurchaseLabel(pack)); }
                return card;
            });
            int from = gained ? Array.IndexOf(SessionViewPolicy.KreditPacks.ToArray(), (uint)(balance - kreditsBefore)) : -1;
            blocks.Add(PanelBlock.PackRow(cards, refused ?? (slow && waits ? StillChecking : null), refused == null, from));
            // The page's own buttons are the foot row's; the packs are its choices and it has no primary of its own.
            // A refusal with no card to stand on (a follow that failed) keeps its retry.
            if (refused != null && !known) page.Primary = PageAction("Try again", refusalRetry, () => PageAvailable() && !Busy, icon: SkinSlots.IconRetry);
            // The owner's wallet buys; an entry needs the device too.
            if (!waits && ownerRead != null && ownerRead.IsCurrent && ownerRead.Value.Session != null && ownerRead.Value.Session.Status == "none")
                page.Tertiary = PageAction("Set up device", () => _ = OpenSession(), () => PageAvailable() && !Busy, icon: SkinSlots.IconDevice);
            if (acting && (actionStep == "wallet" || actionStep == null)) page.Destructive = Disconnecting();
            blocks.Add(terms);
            page.Blocks = blocks.ToArray();
            return page;
        }
    }
}
