using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine.TestTools;
using ZKube.Local.App;
using ZKube.Presentation;

namespace ZKube.Tests
{
    // The Realms Daily crown: the platform leaderboard's top for today, read once
    // as the run opens; signed out, or when the read fails, no badge.
    public sealed partial class StoreAppPageJourneyTests
    {
        [UnityTest] public IEnumerator TheRealmsDailyCrownIsThePlatformTopWhenSignedIn()
        {
            Assert.That(app.Flow.DailyTop().Result, Is.Null, "Signed out there is no top to read");
            accounts.Player = new PlayerAccount { Name = "Mira of the Reef" }; accounts.Top = 840;
            var signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The sign-in did not answer"); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady();
            yield return Wait(() => board.Session.DailyFacts.Top.IsCompleted, "The top read did not land"); yield return null; yield return null;
            Assert.That(board.View.CrownShown, Is.EqualTo(Crown.Below));
            Assert.That(board.View.GetComponentsInChildren<TMP_Text>().Single(text => text.name == "Best").text, Is.EqualTo("840"));
        }
        [UnityTest] public IEnumerator TheRealmsDailyCrownIsHiddenWhenTheTopCannotBeRead()
        {
            accounts.Player = new PlayerAccount { Name = "Mira of the Reef" }; accounts.TopFails = true;
            var signIn = app.Flow.SignIn(); yield return Wait(() => signIn.IsCompleted, "The sign-in did not answer"); yield return Page(StorePage.Home);
            Click(app, "Play today"); yield return BoardReady();
            yield return Wait(() => board.Session.DailyFacts.Top.IsCompleted, "The top read did not answer"); yield return null;
            Assert.That(board.View.CrownShown, Is.EqualTo(Crown.Hidden), "A failed read shows no badge, never the score");
        }
    }
}
