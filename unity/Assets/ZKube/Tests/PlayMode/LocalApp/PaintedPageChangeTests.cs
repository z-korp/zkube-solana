using System;
using System.Collections;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using ZKube.Local.App;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests
{
    // A page change never shows the bare clear colour: on every frame between
    // the tabs, the map's realms, the preview, the board and the result, a
    // painting covers the screen whole or the board has drawn its own. With
    // and without reduced motion. And a change between pages is one change of
    // painting: from the page left straight to the page opened, that page on
    // it from its first frame, drawn once.
    public sealed partial class StoreAppPageJourneyTests
    {
        [UnityTest] public IEnumerator EveryPageChangeKeepsAPaintingOnEveryFrame()
        {
            var shell = app.GetComponent<PageShell>();
            var watch = PaintWatch.On(shell); var strays = new System.Collections.Generic.List<string>();
            try
            {
                foreach (bool reduced in new[] { false, true })
                {
                    typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, reduced);
                    // A change between pages (not into or out of the board) is one change of painting.
                    IEnumerator Step(string at, Action change, Func<bool> settled, bool pages = true)
                    {
                        watch.Step = at + (reduced ? " (reduced motion)" : "");
                        string from = shell.Background.sprite == null ? null : PaintWatch.Name(shell.Background.sprite);
                        change();
                        yield return Wait(settled, watch.Step + " did not settle");
                        if (pages) strays.AddRange(watch.Strays(from, PaintWatch.Name(shell.Background.sprite), reduced));
                        // The chrome (tab bar, talk scenes) draws over every page.
                        foreach (Transform layer in shell.Root.transform)
                            if (layer.name == "Page stage" || layer.name == "Leaving page")
                                Assert.That(layer.GetSiblingIndex(), Is.LessThan(shell.Chrome.GetSiblingIndex()), watch.Step + ": the page draws under the chrome");
                    }
                    Func<bool> Shows(StorePage page) => () => app.Flow.Page == page && PageDrawn() && !shell.HandingOver;
                    Func<bool> Playing = () => app.Flow.Page == StorePage.Board && board.Drawn && !board.Busy && !shell.Root.activeSelf;
                    // Realm 2 is still closed: its map is the waiting realm, drawn from its own art.
                    yield return Step("Campaign", () => Click(app, "Campaign"), Shows(StorePage.Campaign));
                    yield return Step("the next realm", () => Click(app, "Next"), Shows(StorePage.Campaign));
                    yield return Step("the previous realm", () => Click(app, "Previous"), Shows(StorePage.Campaign));
                    yield return Step("Profile", () => Click(app, "Profile"), Shows(StorePage.Profile));
                    yield return Step("Settings", () => Click(app, "Settings"), Shows(StorePage.Settings));
                    yield return Step("Home", () => Click(app, "Home"), Shows(StorePage.Home));
                    yield return Step("the map", () => Click(app, "Campaign"), Shows(StorePage.Campaign));
                    yield return Step("the preview", () => Click(app, "Play level 1"), Shows(StorePage.Level));
                    yield return Step("the level's board", () => Click(app, "Play"), Playing, false);
                    watch.Step = "the level's end"; yield return EndRun();
                    yield return Step("the level's result", () => { }, Shows(StorePage.Result), false);
                    yield return Step("Home from the result", () => app.Flow.Show(StorePage.Home), Shows(StorePage.Home));
                    // Today's one Daily attempt is played on the first pass.
                    if (app.Flow.AttemptedToday) { watch.AssertCovered(); continue; }
                    yield return Step("the Daily's board", () => Click(app, "Play today"), Playing, false);
                    watch.Step = "the Daily's end"; yield return EndRun();
                    yield return Step("the Daily's result", () => { }, Shows(StorePage.Result), false);
                    yield return Step("Home again", () => app.Flow.Show(StorePage.Home), Shows(StorePage.Home));
                    watch.AssertCovered();
                }
            }
            finally { watch.Stop(); }
            Assert.That(strays, Is.Empty, "Every page change is one change of painting:\n" + string.Join("\n", strays));
        }

        // The frame that builds a page can take longer than a whole fade. The
        // cross-fade then still plays out over its frames; it is not carried to
        // its end by that one frame.
        [UnityTest] public IEnumerator ASlowFrameDoesNotSkipThePaintingsCrossFade()
        {
            typeof(BoardController).GetProperty("ReducedMotion").SetValue(board, false);
            var shell = app.GetComponent<PageShell>(); var home = shell.Background.sprite;
            Click(app, "Campaign");
            float deadline = Time.realtimeSinceStartup + 20;
            while (shell.Background.sprite == home || shell.Background.color.a > .999f)
            { if (Time.realtimeSinceStartup > deadline) Assert.Fail("The map's painting did not start fading in"); yield return null; }
            System.Threading.Thread.Sleep(Mathf.CeilToInt(PageShell.EnterSeconds * 2000));
            int frames = 0;
            while (shell.Background.color.a < .999f)
            { frames++; if (frames > 2000) Assert.Fail("The fade did not end"); yield return null; }
            Assert.That(frames, Is.GreaterThanOrEqualTo(Mathf.FloorToInt(PageShell.EnterSeconds / PageShell.MaxStep) - 1),
                "The painting goes on fading in after a frame longer than the fade");
        }
    }
}
