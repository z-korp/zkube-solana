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
    public sealed partial class MoneyAppController
    {
        private RectTransform pageContent, overviewPanel, campaignPanel;
        private Button campaignButton;
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
        private void CampaignControls(bool available)
        {
            if (campaignButton != null) campaignButton.interactable = available && identity?.Owner != null;
            if (campaignPanel == null) return;
            foreach (var button in campaignPanel.GetComponentsInChildren<Button>(true))
                button.interactable = available &&
                    (button.name == "Overview" || button.name == "Refresh Campaign" ||
                     (campaignRead != null && campaignRead.IsCurrent && !button.name.StartsWith("Locked trial", StringComparison.Ordinal)));
        }
        private void DrawCampaignNotice(string message)
        {
            BeginCampaignPanel(); Label(campaignPanel, "Campaign", 32, true); Label(campaignPanel, message, 20, false);
            Button(campaignPanel, "Refresh Campaign", () => _ = RefreshOverview());
            Button(campaignPanel, "Overview", () => _ = OpenOverview());
        }
        private void BeginCampaignPanel()
        {
            ReplacePagePanel(ref campaignPanel, "Campaign browser");
        }
        private void DrawCampaign()
        {
            var state = campaignRead.Value;
            if (state.Browse.Realms.Count == 0)
            {
                DrawCampaignNotice("Campaign trial data is unavailable.");
                return;
            }
            var realm = state.Browse.Realms.Single(value => value.MapId == browseRealm);
            BeginCampaignPanel();
            if (catalog == null) catalog = PageCatalog.Load();
            var page = catalog.Realm(browseRealm);
            Label(campaignPanel, "Campaign · " + page.realmName, 30, true);
            Label(campaignPanel, page.guardianName + " · " + realm.Levels.Sum(level => level.Stars) + " / 30 stars", 21, false);
            if (Protocol.Realms.Any(value => value.MapId == realm.ThemeId)) RequestArt(realm.ThemeId);
            else { RetireArtwork(); Label(campaignPanel, "Artwork is unavailable for this realm.", 18, false); }
            DrawRunControls(state);
            if (state.Browse.SavedRealm.HasValue)
                Label(campaignPanel, "Saved Campaign run · realm " + state.Browse.SavedRealm + ", trial " + state.Browse.SavedLevel + ". " + RunText(state.Run), 19, false);
            else if (state.Run != null) Label(campaignPanel, RunText(state.Run), 18, false);
            if (browseLevel != 0)
            {
                var level = realm.Levels[browseLevel - 1];
                if (!level.CanInspect) { browseLevel = 0; DrawCampaign(); return; }
                var rules = level.Rules;
                Label(campaignPanel, level.Level == Protocol.CampaignTargets.Length ? "Trial of " + page.guardianName : "Trial " + level.Level, 28, true);
                Label(campaignPanel, level.Stars + " stars · " + rules.MaxMoves + " moves · Difficulty tier " + rules.FixedTier, 20, false);
                if (level.SavedRules) Label(campaignPanel, "Rules of your saved run", 18, false);
                Label(campaignPanel, "Earn each star by meeting its rule", 19, false);
                Label(campaignPanel, "Score · " + rules.PointsRequired + " points", 20, false);
                Label(campaignPanel, "Shape · " + BoardView.ObjectiveName(rules.PrimaryKind, rules.PrimaryValue) + " · " + rules.PrimaryCount, 20, false);
                Label(campaignPanel, "Blow · " + BoardView.ObjectiveName(rules.SecondaryKind, rules.SecondaryValue) + " · " + rules.SecondaryCount, 20, false);
                Button(campaignPanel, "Back to map", () => { if (!CanBrowse()) return; browseLevel = 0; DrawCampaign(); });
            }
            else
            {
                var navigation = Rect("Campaign realms", campaignPanel);
                navigation.gameObject.AddComponent<LayoutElement>().minHeight = BrowseTouch(52);
                var row = navigation.gameObject.AddComponent<HorizontalLayoutGroup>(); row.spacing = 8; row.childForceExpandWidth = true; row.childControlWidth = row.childControlHeight = true;
                Button(navigation, "Previous realm", () => SelectRealm(browseRealm == 1 ? checked((byte)Protocol.Realms.Length) : (byte)(browseRealm - 1)));
                Button(navigation, "Next realm", () => SelectRealm(browseRealm == Protocol.Realms.Length ? (byte)1 : (byte)(browseRealm + 1)));
                if (!realm.Enabled) Label(campaignPanel, "This realm is unavailable for play.", 18, false);
                if (!realm.Unlocked) Label(campaignPanel, "Clear the previous realm's final trial to unlock this path.", 18, false);
                Canvas.ForceUpdateCanvases();
                float width = campaignPanel.rect.width - campaignPanel.GetComponent<VerticalLayoutGroup>().padding.horizontal;
                float size = BrowseTouch(64 * textScale);
                var map = Rect("Authored Campaign path", campaignPanel);
                map.gameObject.AddComponent<LayoutElement>().preferredHeight = CampaignPathGraphic.RequiredMapHeight(page, width, size, 660 * textScale);
                var graphic = map.gameObject.AddComponent<CampaignPathGraphic>();
                foreach (var level in realm.Levels)
                {
                    byte target = level.Level;
                    var button = Button(map, "Trial " + target, () => { if (!CanBrowse()) return; browseLevel = target; DrawCampaign(); });
                    if (!level.CanInspect) button.name = "Locked trial " + target;
                    button.interactable = level.CanInspect;
                    var rect = (RectTransform)button.transform; var point = page.campaignPath[target - 1];
                    rect.anchorMin = rect.anchorMax = new Vector2(point.x, 1 - point.y); rect.pivot = new Vector2(.5f, .5f);
                    rect.sizeDelta = new Vector2(size, size); rect.anchoredPosition = Vector2.zero;
                    var label = button.GetComponentInChildren<TMP_Text>();
                    label.text = (target == Protocol.CampaignTargets.Length ? "BOSS" : target.ToString()) + "\n" + new string('★', level.Stars) + new string('☆', 3 - level.Stars);
                    label.fontSize = 16 * textScale; label.textWrappingMode = TextWrappingModes.NoWrap;
                    label.rectTransform.offsetMin = Vector2.one * 4; label.rectTransform.offsetMax = Vector2.one * -4;
                }
                // MapPage names/coordinates use mapId; scenery and path styling
                // use the catalog themeId.
                var style = catalog.themes.FirstOrDefault(value => value.realmId == realm.ThemeId)?.map;
                graphic.Configure(page, realm.Levels.Select(level => level.State).ToArray(), style);
            }
            Button(campaignPanel, "Refresh Campaign", () => _ = RefreshOverview());
            Button(campaignPanel, "Overview", () => _ = OpenOverview());
            Controls();
        }
        private bool CanBrowse() => !paused && !detached && isActiveAndEnabled && campaignRead != null && campaignRead.IsCurrent;
        private void RefreshCampaignLayout() { if (browsingCampaign && CanBrowse()) DrawCampaign(); }
        private void SelectRealm(byte value)
        { if (!CanBrowse()) return; browseRealm = value; browseLevel = 0; DrawCampaign(); }
        private float BrowseTouch(float preferred) => BoardLayout.CanvasTouchSize(preferred,
            injectedDensity ?? BoardController.ReadDisplayDensity(), root.GetComponent<Canvas>().scaleFactor);
        private static void Stack(RectTransform rect)
        {
            var group = rect.gameObject.AddComponent<VerticalLayoutGroup>(); group.spacing = 12;
            group.childControlWidth = group.childControlHeight = true;
            group.childForceExpandWidth = true; group.childForceExpandHeight = false;
        }
    }
}
