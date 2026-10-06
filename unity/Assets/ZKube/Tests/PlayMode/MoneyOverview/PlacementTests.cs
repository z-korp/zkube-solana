using System;
using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;
using UnityEngine.UI;
using ZKube.Local;
using ZKube.Local.App;
using ZKube.Local.Billing;
using ZKube.Presentation;
using ZKube.Tests.Presentation;

namespace ZKube.Tests.MoneyOverview
{
    // The placement rule's guard (owner, 2026-10-06): every page of both apps, at
    // both phones, hands its controls over by role, and each stands in its role's
    // one place (Placement.Check says which). The Arena's walk is the one its
    // words are checked on; Realms' follows it. The tests that walk one page's
    // every state call the same check (the Boards page's kinds of day, the
    // Arena's result, the pause and its confirm at both text sizes).
    public sealed partial class MoneyOverviewTests
    {
        private IEnumerator Held(Component source, string at, bool first = false)
        {
            var shell = source.GetComponent<PageShell>(); var views = source.GetComponent<PageViews>();
            // A page is checked where it stands, once it has arrived and the one before it has left.
            for (float until = Time.realtimeSinceStartup + 5; shell.Moving && Time.realtimeSinceStartup < until;) yield return null;
            Assert.That(shell.Moving, Is.False, at + ": the page settles");
            yield return null; Canvas.ForceUpdateCanvases();
            yield return Captures.Snap(shell, "placement " + at);
            Placement.Check(source.transform, shell.SafeArea, 1, at, first);
            // The Android back key never leaves the player on a dead page: under a tab's main page it
            // returns there, and a page with no tab bar leads back somewhere. Only a tab's main page and
            // the app's first page have nowhere to go back to; a scene over a page is left by its own tap.
            bool scene = source.GetComponentsInChildren<Placed>().Any(placed => placed.gameObject.activeInHierarchy && placed.Role == ScreenKit.Role.Anywhere);
            bool tabs = source.GetComponentsInChildren<SkinTabBar>().Any(bar => bar.gameObject.activeInHierarchy);
            if (!first && !scene && (!tabs || views.ShownPanel != null))
                Assert.That(views.LeadsBack, Is.True, at + ": the Android back key leads back from this page");
            // A page taller than its phone is checked again at its foot.
            if (shell.Scroll.content.rect.height > shell.Viewport.rect.height + .5f)
            {
                shell.Scroll.verticalNormalizedPosition = 0; yield return null; Canvas.ForceUpdateCanvases();
                Placement.Check(source.transform, shell.SafeArea, 1, at + ", scrolled to its foot", first, scrolled: true);
                yield return Captures.Snap(shell, "placement " + at + " foot");
                shell.Scroll.verticalNormalizedPosition = 1; yield return null;
            }
        }

