using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // The Kredits page as the shared pages draw it: the balance as its hero,
    // three equal pack cards, and a purchase living on the card that was tapped.
    public sealed class KreditPageTests
    {
        private GameObject root;
        private PageShell shell;
        private PageViews views;
        private ArenaLandingSource source;
        [SetUp] public void TaughtEveryLesson() => Lessons.Device = Lessons.Memory(taught: true);
        [UnityTearDown] public IEnumerator TearDown() { if (root != null) UnityEngine.Object.Destroy(root); yield return null; }

        private IEnumerator Open()
        {
            root = new GameObject("Kredits page");
            if (EventSystem.current == null) new GameObject("Input", typeof(EventSystem), typeof(StandaloneInputModule)).transform.SetParent(root.transform);
            shell = root.AddComponent<PageShell>(); shell.Initialize("Kredits page");
            shell.RequestRealm(3);
            while (shell.Loading) yield return null;
            Assert.That(shell.ArtworkError, Is.Null);
            source = new ArenaLandingSource();
            views = root.AddComponent<PageViews>(); views.Initialize(source, shell, "Arena", "arena", 1);
        }
        private static PackView[] Packs(Func<int, PackView, PackView> change = null) =>
            new[] { (1, SkinSlots.Pack1, "0.01 SOL"), (10, SkinSlots.Pack10, "0.10 SOL"), (25, SkinSlots.Pack25, "0.25 SOL") }.Select((pack, index) => {
                var view = new PackView { Name = "Pack " + pack.Item1, Art = pack.Item2, Count = pack.Item1.ToString(), Price = pack.Item3,
                    Buy = new PageAction { Label = pack.Item3, Name = "Buy " + pack.Item1 } };
                return change == null ? view : change(index, view);
            }).ToArray();
        private IEnumerator Draw(params PanelBlock[] blocks)
        {
            var all = blocks.Prepend(PanelBlock.Space()).Append(PanelBlock.Text("Kredit terms", "Kredits can’t be withdrawn, transferred or exchanged.", SkinTokens.TextMuted, true)).ToArray();
            views.RenderPanel(new PanelPageView { Key = "Kredits", Title = "Kredits", Tab = AppPage.Home, Back = new PageAction { Label = "Back", Name = "Back" }, Blocks = all });
            yield return null;
            foreach (var sequence in root.GetComponentsInChildren<PageSequence>()) sequence.Finish();
            yield return null; Canvas.ForceUpdateCanvases();
        }
        private Image[] Named(string name) => root.GetComponentsInChildren<Image>().Where(image => image.name == name).ToArray();
        private Rect Area(string name) => SkinUi.ScreenRect(Named(name).Single().rectTransform);
        private string Words(string name) => root.GetComponentsInChildren<TMP_Text>().Single(text => text.name == name).text;

        // The page fits both phones without scrolling in every state, and its
        // three packs are one size and one style: no badge, no mark, no pack
        // drawn larger or lit, each priced on its own button.
        [UnityTest] public IEnumerator ThePageFitsBothPhonesAndNoPackIsMarkedOrPushed()
        {
            yield return Open();
            var busy = new PageAction { Label = "Approve in wallet", Short = "In wallet", Name = "Action progress", Progress = "Approve in wallet" };
            var states = new (string name, Func<PanelBlock[]> blocks)[] {
                ("at rest", () => new[] { PanelBlock.Balance("12", "12 entries", "0.01 SOL"), PanelBlock.PackRow(Packs()) }),
                ("in progress", () => new[] { PanelBlock.Balance("12", "12 entries", "0.01 SOL"),
                    PanelBlock.PackRow(Packs((index, pack) => { if (index == 1) { pack.Buy = busy; pack.Price = busy.Label; } else { pack.Buy = null; pack.Dim = true; } return pack; })) }),
                ("still checking", () => new[] { PanelBlock.Balance("12", "12 entries", "0.01 SOL"),
                    PanelBlock.PackRow(Packs((index, pack) => { if (index == 1) { pack.Buy = new PageAction { Label = "Confirming", Name = "Action progress", Progress = "Confirming" }; pack.Price = "Confirming"; }
                        else { pack.Buy = null; pack.Dim = true; } return pack; }), "Still checking. This either completes or changes nothing.", true) }),
                ("refused", () => new[] { PanelBlock.Balance("12", "12 entries", "0.01 SOL"),
                    PanelBlock.PackRow(Packs((index, pack) => { if (index == 1) { pack.Refused = true; pack.Price = "Try again"; pack.Buy = new PageAction { Label = "Try again" }; } return pack; }),
                        "Not approved in your wallet.") }),
                ("gained", () => new[] { PanelBlock.Balance("22", "22 entries", "0.01 SOL", null, "+10", "12"), PanelBlock.PackRow(Packs(), null, false, 1) }),
                ("before launch", () => new[] { PanelBlock.Balance("0", null, null, "The Arena opens soon."),
                    PanelBlock.PackRow(Packs((index, pack) => { pack.Buy = null; pack.Dim = true; return pack; })),
                    PanelBlock.Button(new PageAction { Label = "Play Campaign" }, false, SkinSlots.IconPlay) }),
                ("no device", () => new[] { PanelBlock.Balance("0", "0 entries", "0.01 SOL"), PanelBlock.PackRow(Packs()),
                    PanelBlock.Button(new PageAction { Label = "Set up device to play", Name = "Set up device" }, false) }),
                ("found confirming", () => new[] { PanelBlock.Balance(null, null, null, "Confirming your purchase"),
                    PanelBlock.PackRow(Packs((index, pack) => { pack.Buy = null; pack.Dim = true; return pack; })) }),
            };
            foreach (var (phone, size) in new (Action<PageShell, float>, string)[] { (Phones.Seeker, "seeker"), (Phones.Compact, "compact") })
            {
                phone(shell, 1);
                foreach (var (name, blocks) in states)
                {
                    yield return Draw(blocks());
                    // The page's first drawing fades in.
                    yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .15f);
                    string at = size + ", " + name;
                    Assert.That(shell.Scroll.content.rect.height, Is.LessThanOrEqualTo(shell.Scroll.viewport.rect.height + .5f), at + ": the page does not scroll");
                    var cards = new[] { 1, 10, 25 }.Select(pack => Area("Pack " + pack)).ToArray();
                    Assert.That(cards.Select(card => Mathf.Round(card.width)).Distinct().Count(), Is.EqualTo(1), at + ": the cards are one width");
                    Assert.That(cards.Select(card => Mathf.Round(card.height)).Distinct().Count(), Is.EqualTo(1), at + ": the cards are one height");
                    Assert.That(cards.Select(card => Mathf.Round(card.y)).Distinct().Count(), Is.EqualTo(1), at + ": the cards stand on one line");
                    var arts = new[] { 1, 10, 25 }.Select(pack => Area("Pack " + pack + " art")).ToArray();
                    Assert.That(arts.Select(art => Mathf.Round(art.width * 10)).Distinct().Count(), Is.EqualTo(1), at + ": the pictures are one size");
                    Assert.That(Named("Pack 1").Single().sprite, Is.EqualTo(Named("Pack 25").Single().sprite), at + ": the cards are one style");
                    var texts = root.GetComponentsInChildren<TMP_Text>().Where(text => text.gameObject.activeInHierarchy).Select(text => text.text.ToLowerInvariant()).ToArray();
                    foreach (string push in new[] { "best", "popular", "save", "bonus", "free", "%", "off", "deal" })
                        Assert.That(texts.Any(text => text.Split(' ', '·', '.', ',').Contains(push) || (push == "%" && text.Contains("%"))), Is.False, at + ": no pack is pushed with \"" + push + "\"");
                    Assert.That(Words("Kredit terms"), Is.EqualTo("Kredits can’t be withdrawn, transferred or exchanged."), at + ": the one-way rule stays in view");
                    var safe = shell.SafeArea;
                    foreach (var card in cards) Assert.That(card.xMin >= safe.xMin - .5f && card.xMax <= safe.xMax + .5f, Is.True, at + ": the cards are on screen");
                    yield return Captures.Snap(shell, "kredits " + name + " " + size);
                }
            }
        }

        // A purchase lives on the card that was tapped: the loader and its step on
        // that card's button inside a gold rim while it is in progress, the other
        // cards dimmed and taking no tap; refused, an ember rim, Try again on the
        // card and the reason in one line under the cards.
        [UnityTest] public IEnumerator APurchaseLivesOnTheCardThatWasTapped()
        {
            yield return Open(); Phones.Compact(shell);
            int bought = 0, retried = 0;
            yield return Draw(PanelBlock.Balance("12", "12 entries", "0.01 SOL"), PanelBlock.PackRow(Packs((index, pack) => { pack.Buy.Invoke = () => bought = index + 1; return pack; })));
            Assert.That(Words("Kredit balance"), Is.EqualTo("12"));
            StringAssert.Contains("12 entries", Words("Entries words")); StringAssert.Contains("0.01 SOL", Words("Unit price words"));
            root.GetComponentsInChildren<Button>().Single(button => button.name == "Buy 10").onClick.Invoke();
            Assert.That(bought, Is.EqualTo(2), "The whole card is the tap");
            Assert.That(SkinUi.ScreenRect((RectTransform)root.GetComponentsInChildren<Button>().Single(button => button.name == "Buy 10").transform), Is.EqualTo(Area("Pack 10")));

            var busy = new PageAction { Label = "Approve in wallet", Short = "In wallet", Name = "Action progress", Progress = "Approve in wallet" };
            yield return Draw(PanelBlock.Balance("12", "12 entries", "0.01 SOL"),
                PanelBlock.PackRow(Packs((index, pack) => { if (index == 1) { pack.Buy = busy; pack.Price = busy.Label; } else { pack.Buy = null; pack.Dim = true; } return pack; })));
            Assert.That(Words("Pack 10 price words"), Is.EqualTo("In wallet"), "A narrow card takes the step's shorter words");
            Assert.That(Named("Pack 10 rim").Single().color, Is.EqualTo(shell.Artwork.Token(SkinTokens.Accent)), "The tapped card is rimmed in gold");
            Assert.That(Named("Action loader").Single().GetComponent<Turn>(), Is.Not.Null, "The loader turns on the tapped card");
            Assert.That(root.GetComponentsInChildren<Button>().Single(button => button.name == "Action progress").interactable, Is.False);
            Assert.That(root.GetComponentsInChildren<Button>().Any(button => button.name.StartsWith("Buy ")), Is.False, "The other cards take no tap");
            foreach (int other in new[] { 1, 25 })
                Assert.That(root.GetComponentsInChildren<CanvasGroup>().Single(group => group.name == "Pack " + other + " card").alpha, Is.EqualTo(PageViews.PackDim), "Pack " + other + " dims");
            Assert.That(root.GetComponentsInChildren<CanvasGroup>().Single(group => group.name == "Pack 10 card").alpha, Is.EqualTo(1));

            yield return Draw(PanelBlock.Balance("12", "12 entries", "0.01 SOL"), PanelBlock.PackRow(Packs((index, pack) => {
                if (index == 1) { pack.Refused = true; pack.Price = "Try again"; pack.Buy = new PageAction { Label = "Try again", Invoke = () => retried++ }; } return pack; }),
                "Not approved in your wallet."));
            Assert.That(Named("Pack 10 rim").Single().color, Is.EqualTo(shell.Artwork.Token(SkinTokens.Negative)), "The refused card is rimmed in ember");
            Assert.That(Words("Action refused"), Is.EqualTo("Not approved in your wallet."));
            root.GetComponentsInChildren<Button>().Single(button => button.name == "Try again").onClick.Invoke(); Assert.That(retried, Is.EqualTo(1));
            Assert.That(root.GetComponentsInChildren<Button>().Count(button => button.name.StartsWith("Buy ")), Is.EqualTo(2), "The other cards work again");
        }

        // Kredits that just arrived: the balance counts up from what it was with
        // its gain beside it, and coins fly from their card to the balance.
        // Reduced motion keeps the count-up alone. A balance on its way shows the
        // loader in the figure's place.
        [UnityTest] public IEnumerator ArrivedKreditsCountUpAndFlyAndReducedMotionKeepsTheCountAlone()
        {
            yield return Open(); Phones.Compact(shell);
            foreach (bool still in new[] { false, true })
            {
                source.Still = still; string at = still ? "reduced motion" : "motion";
                yield return Draw(PanelBlock.Balance("12", "12 entries", "0.01 SOL"), PanelBlock.PackRow(Packs()));
                yield return Draw(PanelBlock.Balance("22", "22 entries", "0.01 SOL", null, "+10", "12"), PanelBlock.PackRow(Packs(), null, false, 1));
                Assert.That(Words("Kredit balance gained"), Is.EqualTo("+10"), at);
                Assert.That(int.Parse(Words("Kredit balance")), Is.LessThan(22), at + ": the figure starts from what it was");
                Assert.That(Named("Kredit flight").Length, Is.EqualTo(still ? 0 : PageViews.FlightCoins), at + ": the coins' flight");
                yield return new WaitForSecondsRealtime(CountUp.CountSeconds + Flight.FlightSeconds + .5f);
                Assert.That(Words("Kredit balance"), Is.EqualTo("22"), at + ": it counts up to the confirmed balance");
                Assert.That(Named("Kredit flight").Length, Is.Zero, at + ": the coins have landed");
                // Drawn again while the gain shows, nothing replays.
                yield return Draw(PanelBlock.Balance("22", "22 entries", "0.01 SOL", null, "+10", "12"), PanelBlock.PackRow(Packs(), null, false, 1));
                Assert.That(Words("Kredit balance"), Is.EqualTo("22"), at); Assert.That(Named("Kredit flight").Length, Is.Zero, at);
                yield return Draw(PanelBlock.Balance(null, null, null, "Reading your balance"), PanelBlock.PackRow(Packs((index, pack) => { pack.Buy = null; pack.Dim = true; return pack; })));
                Assert.That(Named("Balance loader").Single().GetComponent<Turn>() != null, Is.EqualTo(!still), at + ": the balance's loader");
                Assert.That(Words("Balance line"), Is.EqualTo("Reading your balance"));
            }
        }
    }
}
