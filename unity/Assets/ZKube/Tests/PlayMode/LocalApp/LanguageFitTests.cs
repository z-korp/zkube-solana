using System;
using System.Collections;
using System.Collections.Generic;
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
    // Realms in every language, on both phones: every page of the real app is
    // reached by that language's own words, holds them, and shows no word the
    // catalogue does not hold (LanguageFit). With ZKUBE_CAPTURES set, each page
    // is captured in each language.
    public sealed partial class StoreAppPageJourneyTests
    {
        [UnityTest] public IEnumerator EveryRealmsPageFitsBothPhonesInEveryLanguage()
        {
            var shell = app.GetComponent<PageShell>(); var faults = new List<string>(); var strays = new List<string>();
            // What the platform brings: the product's name and the store's price.
            var known = new[] { Application.productName, "€4.99" };
            var screen = new Rect(0, 0, Screen.width, Screen.height);
            // Tiki's first nine levels are starred, so its guardian's level can be previewed; nothing after it is.
            product.Write(state => { for (int level = 0; level < 9; level++) state.Stars[level] = (byte)(level == 0 ? 3 : level == 1 ? 2 : 1);
                state.Streak = 3; state.BestDailyScore = 12480; return state; });
            try
            {
                foreach (var (phone, use) in new (string, Action)[] { ("compact", () => Phones.Compact(shell)), ("seeker", () => Phones.Seeker(shell)) })
                    foreach (string code in Language.Codes)
                    {
                        use(); Language.Use(code);
                        IEnumerator Shown(string page)
                        {
                            yield return Wait(() => PageDrawn() && !shell.HandingOver && !app.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page"),
                                code + " " + phone + " " + page + " did not settle");
                            foreach (var sequence in app.GetComponentsInChildren<PageSequence>()) sequence.Finish();
                            yield return null;
                            faults.AddRange(LanguageFit.Faults(shell, 1, phone + " " + page));
                            strays.AddRange(LanguageFit.Unowned(shell, page, known));
                            yield return Captures.Snap(shell, code + " " + phone + " " + page);
                        }
                        IEnumerator OnBoard(string page)
                        {
                            yield return null; yield return null;
                            faults.AddRange(LanguageFit.Faults(board.View, screen, board.View.Layout.Density, 1, "board " + page));
                            strays.AddRange(LanguageFit.Unowned(board.View, "board " + page, known));
                            if (phone == "compact") yield return Captures.Snap(screen, code + " board " + page);
                        }
                        app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home); yield return Shown("home");
                        // The map, the realm the stars have not opened, and the realm the purchase opens.
                        Click(app, Language.TabCampaign); yield return Page(StorePage.Campaign); yield return Shown("map");
                        app.Flow.Campaign.SelectRealm(3); yield return Page(StorePage.Campaign); yield return Shown("realm waiting for stars");
                        app.Flow.Campaign.SelectRealm(StoreCampaignPolicy.FirstPurchasedRealm); yield return Page(StorePage.Campaign); yield return Shown("realm waiting for the purchase");
                        app.Flow.Campaign.SelectRealm(1); yield return Page(StorePage.Campaign);
                        // A guardian's level names the realm it opens; then level 1, played to its pause and its end.
                        app.Flow.Campaign.Preview(1, 10); yield return Page(StorePage.Level); yield return Shown("guardian preview");
                        app.Flow.Campaign.Preview(1, 1); yield return Page(StorePage.Level); yield return Shown("preview");
                        Click(app, Language.ActionPlay);
                        yield return Wait(() => app.Flow.Page == StorePage.Board && board.Drawn && !board.Busy && !shell.Root.activeSelf, code + " " + phone + ": the board did not open");
                        yield return OnBoard("level");
                        Click(board.View, "Pause"); yield return OnBoard("pause");
                        Click(board.View, BoardController.EndRun); yield return OnBoard("end run");
                        Click(board.View, BoardController.EndRun);
                        yield return Wait(() => !board.Busy && board.State.Phase == (byte)CorePhase.Finished, code + ": the run did not end");
                        yield return Page(StorePage.Result); yield return Shown("result ended");
                        // The other ways a level ends, by the stars it kept.
                        var goals = new CampaignGoals { Points = 60, PrimaryKind = 7, PrimaryCount = 4, SecondaryKind = 1, SecondaryValue = 2, SecondaryCount = 1 };
                        foreach (var (reason, stars, moves, name) in new[] { ((byte)2, (byte)1, 0u, "one star"), ((byte)2, (byte)3, 6u, "two stars"),
                            ((byte)2, (byte)0, 0u, "no star"), ((byte)1, (byte)7, 3u, "cleared") })
                        {
                            app.Flow.Campaign.Finished(new CampaignOutcome { Realm = 1, Level = 10, Score = 12, StarSources = stars, EndReason = reason, MovesLeft = moves, Goals = goals });
                            yield return Page(StorePage.Result); yield return Shown("result " + name);
                        }
                        // The Daily: its board, its result, and Home once the attempt is used.
                        app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home);
                        if (!app.Flow.AttemptedToday)
                        {
                            Click(app, Language.DailyPlay);
                            yield return Wait(() => app.Flow.Page == StorePage.Board && board.Drawn && !board.Busy && !shell.Root.activeSelf, code + ": the Daily's board did not open");
                            yield return OnBoard("daily");
                            Click(board.View, "Pause"); yield return OnBoard("daily pause");
                            Click(board.View, BoardController.EndRun); yield return OnBoard("daily end run");
                            Click(board.View, BoardController.EndRun);
                            yield return Wait(() => !board.Busy && board.State.Phase == (byte)CorePhase.Finished, code + ": the Daily did not end");
                            yield return Page(StorePage.Result);
                        }
                        else { Click(app, Language.DailyViewResult); yield return Page(StorePage.Result); }
                        yield return Shown("daily result");
                        app.Flow.Show(StorePage.Home); yield return Page(StorePage.Home); yield return Shown("home with the attempt used");
                        Click(app, Language.TabProfile); yield return Page(StorePage.Profile); yield return Shown("profile");
                        Click(app, Language.TabSettings); yield return Page(StorePage.Settings); yield return Shown("settings");
                        Click(app, "Language: " + Language.Code);
                        yield return Wait(() => app.GetComponent<PageViews>().ShownPanel == "Languages", code + ": the languages did not open"); yield return Shown("languages");
                        // Every language's name is on the page at once, on the small phone too: nothing to scroll to.
                        if (shell.Scroll.content.rect.height > shell.Viewport.rect.height + .5f) faults.Add(code + " " + phone + " languages: the list of languages scrolls");
                        Assert.AreEqual(Language.Codes.Length, app.GetComponentsInChildren<UnityEngine.UI.Button>().Count(button => button.name.StartsWith("Language ")), "every language is a choice");
                        Assert.IsTrue(app.GetComponent<PageViews>().GoBack(), "the back key leaves the languages"); yield return Page(StorePage.Settings);
                    }
            }
            finally { Language.Use("en"); Phones.Clear(shell); }
            Assert.That(strays.Concat(faults).Distinct(), Is.Empty, "Every word on a page is the catalogue's, and fits:\n" + string.Join("\n", strays.Concat(faults).Distinct()));
        }
    }
}
