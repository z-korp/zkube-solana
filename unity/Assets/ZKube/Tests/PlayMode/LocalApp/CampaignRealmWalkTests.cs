using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Core.Generated;
using Language = ZKube.Core.Generated.Words;
using ZKube.Local.App;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests
{
    // The Campaign of every realm in the real app, on both phones, for a player four levels into it: its
    // guardian greets a first visit and states its rule, its map opens, its first level is previewed with
    // its own goals, played for three moves, paused, ended and cleared. With ZKUBE_CAPTURES set each of those is captured, which is where
    // pictures of a realm's goals and earn rule come from.
    public sealed partial class StoreAppPageJourneyTests
    {
        [UnityTest] public IEnumerator EveryRealmsFirstLevelIsReachedFromItsGreetingAndPlayedToItsResult()
        {
            var shell = app.GetComponent<PageShell>(); var screen = new Rect(0, 0, Screen.width, Screen.height);
            try
            {
                foreach (var (phone, use) in new (string, Action)[] { ("seeker", () => Phones.Seeker(shell)), ("compact", () => Phones.Compact(shell)) })
                    foreach (var definition in Protocol.Realms)
                    {
                        byte realm = definition.MapId; string name = "campaign " + phone + " realm " + realm.ToString("00");
                        use();
                        // A player four levels into this realm: every realm before it is finished, none after it is begun.
                        product.Write(state =>
                        {
                            state.CampaignOwned = true;
                            for (int level = 0; level < state.Stars.Length; level++)
                                state.Stars[level] = (byte)(level / 10 < realm - 1 ? 3 : level / 10 > realm - 1 ? 0 : level % 10 < 4 ? new[] { 3, 2, 3, 1 }[level % 10] : 0);
                            return state;
                        });
                        IEnumerator Shown(string page)
                        {
                            yield return Wait(() => PageDrawn() && !shell.HandingOver && !app.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page"),
                                name + " " + page + " did not settle");
                            foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                            yield return null;
                            yield return Captures.Snap(shell, name + " " + page);
                        }
                        // A first visit: the guardian greets, then states the rule that earns its bonus.
                        app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                        app.Flow.Campaign.SelectRealm(realm); yield return Page(StorePage.Campaign);
                        app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                        greeted = 0;
                        app.Flow.Show(StorePage.Campaign); yield return Page(StorePage.Campaign);
                        yield return new WaitForSecondsRealtime(PageShell.LeaveSeconds + .05f);
                        var greeting = shell.Chrome.Find("Guardian greeting");
                        Assert.That(greeting != null && greeting.gameObject.activeInHierarchy, Is.True, name + ": the guardian greets a first visit");
                        // After the first realm the guardian first says how the player came through to it.
                        foreach (string said in realm > 1 ? new[] { "passage", "greeting", "greeting rule" } : new[] { "greeting", "greeting rule" })
                        {
                            greeting.GetComponentInChildren<GuardianTalk>().Complete(); yield return null;
                            yield return Captures.Snap(shell, name + " " + said);
                            Click(app, "Continue"); yield return null;
                        }
                        Assert.That(greeted, Is.Not.Zero, name + ": the greeting is remembered");
                        greeted = ~0;
                        yield return Shown("map");
                        Assert.AreEqual(realm, app.Flow.Campaign.Realm, name + ": the map is this realm's");
                        app.Flow.Campaign.Preview(realm, 1); yield return Page(StorePage.Level); yield return Shown("preview level 1");
                        Click(app, Language.ActionPlay);
                        yield return Wait(() => app.Flow.Page == StorePage.Board && board.Drawn && !board.Busy && !shell.Root.activeSelf, name + ": the board did not open");
                        yield return BoardReady();
                        var level = definition.Levels[0];
                        Assert.AreEqual(level.Primary[0], board.Session.Rules.PrimaryKind, name + ": the board plays this realm's first goal");
                        // Three moves in, by the slides the core scores best; the board is one size, so it is captured once.
                        for (int move = 0; move < 3 && board.State.Phase != (byte)CorePhase.Finished; move++)
                        {
                            var best = BoardHint.Best(board.Session.Accepted);
                            if (!best.HasValue) break;
                            yield return Play(best.Value);
                        }
                        yield return null; yield return null;
                        if (phone == "seeker") yield return Captures.Snap(screen, "campaign board realm " + realm.ToString("00") + " level 1");
                        if (board.State.Phase != (byte)CorePhase.Finished)
                        {
                            Click(board.View, "Pause"); yield return null; yield return null;
                            if (phone == "seeker") yield return Captures.Snap(screen, "campaign board realm " + realm.ToString("00") + " pause");
                            Click(board.View, BoardController.EndRun); yield return null;
                            Click(board.View, BoardController.EndRun);
                            yield return Wait(() => !board.Busy && board.State.Phase == (byte)CorePhase.Finished, name + ": the run did not end");
                        }
                        yield return Page(StorePage.Result);
                        // The level cleared on its own goals, with its three stars.
                        app.Flow.Campaign.Finished(new CampaignOutcome { Realm = realm, Level = 1, Score = (uint)(Protocol.CampaignTargets[0] + 6), StarSources = 7, EndReason = 1, MovesLeft = 3,
                            PrimaryProgress = level.Primary[2], Goals = new CampaignGoals { Points = Protocol.CampaignTargets[0],
                                PrimaryKind = level.Primary[0], PrimaryValue = level.Primary[1], PrimaryCount = level.Primary[2],
                                SecondaryKind = level.Secondary[0], SecondaryValue = level.Secondary[1], SecondaryCount = level.Secondary[2] } });
                        yield return Page(StorePage.Result); yield return Shown("result cleared");
                    }
            }
            finally { greeted = ~0; Phones.Clear(shell); }
        }
    }
}
