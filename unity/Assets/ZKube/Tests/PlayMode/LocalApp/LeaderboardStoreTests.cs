using System.Collections;
using System.Linq;
using System.Threading.Tasks;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Local.App;
using ZKube.Presentation;

namespace ZKube.Tests
{
    // A Leaderboard tap ends in the platform's own screen or in one reason on
    // the page that asked, and the button is its retry.
    public sealed partial class StoreAppPageJourneyTests
    {
        private bool Says(string words) => Texts().Any(text => text == words);
        private Button Leaderboard() => Buttons().Single(button => button.name == "Leaderboard");
        private IEnumerator SignedIn()
        {
            accounts.Player = new PlayerAccount { Name = "Mira of the Reef" };
            var signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The sign-in did not answer"); yield return Page(StorePage.Home);
        }

        [UnityTest] public IEnumerator ALeaderboardThatDoesNotOpenSaysSoAndItsButtonTriesAgain()
        {
            yield return SignedIn();
            // While the platform answers, the button shows its step and takes no second tap.
            accounts.Opening = new TaskCompletionSource<bool>();
            Leaderboard().onClick.Invoke(); yield return Page(StorePage.Home);
            Assert.That(Leaderboard().GetComponentsInChildren<TMP_Text>().Select(text => text.text), Is.EqualTo(new[] { "Opening" }));
            Assert.That(Leaderboard().GetComponentsInChildren<Image>().Any(image => image.name == "Action loader"), Is.True, "The shared loader is on the button");
            Leaderboard().onClick.Invoke(); yield return null;
            Assert.That(accounts.Shown, Is.EqualTo(1), "A tap that is still opening is not asked twice");

            accounts.Opening.SetResult(false); accounts.Opening = null;
            yield return Wait(() => Says(StoreAppFlow.LeaderboardUnavailable), "A leaderboard that did not open gave no reason"); yield return Page(StorePage.Home);
            Assert.That(Texts().Count(text => text == StoreAppFlow.LeaderboardUnavailable), Is.EqualTo(1), "One reason");
            Assert.That(Leaderboard().interactable, Is.True, "The button is the retry");
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Play today")), Is.True, "Nothing else changed");

            // The retry opens it and the reason goes.
            Click(app, "Leaderboard");
            yield return Wait(() => !Says(StoreAppFlow.LeaderboardUnavailable), "The reason stayed after the leaderboard opened"); yield return Page(StorePage.Home);
            Assert.That(accounts.Shown, Is.EqualTo(2));
            Assert.That(Leaderboard().interactable, Is.True);
        }

        [UnityTest] public IEnumerator ALeaderboardThatDoesNotOpenFromTheResultSaysSoThereAndNowhereElse()
        {
            yield return SignedIn();
            Click(app, "Play today"); yield return BoardReady();
            yield return EndRun(); yield return Page(StorePage.Result);
            accounts.Opens = false;
            Click(app, "Leaderboard");
            yield return Wait(() => Says(StoreAppFlow.LeaderboardUnavailable), "The result gave no reason"); yield return Page(StorePage.Result);
            Assert.That(Leaderboard().interactable, Is.True, "The result's button is the retry");
            Assert.That(Buttons().Any(button => button.GetComponentsInChildren<TMP_Text>().Any(text => text.text == "Continue")), Is.True, "The result keeps its way on");
            // The reason belongs to the page that asked.
            Click(app, "Continue"); yield return Page(StorePage.Home);
            Assert.That(Says(StoreAppFlow.LeaderboardUnavailable), Is.False);
            // A platform that throws is the same refusal, never an exception on the page.
            accounts.Opening = new TaskCompletionSource<bool>(); accounts.Opening.SetException(new System.InvalidOperationException("Play Games is unavailable"));
            Click(app, "Leaderboard");
            yield return Wait(() => Says(StoreAppFlow.LeaderboardUnavailable), "A throwing platform gave no reason");
            Assert.That(Texts().Any(text => text.Contains("Play Games is unavailable")), Is.False);
        }
    }
}
