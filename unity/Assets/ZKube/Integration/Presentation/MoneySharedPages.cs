using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private RectTransform sharedPanel;
        private AppPage? sharedPage;
        private ResultPageView lastResult;

        private static PageAction PageAction(string text, Action invoke, Func<bool> available = null) =>
            new PageAction { Label = text, Invoke = invoke, CanInvoke = available };
        private bool PageAvailable() => Flow != null && !detached && !paused && isActiveAndEnabled && !PlayingRun;
        public bool CanNavigate(AppPage page) => PageAvailable() &&
            (page == AppPage.Campaign ? identity.Owner != null : !Busy && (page == AppPage.Settings || identity.Owner != null));
        public void Navigate(AppPage page)
        {
            if (!CanNavigate(page)) return;
            switch (page)
            {
                case AppPage.Campaign: _ = OpenCampaign(); break;
                case AppPage.Daily: _ = OpenDaily(); break;
                case AppPage.Profile: _ = OpenProfile(); break;
                case AppPage.Settings: OpenSharedPage(page); break;
                case AppPage.Result: OpenSharedPage(page); break;
                default: throw new ArgumentOutOfRangeException(nameof(page));
            }
        }
        public IReadOnlyList<PageAction> IdentityNavigation
        {
            get
            {
                var actions = new List<PageAction> {
            PageAction("This device", () => _ = OpenSession(), () => PageAvailable() && !Busy && identity.Owner != null),
            PageAction("Kredits", () => _ = OpenKredits(), () => PageAvailable() && !Busy && identity.Owner != null),
            PageAction("Results", () => _ = OpenRewards(), () => PageAvailable() && !Busy && identity.Owner != null),
                    PageAction("Overview", () => _ = OpenOverview(), () => PageAvailable() && !Busy)
                };
                if (overviewPanel != null && !overviewPanel.gameObject.activeSelf)
                    actions.Add(PageAction("Disconnect", () => _ = Disconnect(), () => PageAvailable() && identity.Owner != null));
                return actions;
            }
        }
        public void Report(Exception error) => ShowError(error);
        private void CloseSharedView()
        {
            sharedPage = null;
            if (sharedPanel != null) { sharedPanel.gameObject.SetActive(false); Destroy(sharedPanel.gameObject); sharedPanel = null; }
        }
        private void OpenSharedPage(AppPage page)
        { CloseProductViews(); sharedPage = page; overviewPanel.gameObject.SetActive(false); _ = RefreshSharedPage(); }
        private Task RefreshSharedPage()
        {
            ReplacePagePanel(ref sharedPanel, sharedPage.Value.ToString());
            shared.Initialize(this, heading, body, textScale, () => injectedDensity ?? BoardController.ReadDisplayDensity());
            shared.Render(sharedPage.Value, sharedPanel); shared.Navigation(sharedPanel);
            return Task.CompletedTask;
        }
        public SettingsPageView SettingsPage() => AppPreferences.Read(() => {
            textScale = BoardController.ReadSavedTextScale(); _ = RefreshSharedPage();
        });
        public ResultPageView ResultPage()
        {
            var value = lastResult != null && lastResult.PlayerName == identity.Owner ? lastResult :
                new ResultPageView { ProductName = Application.productName, Mode = "Daily", Realm = 1, PlayerName = identity.Owner ?? "" };
            value.NativeSharing = ResultSharing.NativeAvailable; value.Share = ResultSharing.Open;
            value.Done = PageAction("Done", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            return value;
        }
        private bool ResultAvailable(string mode) => lastResult != null && lastResult.HasResult &&
            lastResult.PlayerName == identity.Owner && lastResult.Mode == mode;
    }
}
