using System;
using ZKube.Integration.Client;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private bool browsingCampaign;
        private byte browseRealm = 1, browseLevel;
        private MoneyRead<MoneyCampaignState> campaignRead;
        public bool BrowsingCampaign => browsingCampaign;
        public byte SelectedRealm => browseRealm;
        public byte SelectedTrial => browseLevel;

        public Task OpenCampaign() => RunCampaign(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingCampaign = true; browseLevel = 0;
            await RefreshCampaignPage(epoch, token);
        });
        private void CloseCampaignView() { ClearCampaignObservation(); browsingCampaign = false; browseLevel = 0; }
        private void ClearCampaignObservation() { campaignRead = null; pageNotice = null; Present(); }
        private async Task RefreshCampaignPage(long epoch, CancellationToken token)
        {
            ClearCampaignObservation();
            if (identity.Owner == null) { CloseCampaignView(); return; }
            Status = "Checking Campaign…";
            // Always leave a working way out when a read fails.
            Notice("Campaign information is being checked.");
            var result = await Flow.RefreshCampaign(token);
            if (!Current(epoch) || !browsingCampaign) return;
            campaignRead = result; pageNotice = null; Present(); Status = "Campaign updated";
        }
        private void RefreshCampaignIdentity()
        {
            if (!browsingCampaign || campaignRead == null || campaignRead.IsCurrent) return;
            ClearCampaignObservation(); Notice("Owner information changed. Refresh to view Campaign progress.");
            Status = "Campaign needs refreshing";
        }
        public CampaignPageView CampaignView()
        {
            var state = campaignRead.Value; var realm = state.Browse.Realms.Single(value => value.MapId == browseRealm);
            return new CampaignPageView {
                Realm = browseRealm, Stars = realm.Levels.Sum(value => value.Stars),
                Result = ResultAvailable("Campaign") ? PageAction("View result", () => OpenSharedPage(AppPage.Result), CanBrowse) : null,
                Locked = realm.Unlocked ? null : Locked(),
                SavedRun = state.Browse.SavedRealm.HasValue ? "Saved Campaign run · realm " + state.Browse.SavedRealm +
                    ", trial " + state.Browse.SavedLevel + ". " + RunText(state.Run) : null,
                Resume = state.Run != null && boardHost != null ? PageAction("Resume run", () => _ = ResumeCampaignRun(), CanBrowse) : null,
                Previous = PageAction("Previous", () => SelectRealm((byte)(browseRealm - 1)), () => CanBrowse() && browseRealm > 1),
                Next = PageAction("Next", () => SelectRealm((byte)(browseRealm + 1)), () => CanBrowse() && browseRealm < Protocol.Realms.Length),
                Trials = realm.Levels.Select(level => new CampaignTrialView {
                    Level = level.Level, Stars = level.Stars, Available = level.CanInspect,
                    Playing = state.Browse.SavedRealm == browseRealm && state.Browse.SavedLevel == level.Level,
                    CanOpen = CanBrowse, Open = () => { if (!CanBrowse()) return; browseLevel = level.Level; Present(); }
                }).ToArray()
            };
        }
        public LevelPageView LevelPage()
        {
            var state = campaignRead.Value; var realm = state.Browse.Realms.Single(value => value.MapId == browseRealm);
            var level = realm.Levels[browseLevel - 1]; var rules = level.Rules;
            return new LevelPageView { Realm = browseRealm, Level = browseLevel, Stars = level.Stars,
                Moves = rules.MaxMoves, Goals = new CampaignGoals { Points = rules.PointsRequired,
                    PrimaryKind = rules.PrimaryKind, PrimaryValue = rules.PrimaryValue, PrimaryCount = rules.PrimaryCount,
                    SecondaryKind = rules.SecondaryKind, SecondaryValue = rules.SecondaryValue, SecondaryCount = rules.SecondaryCount },
                Notice = level.SavedRules ? "Rules of your saved run" : null,
                Play = state.Run != null ? PageAction("Resume run", () => _ = ResumeCampaignRun(), () => CanBrowse() && boardHost != null) :
                    PageAction("Play", () => _ = StartSelectedTrial(), () => CanBrowse() && boardHost != null && realm.Unlocked && level.CanInspect),
                Back = PageAction("Back to map", () => { browseLevel = 0; Present(); }, CanBrowse) };
        }
        private static string RunText(ZKube.Integration.Client.Runs.RunClientState state)
        {
            if (state == null) return "Not checked yet";
            return state.Phase switch {
                "none" => "No saved run", "base" => "Run saved", "delegated" => "Run saved",
                "resolving" => "Loading saved run", "settleable" => "Result awaiting settlement", "consumed" => "Result settled",
                "identity-changed" => "Reconnect to check this run", "other-action-pending" => "Check the pending transaction first",
                _ => "Saved run unavailable. Refresh to check again."
            };
        }
        private static string RunText(ZKube.Local.LocalRunView state) => state == null ? "No saved run" : "Saved on this device";
        private bool CanBrowse() => !paused && !detached && isActiveAndEnabled && campaignRead != null && campaignRead.IsCurrent;
        private void SelectRealm(byte value)
        { if (!CanBrowse()) return; browseRealm = value; browseLevel = 0; Present(); }
        // A realm opens when the previous realm's guardian is beaten.
        private string Locked()
        {
            var here = catalog.Realm(browseRealm); var before = catalog.Realm((byte)(browseRealm - 1));
            return "Clear " + before.guardianName + "’s final trial in " + before.realmName + " to open " + here.realmName + ".";
        }
    }
}
