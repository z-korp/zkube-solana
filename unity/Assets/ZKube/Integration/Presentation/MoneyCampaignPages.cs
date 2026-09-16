using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private RectTransform pageContent, overviewPanel, campaignPanel;
        private bool browsingCampaign;
        private byte browseRealm = 1, browseLevel;
        private MoneyRead<MoneyCampaignState> campaignRead;
        public bool BrowsingCampaign => browsingCampaign;
        public byte SelectedRealm => browseRealm;
        public byte SelectedTrial => browseLevel;

        public Task OpenCampaign() => RunCampaign(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingCampaign = true; browseLevel = 0; overviewPanel.gameObject.SetActive(false);
            await RefreshCampaignPage(epoch, token);
        });
        public Task OpenOverview()
        {
            if (Busy || detached || paused || !isActiveAndEnabled) return Task.CompletedTask;
            CloseProductViews(); ResetPageScroll(); return RefreshOverview();
        }
        private void CloseCampaignView()
        {
            ClearCampaignObservation(); browsingCampaign = false; browseLevel = 0;
            if (overviewPanel != null) overviewPanel.gameObject.SetActive(true);
        }
        private void ClearCampaignObservation()
        {
            campaignRead = null;
            if (browsingCampaign) RetireArtwork();
            if (campaignPanel != null) { campaignPanel.gameObject.SetActive(false); Destroy(campaignPanel.gameObject); campaignPanel = null; }
        }
        private async Task RefreshCampaignPage(long epoch, CancellationToken token)
        {
            ClearCampaignObservation();
            if (identity.Owner == null) { CloseCampaignView(); owner.text = "Connect your wallet to view Campaign progress."; return; }
            status.text = "Checking Campaign…";
            // Always leave a working way out when a read fails.
            DrawCampaignNotice("Campaign information is being checked.");
            var result = await Flow.RefreshCampaign(token);
            if (!Current(epoch) || !browsingCampaign) return;
            campaignRead = result; DrawCampaign(); status.text = "Campaign updated";
        }
        private void RefreshCampaignIdentity()
        {
            if (!browsingCampaign || campaignRead == null || campaignRead.IsCurrent) return;
            ClearCampaignObservation(); DrawCampaignNotice("Owner information changed. Refresh to view Campaign progress.");
            status.text = "Campaign needs refreshing";
        }
        private void DrawCampaignNotice(string message)
        {
            BeginCampaignPanel(); Label(campaignPanel, "Campaign", 32, true); Label(campaignPanel, message, 20, false);
            Button(campaignPanel, "Refresh Campaign", () => _ = RefreshOverview());
            shared.Navigation(campaignPanel);
        }
        private void BeginCampaignPanel()
        {
            ReplacePagePanel(ref campaignPanel, "Campaign browser");
        }
        private void DrawCampaign()
        {
            if (campaignRead.Value.Browse.Realms.Count == 0) { DrawCampaignNotice("Campaign trial data is unavailable."); return; }
            BeginCampaignPanel();
            shared.Render(browseLevel == 0 ? AppPage.Campaign : AppPage.Level, campaignPanel);
            Button(campaignPanel, "Refresh Campaign", () => _ = RefreshOverview());
            shared.Navigation(campaignPanel); Controls();
        }
        public CampaignPageView CampaignView()
        {
            var state = campaignRead.Value; var realm = state.Browse.Realms.Single(value => value.MapId == browseRealm);
            return new CampaignPageView {
                Realm = browseRealm, Stars = realm.Levels.Sum(value => value.Stars),
                Result = ResultAvailable("Campaign") ? PageAction("View result", () => OpenSharedPage(AppPage.Result), CanBrowse) : null,
                Notice = realm.Unlocked ? null : "Clear the previous realm's final trial to unlock this path.",
                SavedRun = state.Browse.SavedRealm.HasValue ? "Saved Campaign run · realm " + state.Browse.SavedRealm +
                    ", trial " + state.Browse.SavedLevel + ". " + RunText(state.Run) : null,
                Resume = state.Run != null && boardHost != null ? PageAction("Resume run", () => _ = ResumeCampaignRun(), CanBrowse) : null,
                Previous = PageAction("Previous", () => SelectRealm((byte)(browseRealm - 1)), () => CanBrowse() && browseRealm > 1),
                Next = PageAction("Next", () => SelectRealm((byte)(browseRealm + 1)), () => CanBrowse() && browseRealm < Protocol.Realms.Length),
                Trials = realm.Levels.Select(level => new CampaignTrialView {
                    Level = level.Level, Stars = level.Stars, Available = level.CanInspect,
                    Playing = state.Browse.SavedRealm == browseRealm && state.Browse.SavedLevel == level.Level,
                    CanOpen = CanBrowse, Open = () => { if (!CanBrowse()) return; browseLevel = level.Level; DrawCampaign(); }
                }).ToArray()
            };
        }
        public LevelPageView LevelPage()
        {
            var state = campaignRead.Value; var realm = state.Browse.Realms.Single(value => value.MapId == browseRealm);
            var level = realm.Levels[browseLevel - 1]; var rules = level.Rules;
            return new LevelPageView { Realm = browseRealm, Level = browseLevel, Stars = level.Stars,
                Moves = rules.MaxMoves, Score = rules.PointsRequired + " points",
                Primary = BoardView.ObjectiveName(rules.PrimaryKind, rules.PrimaryValue) + " · " + rules.PrimaryCount,
                Secondary = BoardView.ObjectiveName(rules.SecondaryKind, rules.SecondaryValue) + " · " + rules.SecondaryCount,
                Notice = level.SavedRules ? "Rules of your saved run" : null,
                Play = state.Run != null ? PageAction("Resume run", () => _ = ResumeCampaignRun(), () => CanBrowse() && boardHost != null) :
                    PageAction("Play", () => _ = StartSelectedTrial(), () => CanBrowse() && boardHost != null && realm.Unlocked && level.CanInspect),
                Back = PageAction("Back to map", () => { browseLevel = 0; DrawCampaign(); }, CanBrowse) };
        }
        private bool CanBrowse() => !paused && !detached && isActiveAndEnabled && campaignRead != null && campaignRead.IsCurrent;
        private void RefreshCampaignLayout() { if (browsingCampaign && CanBrowse()) DrawCampaign(); }
        private void SelectRealm(byte value)
        { if (!CanBrowse()) return; browseRealm = value; browseLevel = 0; DrawCampaign(); }
        private static void Stack(RectTransform rect)
        {
            var group = rect.gameObject.AddComponent<VerticalLayoutGroup>(); group.spacing = 12;
            group.childControlWidth = group.childControlHeight = true;
            group.childForceExpandWidth = true; group.childForceExpandHeight = false;
        }
    }
}
