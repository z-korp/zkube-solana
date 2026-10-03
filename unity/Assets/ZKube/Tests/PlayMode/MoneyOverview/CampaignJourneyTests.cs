using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    public sealed partial class MoneyOverviewTests
    {
        // The Campaign journey under each identity, as the player sees it: every
        // change of page, talk scene, board, board dialog, the guardian's board
        // lesson and menu music is one line, in order, and each step says whether a
        // page left and art loaded. The guided first run is taught in both.
        [UnityTest] public IEnumerator TheCampaignJourneyIsTheSameUnderBothIdentityImplementations()
        {
            int taught = ~(1 << (int)Lesson.GuidedRun);
            if (EventSystem.current == null) input = new GameObject("Journey test input", typeof(EventSystem), typeof(StandaloneInputModule));
            Lessons.Device = new Lessons(() => taught, value => taught = value);
            var realms = new List<string>();
            var local = new GameObject("Store journey");
            CampaignBilling billing = null;
            try
            {
                var product = new LocalProductStore(_ => null, (_, __) => { });
                var runs = new StoreRunClient(product, () => (long)ZKube.Core.NativeEngine.Daily(20705).OpensAt);
                billing = new CampaignBilling(new PageStore(),
                    () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
                var boardObject = new GameObject("Store board"); boardObject.transform.SetParent(local.transform);
                var store = local.AddComponent<StoreAppAdapter>(); store.Initialize(product, runs, billing, boardObject.AddComponent<BoardController>());
                yield return Journey("realms", store, local, realms, () => runs.StartCampaign(1, 1));
            }
            finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
            yield return null;

            var arena = new List<string>();
            yield return PrepareScenario("campaign-playable");
            taught = ~(1 << (int)Lesson.GuidedRun); Lessons.Device = new Lessons(() => taught, value => taught = value);
            Click("Connect"); yield return Idle();
            var money = host.GetComponent<MoneyIdentity>().Controller;
            yield return Journey("arena", money, host, arena, () => environment.Services.Campaign(environment.Owner).Runs.StartCampaign(1, 1));
            Assert.That(environment.ForbiddenCalls, Is.Zero);
            // From the first tap: each product opens on its own Home.
            var fromRealms = realms.SkipWhile(line => !line.StartsWith("#")).ToList();
            var fromArena = arena.SkipWhile(line => !line.StartsWith("#")).ToList();
            Assert.That(fromArena, Is.EqualTo(fromRealms), "Arena:\n" + string.Join("\n", fromArena) + "\n\nRealms:\n" + string.Join("\n", fromRealms));
        }

        // Arena's one addition to the journey: once a run's result is durable, the
        // background write of the address's stars starts with a read of its record.
        // The result page does not wait for it.
        [UnityTest] public IEnumerator TheStarWriteStartsAfterAResultWithoutDelayingTheResultPage()
        {
            yield return PrepareScenario("campaign-playable"); Click("Connect"); yield return Idle();
            Click("Campaign"); yield return Idle(); Click("Trial 1"); yield return Idle();
            Click("Play"); yield return BoardReady();
            var record = environment.Services.Campaign(environment.Owner);
            yield return Wait(record.Pending);
            delay = environment.HoldNextRead("getAccountInfo");
            Click("Pause"); yield return null; Click("Dialog End run"); yield return null; Click("Dialog End run");
            yield return Wait(delay.Entered);
            float until = Time.realtimeSinceStartup + RunBoard.TerminalHoldSeconds + 5;
            while (host.GetComponent<PageViews>().Shown != AppPage.Result && Time.realtimeSinceStartup < until) yield return null;
            Assert.That(host.GetComponent<PageViews>().Shown, Is.EqualTo(AppPage.Result), "The result opens while the star read is held");
            Assert.That(record.Pending.IsCompleted, Is.False, "The star write is still running behind the result");
            delay.Release(); yield return Wait(record.Pending);
            Assert.That(record.Product.Read.CampaignWritePending, Is.False, "An ended run kept no stars to write");
            Assert.That(environment.SentSignature, Is.Null);
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Map (with the realm's first greeting), the level's preview, the board,
        // pause, ending the run, what follows it, the way back to the map, then a
        // run saved on the device resumed from the map and its preview.
        private IEnumerator Journey(string name, Component app, GameObject scope, List<string> log, Action saveRun)
        {
            int greeted = 0; app.GetComponent<PageViews>().Greetings = new GuardianGreetings(() => greeted, value => greeted = value);
            string Step(string step) { log.Add("# " + step); return step; }
            missing = null;
            // A tap whose button is not there: when Back to map is, the product needs
            // that extra step first (recorded as one); otherwise the walk stops there.
            IEnumerator Go(string target)
            {
                yield return Tap(scope, Step(target));
                if (missing == null) yield break;
                if (!Active(scope).Any(button => button.name == "Back to map" || Label(button) == "Back to map")) { log.Add("! no button " + missing); yield break; }
                missing = null; log.Add("! extra step: Back to map");
                yield return Tap(scope, "Back to map"); yield return Record(app, scope, log, 8, 1.5f);
                yield return Tap(scope, target);
                if (missing != null) log.Add("! no button " + missing);
            }
            IEnumerator Settle(string step)
            {
                yield return Record(app, scope, log, 8, 1.5f);
                yield return ZKube.Tests.Presentation.Captures.Snap(app.GetComponent<PageShell>(), name + " " + log.Count(line => line.StartsWith("#")).ToString("00") + " " + step);
            }
            try
            {
                yield return Settle("start");
                yield return Go("Campaign"); if (missing != null) yield break; yield return Settle("map greeting");
                for (int i = 0; i < 12 && Active(scope).Any(button => button.name == "Continue"); i++)
                { yield return Tap(scope, "Continue"); yield return new WaitForSecondsRealtime(.3f); }
                Step("greeting done"); yield return Settle("map");
                yield return Go("Trial 1"); if (missing != null) yield break; yield return Settle("preview");
                yield return Go("Play"); if (missing != null) yield break; yield return Settle("board");
                yield return Go("Pause"); if (missing != null) yield break; yield return Settle("pause");
                yield return Go("Dialog End run"); if (missing != null) yield break; yield return Settle("end run confirm");
                yield return Go("Dialog End run"); if (missing != null) yield break; yield return Settle("after the run");
                // What the product offers after an ended run: the result's way to the map, or a dialog.
                bool Offers(string text) => Active(scope).Any(button => button.name == text || Label(button) == text);
                string onward = Offers("Map") ? "Map" : Offers("Dialog Continue") ? "Dialog Continue" : null;
                if (onward == null) { log.Add("! no way on after the run"); yield break; }
                yield return Go(onward); if (missing != null) yield break; yield return Settle("back");
                saveRun();
                yield return Go("Settings"); if (missing != null) yield break; yield return Settle("settings");
                yield return Go("Campaign"); if (missing != null) yield break; yield return Settle("map with a saved run");
                log.Add("  map words: " + string.Join(" | ", Words(scope)));
                yield return Go("Trial 1"); if (missing != null) yield break; yield return Settle("saved run preview");
                log.Add("  preview words: " + string.Join(" | ", Words(scope)));
                string play = Active(scope).Any(button => Label(button) == "Resume run") ? "Resume run" : "Play";
                yield return Go(play); if (missing != null) yield break; yield return Settle("resumed board");
            }
            finally
            {
                string folder = Environment.GetEnvironmentVariable("ZKUBE_CAPTURES");
                if (!string.IsNullOrEmpty(folder)) File.WriteAllLines(Path.Combine(folder, "journey-" + name + ".txt"), log);
            }
        }

        // Records each change of what the player sees until it has been still for
        // quiet seconds (or limit seconds pass), then whether a page left and art
        // loaded on the way: those overlap the next page by frames, not by design.
        private static IEnumerator Record(Component app, GameObject scope, List<string> log, float limit, float quiet)
        {
            float start = Time.realtimeSinceStartup, still = start; string last = null;
            bool left = false, loaded = false;
            var shell = app.GetComponent<PageShell>();
            while (Time.realtimeSinceStartup - start < limit && Time.realtimeSinceStartup - still < quiet)
            {
                string now = Seen(app, scope);
                left |= scope.GetComponentsInChildren<Transform>().Any(value => value.name == "Leaving page");
                loaded |= shell.Loading;
                if (now != last) { log.Add(now); last = now; still = Time.realtimeSinceStartup; }
                yield return null;
            }
            if (left || loaded) log.Add("  ~" + (left ? " a page left" : "") + (loaded ? " art loaded" : ""));
        }
        private static string Seen(Component app, GameObject scope)
        {
            var views = app.GetComponent<PageViews>(); var shell = app.GetComponent<PageShell>();
            var panel = typeof(PageViews).GetField("shownPanel", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(views) as PanelPageView;
            string page = !shell.Root.activeSelf ? "hidden" : views.Shown?.ToString() ?? (panel != null ? "panel " + panel.Key : "none");
            var board = scope.GetComponentsInChildren<BoardController>().FirstOrDefault(value => value.isActiveAndEnabled);
            string dialog = board?.View == null ? "" : string.Join("+", board.View.GetComponentsInChildren<Button>()
                .Where(button => button.gameObject.activeInHierarchy && button.name.StartsWith("Dialog ")).Select(button => button.name.Substring(7)));
            bool talk = scope.GetComponentsInChildren<GuardianTalk>().Any(value => value.isActiveAndEnabled);
            var coach = scope.GetComponentInChildren<BoardCoach>();
            string lesson = coach == null || board == null || coach.Said.Count == 0 ? "" : " lesson=" + string.Join("|", coach.Said);
            return "  page=" + page + (talk ? " talk" : "") +
                " board=" + (board == null ? "off" : "on") + (dialog.Length == 0 ? "" : " dialog=" + dialog) + lesson + " music=" + (views.MenuMusic.isPlaying ? "on" : "off");
        }
        private static IEnumerable<Button> Active(GameObject scope) =>
            scope.GetComponentsInChildren<Button>().Where(button => button.gameObject.activeInHierarchy && button.interactable);
        private static string Label(Button button) => button.GetComponentsInChildren<TMP_Text>().Select(text => text.text).FirstOrDefault();
        private static IEnumerable<string> Words(GameObject scope) => scope.GetComponentsInChildren<TMP_Text>()
            .Where(text => text.gameObject.activeInHierarchy && !string.IsNullOrEmpty(text.text) && text.GetComponentInParent<SkinTabBar>() == null).Select(text => text.text);
        // Taps the one active button of that name or label, once it is there.
        private string missing;
        private IEnumerator Tap(GameObject scope, string name)
        {
            Button[] buttons, chosen;
            float until = Time.realtimeSinceStartup + 15;
            do
            {
                buttons = Active(scope).ToArray();
                var named = buttons.Where(button => button.name == name).ToArray();
                chosen = named.Length != 0 ? named : buttons.Where(button => Label(button) == name).ToArray();
                if (chosen.Length == 1) break;
                yield return null;
            }
            while (Time.realtimeSinceStartup < until);
            if (chosen.Length != 1) { missing = name + " among " + string.Join(", ", buttons.Select(button => button.name)); yield break; }
            ExecuteEvents.Execute(chosen[0].gameObject, new PointerEventData(EventSystem.current) { button = PointerEventData.InputButton.Left }, ExecuteEvents.pointerClickHandler);
        }
    }
}