        [UnityTest] public IEnumerator EveryPagePlacesItsControlsByRole()
        {
            // Every lesson is taught: a page is walked without a lesson over it.
            Lessons.Device = Lessons.Memory(taught: true);
            foreach (var (use, phone) in new (Action<PageShell>, string)[] { (shell => Phones.Seeker(shell), "Seeker"), (shell => Phones.Compact(shell), "360 x 640") })
            {
                // The Arena: every page in every state its scenarios reach.
                // Before there is an address the Arena's one page is the app's first.
                yield return EveryArenaPage(use, 1, page => Held(host.transform, phone + " Arena " + page, page.StartsWith("Connect")));

                // Realms.
                var local = new GameObject("Store page source");
                CampaignBilling billing = null;
                try
                {
                    var product = new LocalProductStore(_ => null, (_, __) => { });
                    var runs = new StoreRunClient(product, () => (long)ZKube.Core.NativeEngine.Daily(20705).OpensAt);
                    var attempt = runs.StartDaily(); runs.Act(attempt.View.RunId, new LocalRunAction(LocalActionKind.Finish));
                    billing = new CampaignBilling(new PageStore(),
                        () => new CampaignBillingAnswer(product.Read.CampaignOwned, product.Read.CampaignPrice, CampaignBillingStatus.Updated), runs.ApplyCampaignEntitlement);
                    var boardObject = new GameObject("Store board"); boardObject.transform.SetParent(local.transform);
                    var board = boardObject.AddComponent<BoardController>();
                    var store = local.AddComponent<StoreAppAdapter>(); store.Initialize(product, runs, billing, board);
                    yield return Rendered(store, AppPage.Home);
                    use(store.GetComponent<PageShell>()); yield return null; yield return null;
                    yield return Held(store, phone + " Realms Home");
                    store.Navigate(AppPage.Profile); yield return Rendered(store, AppPage.Profile);
                    yield return Held(store, phone + " Realms profile");
                    // A realm's first visit is its guardian's greeting, a scene over the map.
                    store.Navigate(AppPage.Campaign); yield return Rendered(store, AppPage.Campaign); yield return new WaitForSecondsRealtime(.6f);
                    yield return Held(store, phone + " Realms greeting");
                    store.GetComponent<PageViews>().Greetings = new GuardianGreetings(() => ~0, _ => { });
                    store.Navigate(AppPage.Home); yield return Rendered(store, AppPage.Home);
                    store.Navigate(AppPage.Campaign); yield return Rendered(store, AppPage.Campaign);
                    yield return Held(store, phone + " Realms map");
                    store.Flow.Campaign.Preview(store.Flow.Campaign.Realm, 1); yield return Rendered(store, AppPage.Level);
                    yield return Held(store, phone + " Realms preview");
                    // The preview is a decision page: Map leaves it, and so does the Android back key.
                    Assert.That(store.GetComponent<PageViews>().GoBack(), Is.True, phone + ": the back key leaves the preview");
                    yield return Rendered(store, AppPage.Campaign);
                    store.Flow.Campaign.SelectRealm(2); yield return Rendered(store, AppPage.Campaign); yield return new WaitForSecondsRealtime(.6f);
                    yield return Held(store, phone + " Realms realm waiting for stars");
                    product.Write(state => { state.Stars[9] = 1; state.Stars[19] = 1; state.Stars[29] = 1; return state; });
                    store.Flow.Campaign.SelectRealm(4); yield return Rendered(store, AppPage.Campaign); yield return new WaitForSecondsRealtime(.6f);
                    yield return Held(store, phone + " Realms realm waiting for its purchase");
                    store.Navigate(AppPage.Settings); yield return Rendered(store, AppPage.Settings);
                    yield return Held(store, phone + " Realms settings");
                    store.GetComponent<PageViews>().Teach(Lessons.HowToPlay(false), null); yield return new WaitForSecondsRealtime(.6f);
                    yield return Held(store, phone + " Realms lesson");
                    store.GetComponentsInChildren<UnityEngine.UI.Button>().First(button => button.name == "Skip lesson").onClick.Invoke(); yield return null;
                    store.Flow.PlayDaily(); yield return Rendered(store, AppPage.Result);
                    yield return Held(store, phone + " Realms Daily result");
                }
                finally { UnityEngine.Object.Destroy(local); billing?.Dispose(); }
                yield return null;
            }
        }

