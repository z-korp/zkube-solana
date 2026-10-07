using System;
using System.Collections;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Integration.Presentation;
using ZKube.Core.Generated;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The Arena's landing page and its boards page, from the Arena's own reads.
    public sealed partial class MoneyOverviewTests
    {
        // The buttons inside the Daily card, less the Kredit figure: the card's one action.
        private string[] DailyActions()
        {
            var card = SkinUi.ScreenRect(host.GetComponentsInChildren<Image>().Single(image => image.name == "Daily card").rectTransform);
            return host.GetComponentsInChildren<Button>().Where(button => button.name != "Kredits" &&
                card.Contains(SkinUi.ScreenRect((RectTransform)button.transform).center)).Select(button => button.name).ToArray();
        }
        private IEnumerator LandingBoards()
        {
            float until = Time.realtimeSinceStartup + 10;
            while (!Offers("Open Score board") && !Says("Boards not loaded.") && Time.realtimeSinceStartup < until) yield return null;
            yield return Idle();
        }

        // The Daily card's one action is the player's next step: connect, the
        // Campaign before launch, the device, the run in flight, the entry.
        [UnityTest] public IEnumerator TheLandingsOneActionIsThePlayersNextStep()
        {
            // The action wears its own icon, in its lit picture on the lit button: the play triangle only where it plays.
            foreach (var (scenario, connect, action, kredits, icon) in new[] {
                ("public-disconnected", false, "Connect", false, SkinSlots.IconWallet), ("arena-not-open", true, "Play Campaign", false, SkinSlots.IconPlay),
                ("public-disconnected", true, "Set up device", true, SkinSlots.IconDevice), ("owner-overview", true, "Resume run", true, SkinSlots.IconPlay),
                ("daily-playable", true, "Enter · 1 Kredit", true, SkinSlots.IconPlay) })
            {
                yield return PrepareScenario(scenario);
                if (connect) { Click("Connect"); yield return Idle(); }
                CollectionAssert.AreEqual(new[] { action }, DailyActions(), scenario + ": the one action");
                Assert.That(Find(action).GetComponentsInChildren<Image>().Single(image => image.name.EndsWith(" icon")).sprite.name, Does.StartWith(SkinSlots.OnLit(icon)),
                    scenario + ": the action's own icon");
                Assert.That(Offers("Kredits"), Is.EqualTo(kredits), scenario + ": the Kredit figure");
                Assert.That(Offers("Rewards") || Offers("View result") || Says("Last operation") ||
                    host.GetComponentsInChildren<Image>().Any(image => image.name == "Last run card"), Is.False, scenario + ": nothing of the old page");
                Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
                yield return EndScenario();
            }
        }

        // The deposit's top-up happens where it is tapped (owner, 2026-10-06): the card says what the
        // deposit holds against what an entry needs, apart from the Kredits; the tap asks the wallet
        // from this page with the tapped button as its loader, and once it lands the card reads again
        // and its button is Enter. A top-up that does not go through leaves its reason and a retry here.
        [UnityTest] public IEnumerator TheTopUpHappensOnTheCardItIsTappedOnAndTheButtonBecomesEnter()
        {
            yield return PrepareScenario("daily-playable"); environment.RunDownDeposit(); Click("Connect"); yield return Idle();
            var views = host.GetComponent<PageViews>();
            CollectionAssert.AreEqual(new[] { "Top up deposit" }, DailyActions(), "The deposit is the next step");
            Assert.That(ulong.Parse(Text("Kredit figure number")), Is.GreaterThan(0), "There are Kredits: the deposit is another thing");
            string figures = Text("Daily deposit");
            Assert.That(System.Text.RegularExpressions.Regex.Matches(figures, System.Text.RegularExpressions.Regex.Escape(CurrencyMark.Tag)).Count, Is.EqualTo(2),
                "What the device holds and what an entry needs, both in SOL: " + figures);
            var hold = environment.HoldNextWallet();
            Click("Top up deposit"); yield return Wait(hold.Entered); yield return null; yield return null;
            Assert.That(views.Shown, Is.EqualTo(AppPage.Home), "The request shows on the page it was tapped on"); Assert.That(views.ShownPanel, Is.Null);
            CollectionAssert.AreEqual(new[] { "Action progress" }, DailyActions(), "The tapped button is the loader");
            hold.Release(); yield return Idle();
            Assert.That(environment.SentSignature, Is.Not.Null, "The top-up was sent");
            Assert.That(views.Shown, Is.EqualTo(AppPage.Home)); Assert.That(views.ShownPanel, Is.Null);
            CollectionAssert.AreEqual(new[] { "Enter · 1 Kredit" }, DailyActions(), "It landed: the card read again and the button is Enter");
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Daily deposit"), Is.False, "The deposit is no longer the reason");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
            yield return EndScenario();

            // Not approved: the reason stays on the card, with the retry on its button.
            yield return PrepareScenario("daily-playable"); environment.RunDownDeposit(); Click("Connect"); yield return Idle();
            Refuse("Daily"); yield return Idle();
            Assert.That(Text("Daily reason"), Is.EqualTo("Not approved in your wallet."));
            CollectionAssert.AreEqual(new[] { "Try again" }, DailyActions());
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Home));
            yield return EndScenario();

            // The Boards page's Top up deposit does the same there: the page stays and reads again when it lands.
            yield return PrepareScenario("claim-score-sealed"); environment.RunDownDeposit(0); Click("Connect"); yield return Idle();
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay, "score")); yield return Idle();
            views = host.GetComponent<PageViews>();
            Assert.That(Offers("Top up deposit"), Is.True, "A claim is the device's transaction: its deposit comes first");
            hold = environment.HoldNextWallet();
            Click("Top up deposit"); yield return Wait(hold.Entered); yield return null; yield return null;
            Assert.That(views.ShownPanel, Is.EqualTo("Boards"), "The request shows on the page it was tapped on");
            Assert.That(Offers("Action progress"), Is.True, "The tapped button is the loader");
            hold.Release(); yield return Idle();
            Assert.That(environment.SentSignature, Is.Not.Null, "The top-up was sent");
            Assert.That(views.ShownPanel, Is.EqualTo("Boards")); Assert.That(Offers("Top up deposit"), Is.False, "It landed: the page read again and the deposit is no longer its step");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Today's boards arrive beside the Daily, from the chain: each column
        // opens its board, and the page asks the read model nothing. A failed
        // boards read says so in its card and leaves the Daily's action working.
        [UnityTest] public IEnumerator TheLandingShowsTodaysBoardsAndEachReadStandsAlone()
        {
            yield return PrepareScenario("daily-playable"); Click("Connect"); yield return Idle();
            yield return LandingBoards();
            Assert.That(Offers("Open Score board"), Is.True);
            // The player appears once in a column: lit among the rows shown, or pinned under them, never both.
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Count(text => text.name.StartsWith("Score board ") && text.name.EndsWith(" player") && text.text == "You"),
                Is.LessThanOrEqualTo(1), "The player's own row, once");
            CollectionAssert.AreEqual(new[] { "Enter · 1 Kredit" }, DailyActions());
            Set("landingBoardsFailed", true); Redraw(); yield return Idle();
            Assert.That(Says("Boards not loaded."), Is.True); Assert.That(Offers("Reload boards"), Is.True);
            CollectionAssert.AreEqual(new[] { "Enter · 1 Kredit" }, DailyActions(), "The Daily's action works without the boards");
            yield return SessionClick("Reload boards"); yield return LandingBoards();
            Assert.That(Offers("Open Score board"), Is.True, "The retry reads the boards again");
            yield return SessionClick("Open Score board"); yield return Idle();
            Assert.That(Adapter.BrowsingRewards, Is.True); Assert.That(Adapter.BoardKind, Is.EqualTo("score"));
            Assert.That(Adapter.RewardDay, Is.EqualTo(ZKube.Core.NativeEngine.DayAt(environment.Clock())));
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // A reward waiting on a sealed day shows as the badge on the boards card,
        // and the badge opens that day's board.
        [UnityTest] public IEnumerator ARewardToClaimShowsAsTheBadgeThatOpensItsBoard()
        {
            yield return PrepareScenario("claim-score-sealed"); Click("Connect"); yield return Idle();
            float until = Time.realtimeSinceStartup + 10;
            while (!Offers("Rewards to claim") && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(Offers("Rewards to claim"), Is.True);
            StringAssert.EndsWith(" to claim", host.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Rewards badge words").text);
            yield return SessionClick("Rewards to claim"); yield return Idle();
            Assert.That(Adapter.BrowsingRewards, Is.True); Assert.That(Adapter.RewardDay, Is.EqualTo(environment.ClaimDay));
            Assert.That(Offers("Collect Score"), Is.True, "The claim sits on the board the badge opened");
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // The stepper shows every calendar day and never a day after today; a
        // sealed day shows its paying rows with their payouts, a day not sealed
        // yet its rows as the chain holds them, without payouts.
        [UnityTest] public IEnumerator TheBoardsPageStepsThroughDaysAndReadsEachKindOfDay()
        {
            yield return PrepareClaimPage("claim-score-sealed");
            bool Payouts() => host.GetComponentsInChildren<TMP_Text>().Any(text => text.name.StartsWith("Board rows row ") && text.name.EndsWith(" payout"));
            Assert.That(Says("Sealed"), Is.True); Assert.That(Payouts(), Is.True, "A sealed board's rows carry their payouts");
            Assert.That(host.GetComponentsInChildren<Image>().Any(image => image.name == "Day state mark"), Is.False, "Only a live day is lit");
            StringAssert.Contains("claim by", Text("Your row row detail"));
            // The card says what the rows do not: the rank and the claim. The score is on the player's row, lit in the list, once.
            int Mine() => host.GetComponentsInChildren<TMP_Text>().Count(text => text.name.StartsWith("Board rows row ") && text.name.EndsWith(" player") && text.text == "You");
            Assert.That(Text("Your row"), Does.Match("^#[0-9,]+$")); Assert.That(Mine(), Is.EqualTo(1));
            uint today = ZKube.Core.NativeEngine.DayAt(environment.Clock());
            while (Adapter.RewardDay < today) { yield return SessionClick("Next day"); yield return Idle(); }
            Assert.That(Find("Next day").interactable, Is.False, "No day after today");
            Assert.That(Payouts(), Is.False, "Today's board has no payout yet");
            yield return SessionClick("Previous day"); yield return Idle();
            Assert.That(Adapter.RewardDay, Is.EqualTo(today - 1));
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
            yield return EndScenario();

            yield return PrepareClaimPage("claim-score-unsealed");
            Assert.That(Says("Results pending"), Is.True);
            Assert.That(host.GetComponentsInChildren<Image>().Any(image => image.name.StartsWith("Board rows row ")), Is.True, "The rows as the chain holds them");
            Assert.That(Payouts(), Is.False, "No payouts before the day is sealed");
            // The same boards while their day is still running are live: lit, and still without payouts.
            environment.Now = (long)ZKube.Core.NativeEngine.Daily(environment.ClaimDay).OpensAt + 3600;
            yield return Wait(Adapter.OpenRewards(environment.ClaimDay)); yield return Idle();
            Assert.That(Text("Day state"), Is.EqualTo("Live"));
            Assert.That(host.GetComponentsInChildren<Image>().Any(image => image.name == "Day state mark"), Is.True, "A live day's lit dot");
            Assert.That(Find("Next day").interactable, Is.False, "No day after today"); Assert.That(Payouts(), Is.False);
            Assert.That(Offers("Seal results"), Is.False, "A live day has nothing to seal");
            // A live board holds the player among its top rows: lit there, and no card repeats them.
            Assert.That(host.GetComponentsInChildren<TMP_Text>().Count(text => text.name.StartsWith("Board rows row ") && text.name.EndsWith(" player") && text.text == "You"), Is.EqualTo(1));
            Assert.That(host.GetComponentsInChildren<Transform>().Any(piece => piece.name == "Your row card"), Is.False, "No card over a row already in view");
        }

        // Every kind of day fits both phones: only the rows list scrolls, never
        // the page. Places the board no longer holds stand under their divider,
        // marked unofficial, and more of them open where the reader was.
        [UnityTest] public IEnumerator TheBoardsPageFitsBothPhonesOnEveryKindOfDay()
        {
            IEnumerator Fits(string phone, string name)
            {
                yield return ArenaScreen(phone, "boards " + name);
                var shell = host.GetComponent<PageShell>();
                Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Viewport.rect.height + .5f), phone + " " + name + ": only the rows list scrolls");
                // Nothing to tap in the top band, the one button on the stepper, the stepper on the tab bar, in every kind of day.
                Placement.Check(host.transform, shell.SafeArea, 1, phone + " boards " + name);
                Assert.That(host.GetComponentsInChildren<Button>().Count(button => button.GetComponent<Placed>()?.Role == ScreenKit.Role.Step), Is.EqualTo(2), phone + " " + name + ": the stepper is drawn");
            }
            foreach (string phone in new[] { "Seeker", "360 x 640" })
                foreach (var (variant, name) in new[] { ("sealed", "reward to claim"), ("claimed", "reward claimed"), ("expired", "claim window closed"),
                    ("unsealed", "results pending"), ("missing-session", "needs the device") })
                {
                    yield return PrepareScenario("claim-score-" + variant);
                    var shell = host.GetComponent<PageShell>(); if (phone == "Seeker") Phones.Seeker(shell); else Phones.Compact(shell);
                    yield return Wait(Adapter.RefreshOverview()); yield return Idle();
                    Click("Connect"); yield return Idle();
                    yield return Wait(Adapter.OpenRewards(environment.ClaimDay, "score")); yield return Fits(phone, name);
                    if (variant == "unsealed")
                    {
                        environment.Now = (long)ZKube.Core.NativeEngine.Daily(environment.ClaimDay).OpensAt + 3600;
                        yield return Wait(Adapter.OpenRewards(environment.ClaimDay)); yield return Fits(phone, "live");
                    }
                    if (variant == "sealed")
                    {
                        yield return Wait(Adapter.OpenRewards(environment.ClaimDay - 1)); yield return Fits(phone, "no daily");
                        yield return Wait(Adapter.OpenRewards(environment.ClaimDay, "score")); yield return Idle();
                        // The read model's places, staged on the board the page read.
                        var read = typeof(MoneyAppAdapter).GetField("rewardRead", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(Adapter);
                        var board = ((MoneyRewardState)read.GetType().GetProperty("Value").GetValue(read)).Boards.Score;
                        int paid = board.Rows.Count; ulong last = board.Rows[paid - 1].Metric;
                        var places = Enumerable.Range(1, 70).Select(place => (ZKube.Integration.Transport.PublicStandingRow)Activator.CreateInstance(
                            typeof(ZKube.Integration.Transport.PublicStandingRow), BindingFlags.Instance | BindingFlags.NonPublic, null,
                            new object[] { (uint)(paid + place), (string)environment.Plans["inputs"]["device"], last }, null)).ToArray();
                        typeof(ZKube.Integration.Client.PrizeBoard).GetMethod("WithPublic", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(board, new object[] { places, null });
                        Redraw(); yield return Fits(phone, "below the paid places");
                        Assert.That(Text("Board rows divider"), Is.EqualTo("Below the paid places · unofficial"));
                        int Shown() => host.GetComponentsInChildren<TMP_Text>().Count(text => text.name.StartsWith("Board rows row ") && text.name.EndsWith(" rank"));
                        int before = Shown(); Assert.That(before, Is.LessThan(paid + 70), "The list opens with its first places");
                        Assert.That(host.GetComponentsInChildren<TMP_Text>().Any(text => text.name.StartsWith("Board rows row " + (paid + 1) + " ") && text.name.EndsWith(" payout")), Is.False,
                            "An unofficial place carries no payout");
                        Find("More places").onClick.Invoke(); yield return Idle();
                        Assert.That(Shown(), Is.EqualTo(paid + 70), "More places shows the rest");
                        Assert.That(host.GetComponentsInChildren<Image>().Any(image => image.name == "Board rows row " + (paid + 1)), Is.False, "An unofficial place stands on no plate");
                    }
                    yield return EndScenario();
                }
        }

        // An action in progress shows on its button, step by step: the wallet's
        // turn, the send, the wait for Solana. Its outcome then shows by itself
        // and the button is the page's own again.
        [UnityTest] public IEnumerator AnActionShowsEachStepOnItsButtonUntilItsOutcome()
        {
            yield return PrepareDeviceScenario("session-enable-success");
            string Step() => host.GetComponentsInChildren<Button>().Where(button => button.name == "Action progress")
                .Select(button => button.GetComponentInChildren<TMP_Text>().text).SingleOrDefault();
            IEnumerator Shows(string word) { yield return Until(() => Step() == word, "The button says " + word); }
            var wallet = environment.HoldNextWallet();
            yield return SessionClick("Enable device");
            yield return Wait(wallet.Entered); yield return Shows("Approve in wallet");
            Assert.That(Offers("Enable device"), Is.False, "The loader stands where the action was");
            Assert.That(Find("Action progress").interactable, Is.False);
            Assert.That(host.GetComponentsInChildren<Image>().Count(image => image.name == "Action loader"), Is.EqualTo(1));
            Assert.That(Offers("Disconnect"), Is.True, "The way out stays within reach");
            var send = environment.HoldNextRead("sendTransaction"); wallet.Release();
            yield return Wait(send.Entered); yield return Shows("Sending");
            var status = environment.HoldNextRead("getSignatureStatuses"); send.Release();
            yield return Wait(status.Entered); yield return Shows("Confirming");
            status.Release(); yield return Idle();
            Assert.That(Step(), Is.Null, "The outcome shows by itself");
            Assert.That(Text("Device state"), Is.EqualTo("Session active"));
            Assert.That(Asked("signTransactions"), Is.EqualTo(1)); Assert.That(Asked("sendTransaction"), Is.EqualTo(1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // No page but Last operation, behind Settings, carries a receipt: an
        // action's outcome shows on its own page.
        [UnityTest] public IEnumerator NoPageButLastOperationCarriesAReceipt()
        {
            yield return PrepareDeviceScenario("kredit-buy-10", 1, "Kredits");
            yield return SessionClick(MoneyAppAdapter.KreditPurchaseLabel(10)); yield return Idle();
            Assert.That(Adapter.LastReceipt.Signature, Is.EqualTo(environment.SentSignature));
            bool Receipt() => host.GetComponentsInChildren<Image>().Any(image => image.name == "Receipt card") ||
                host.GetComponentsInChildren<TMP_Text>().Any(text => text.name == "Transaction receipt");
            Assert.That(Receipt(), Is.False, "Kredits");
            yield return Wait(Adapter.OpenDaily()); yield return Idle(); Assert.That(Receipt(), Is.False, "Arena");
            yield return Wait(Adapter.OpenRewards()); yield return Idle(); Assert.That(Receipt(), Is.False, "Boards");
            yield return Wait(Adapter.OpenProfile()); yield return Idle(); Assert.That(Receipt(), Is.False, "Profile");
            yield return Wait(Adapter.OpenSession()); yield return Idle(); Assert.That(Receipt(), Is.False, "This device");
            Adapter.Navigate(AppPage.Settings); yield return Idle(); Assert.That(Receipt(), Is.False, "Settings");
            yield return SessionClick("Last operation"); yield return Idle();
            Assert.That(Receipt(), Is.True, "The one page that shows the receipt");
            yield return Return(); yield return Idle();
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Settings), "The lit tab returns to Settings");
        }
    }
}