        // The way back (owner, 2026-10-06). No page has a button in its top band. A page under a
        // tab's main page keeps the tab bar with its parent tab lit; the lit tab and the Android
        // back key both return to that main page, and on the main page the lit tab does nothing. A
        // decision page has no tab bar: its foot row leaves it, and the back key takes its decline.
        [UnityTest] public IEnumerator TheLitTabAndTheBackKeyReturnFromEveryPageUnderATabAndADecisionPageLeavesByItsFoot()
        {
            Lessons.Device = Lessons.Memory(taught: true);
            yield return PrepareScenario("owner-overview"); Click("Connect"); yield return Idle();
            var views = host.GetComponent<PageViews>();
            IEnumerator Opened(System.Threading.Tasks.Task open) { yield return Wait(open); yield return Idle(); }
            IEnumerator Tapped(AppPage tab, string button) { Adapter.Navigate(tab); yield return Idle(); if (tab == AppPage.Profile) yield return Opened(Adapter.OpenProfile()); Click(button); yield return Idle(); }
            var tabsInOrder = new[] { AppPage.Home, AppPage.Campaign, AppPage.Profile, AppPage.Settings };

            // A tab's main page: nowhere to go back to, and its lit tab reads nothing and stays.
            Assert.That(views.Shown, Is.EqualTo(AppPage.Home)); Assert.That(views.GoBack(), Is.False, "A tab's main page has nowhere to go back to");
            int calls = environment.Calls.Count;
            yield return SessionClick(LitTab); yield return Idle();
            Assert.That(environment.Calls.Count, Is.EqualTo(calls), "The lit tab of a main page does nothing");
            Assert.That(views.Shown, Is.EqualTo(AppPage.Home));

            var under = new (string panel, AppPage parent, System.Func<IEnumerator> open)[] {
                ("Kredits", AppPage.Home, () => Opened(Adapter.OpenKredits())),
                ("Boards", AppPage.Home, () => Opened(Adapter.OpenRewards())),
                ("Device", AppPage.Home, () => Opened(Adapter.OpenSession())),
                ("Device", AppPage.Settings, () => Tapped(AppPage.Settings, "Manage")),
                ("Operation", AppPage.Settings, () => Tapped(AppPage.Settings, "Last operation")),
                ("Profile Records", AppPage.Profile, () => Tapped(AppPage.Profile, "Your records")),
                ("Profile Borders", AppPage.Profile, () => Tapped(AppPage.Profile, "Choose a border")) };
            foreach (var (panel, parent, open) in under)
                foreach (bool key in new[] { false, true })
                {
                    string at = panel + " under " + parent + (key ? " by the back key" : " by its lit tab");
                    yield return open();
                    Assert.That(views.ShownPanel, Is.EqualTo(panel), at);
                    var bar = host.GetComponentsInChildren<SkinTabBar>().Single(value => value.gameObject.activeInHierarchy);
                    Assert.That(tabsInOrder[bar.Selected], Is.EqualTo(parent), at + ": the parent tab is lit");
                    Assert.That(host.GetComponentsInChildren<Button>().Count(button => button.gameObject.activeInHierarchy && button.GetComponent<Placed>().Role == ScreenKit.Role.Tab),
                        Is.EqualTo(tabsInOrder.Length), at + ": the page keeps its tab bar");
                    if (key) Assert.That(views.GoBack(), Is.True, at); else yield return Return();
                    yield return Idle();
                    Assert.That(views.ShownPanel, Is.Null, at + ": the tab's main page"); Assert.That(views.Shown, Is.EqualTo(parent), at);
                }
            yield return EndScenario();

            // The entry confirmation: no tab bar; Not now leaves it, and so does the back key.
            yield return PrepareScenario("daily-playable"); Click("Connect"); yield return Idle(); views = host.GetComponent<PageViews>();
            foreach (bool key in new[] { false, true })
            {
                Click("Enter · 1 Kredit"); yield return Idle();
                Assert.That(views.ShownPanel, Is.EqualTo("Entry"));
                Assert.That(host.GetComponentsInChildren<SkinTabBar>().Any(bar => bar.gameObject.activeInHierarchy), Is.False, "A decision page has no tab bar");
                if (key) Assert.That(views.GoBack(), Is.True); else Click("Cancel entry");
                yield return Idle();
                Assert.That(views.Shown, Is.EqualTo(AppPage.Home)); Assert.That(environment.SentSignature, Is.Null, "Leaving the confirmation enters nothing");
            }
            yield return EndScenario();

            // Disabling a device: Keep enabled leaves the confirmation, and so does the back key.
            yield return PrepareScenario("session-enable-success"); Click("Connect"); yield return Idle(); views = host.GetComponent<PageViews>();
            yield return Opened(Adapter.OpenSession()); yield return Opened(Adapter.EnsureDeviceSession());
            foreach (bool key in new[] { false, true })
            {
                Click("Disable this device"); yield return Idle();
                Assert.That(views.ShownPanel, Is.EqualTo("Revoke"));
                Assert.That(host.GetComponentsInChildren<SkinTabBar>().Any(bar => bar.gameObject.activeInHierarchy), Is.False, "A decision page has no tab bar");
                if (key) Assert.That(views.GoBack(), Is.True); else Click("Keep enabled");
                yield return Idle();
                Assert.That(views.ShownPanel, Is.EqualTo("Device"), "The device stays enabled");
            }
            yield return EndScenario();

            // Wear selection: Keep current look puts the choice back; the back key returns to the
            // profile with the choice kept.
            yield return PrepareScenario("profile-success"); Click("Connect"); yield return Idle(); views = host.GetComponent<PageViews>();
            yield return Opened(Adapter.OpenProfile());
            Click("Emblem 8"); yield return Idle();
            Assert.That(views.ShownPanel, Is.EqualTo("Profile Selection"));
            Assert.That(host.GetComponentsInChildren<SkinTabBar>().Any(bar => bar.gameObject.activeInHierarchy), Is.False, "A decision page has no tab bar");
            Assert.That(views.GoBack(), Is.True); yield return Idle();
            Assert.That(views.Shown, Is.EqualTo(AppPage.Profile)); Assert.That(Adapter.SelectedEmblem, Is.EqualTo(8), "The back key keeps the choice");
            Click("Choose a border"); yield return Idle(); Click("Border 3"); yield return Idle();
            Assert.That(views.ShownPanel, Is.EqualTo("Profile Selection"));
            Click("Keep current look"); yield return Idle();
            Assert.That(views.Shown, Is.EqualTo(AppPage.Profile)); Assert.That(Adapter.SelectedEmblem, Is.Not.EqualTo(8), "Keep current look puts the choice back");
            Assert.That(environment.SentSignature, Is.Null); Assert.That(environment.ForbiddenCalls, Is.Zero);
            yield return EndScenario();
        }
    }
}
