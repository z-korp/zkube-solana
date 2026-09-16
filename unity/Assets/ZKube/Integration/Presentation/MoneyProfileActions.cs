using System;
using ZKube.Integration.Client;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private RectTransform profilePanel;
        private MoneyRead<MoneyProfileState> profileRead;
        private bool browsingProfile;
        private byte selectedEmblem, selectedBorder;
        public bool BrowsingProfile => browsingProfile;
        public byte SelectedEmblem => selectedEmblem;
        public byte SelectedBorder => selectedBorder;

        public Task OpenProfile() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingProfile = true;
            overviewPanel.gameObject.SetActive(false);
            await RefreshProfilePage(epoch, token);
        });
        private void CloseProfileView()
        {
            ClearProfileObservation(); browsingProfile = false;
            if (overviewPanel != null) overviewPanel.gameObject.SetActive(true);
        }
        private void ClearProfileObservation()
        {
            profileRead = null; shared.Retire();
            if (profilePanel != null) { profilePanel.gameObject.SetActive(false); Destroy(profilePanel.gameObject); profilePanel = null; }
        }
        private async Task RefreshProfilePage(long epoch, CancellationToken token)
        {
            ClearProfileObservation();
            if (identity.Owner == null) { CloseProfileView(); return; }
            DrawProfileNotice("Checking your profile…"); status.text = "Checking profile…";
            var read = await Flow.RefreshProfile(token);
            if (!Current(epoch) || !browsingProfile) return;
            profileRead = read; economyReadbackNeeded = false;
            selectedEmblem = read.Value.Identity.StoredEmblem; selectedBorder = read.Value.Profile.WornTier;
            if (read.Value.PreviousOperation != null) ShowReceipt(read.Value.PreviousOperation, identity.Owner);
            DrawProfile(); status.text = "Profile updated";
        }
        private void RefreshProfileIdentity()
        {
            if (economyReadbackNeeded && browsingProfile && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingProfile || profileRead == null || profileRead.IsCurrent) return;
            ClearProfileObservation(); DrawProfileNotice("Your profile changed. Refresh before choosing what to wear.");
            status.text = "Profile needs refreshing";
        }
        private bool ProfileEditable() => browsingProfile && !Busy && !sessionActionPending && !economyActionPending &&
            !paused && !detached && isActiveAndEnabled && profileRead != null && profileRead.IsCurrent &&
            profileRead.Value.Pending == null && profileRead.Value.Session.Current && profileRead.Value.Session.Funding == "ready";
        private bool ProfileSelectionChanged() => profileRead != null && profileRead.IsCurrent &&
            (selectedEmblem != profileRead.Value.Identity.StoredEmblem || selectedBorder != profileRead.Value.Profile.WornTier);
        private static ProfileEmblemDefinition EmblemDefinition(byte id) => ProfileIdentityCatalog.Emblems.Single(value => value.Id == id);
        private static ProfileTierDefinition TierDefinition(byte id) => ProfileIdentityCatalog.Tiers.Single(value => value.Id == id);
        private void BeginProfilePanel() => ReplacePagePanel(ref profilePanel, "Player profile");
        private void ProfileNavigation()
        {
            Button(profilePanel, "Refresh profile", () => _ = RefreshOverview()); shared.Navigation(profilePanel);
        }
        private void DrawProfileNotice(string message)
        { BeginProfilePanel(); Label(profilePanel, message, 20, false); ProfileNavigation(); }
        private void DrawProfile()
        {
            BeginProfilePanel(); shared.Render(AppPage.Profile, profilePanel); ProfileNavigation(); Controls();
        }
        public ProfilePageView ProfilePage()
        {
            var state = profileRead.Value; var player = state.Profile; var worn = state.Identity; var fields = player.Fields;
            var facts = new List<string> {
                "Ladder · " + player.LadderPoints.ToString("N0") + " points",
                TierDefinition(player.CurrentTier).Name + (player.HighestTier > player.CurrentTier ? " · Best ever " + TierDefinition(player.HighestTier).Name : "")
            };
            if (player.NextTierFloor.HasValue)
                facts.Add((player.NextTierFloor.Value > player.LadderPoints ? player.NextTierFloor.Value - player.LadderPoints : 0).ToString("N0") + " to " + TierDefinition((byte)(player.CurrentTier + 1)).Name);
            else facts.Add("Top tier");
            foreach (string kind in new[] { "score", "theme" })
            {
                var record = fields?[kind + "_record"]; uint rank = (uint?)record?["best_prize_rank"] ?? 0;
                facts.Add((kind == "score" ? "Score" : "Theme") + " · Best paid place " + (rank == 0 ? "—" : "#" + rank) + " · " + ((uint?)record?["wins"] ?? 0) + " wins");
                facts.Add("Rewards · " + (((ulong?)record?["rewards_lamports"] ?? 0) / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL");
            }
            if (!player.Exists) facts.Add("Set up this device to create your player profile.");
            if (!worn.ProgressAvailable) facts.Add("Campaign progress is unavailable. Refresh to check earned emblems.");
            if (state.Pending != null) facts.Add("Check your pending transaction before changing your profile.");
            else if (!state.Session.Current || state.Session.Funding != "ready") facts.Add("Set up this device to change your emblem or border.");
            return new ProfilePageView {
                Name = player.Owner, Worn = "Wearing · " + EmblemDefinition(worn.StoredEmblem).Name + " · " + TierDefinition(player.WornTier).Name + " border",
                Realm = Math.Max((byte)1, EmblemDefinition(worn.DisplayedEmblem).Realm), Stars = state.Campaign.TotalStars ?? 0,
                Streak = (uint?)fields?["entry_streak_days"] ?? 0, BestDailyScore = (uint?)fields?["best_daily_score"] ?? 0,
                Facts = facts.ToArray(), Notice = "Selection · " + EmblemDefinition(selectedEmblem).Name + " · " + TierDefinition(selectedBorder).Name,
                Actions = state.Pending == null ? Array.Empty<PageAction>() :
                    new[] { PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy) },
                Emblems = worn.Emblems.Select(choice => {
                    byte id = choice.Definition.Id;
                    return new ProfileChoiceView { Id = id, Realm = choice.Definition.Kind == ProfileEmblemKind.Guardian ? choice.Definition.Realm : (byte)0,
                        Name = choice.Definition.Name, Detail = !choice.Earned ? "Locked" : id == selectedEmblem ? "Selected" : choice.Gold ? "Perfected" : "Earned",
                        Available = choice.Earned, CanSelect = () => ProfileEditable() && profileRead.Value.Identity.CanWear(id, selectedBorder),
                        Select = () => SelectProfileEmblem(id) };
                }).ToArray(),
                Borders = ProfileIdentityCatalog.Tiers.Select(tier => {
                    byte id = tier.Id;
                    return new ProfileChoiceView { Id = id, Name = tier.Name, Available = id <= player.HighestTier,
                        Detail = id > player.HighestTier ? "Locked" : id == selectedBorder ? "Selected" : null,
                        CanSelect = () => ProfileEditable() && profileRead.Value.Identity.CanWear(selectedEmblem, id), Select = () => SelectProfileBorder(id) };
                }).ToArray(),
                Save = PageAction("Wear selection", () => _ = WearProfileSelection(), () => ProfileEditable() && ProfileSelectionChanged())
            };
        }
        public void SelectProfileEmblem(byte emblem)
        {
            if (!ProfileEditable() || !profileRead.Value.Identity.CanWear(emblem, selectedBorder)) return;
            selectedEmblem = emblem; UpdateProfileSelection();
        }
        public void SelectProfileBorder(byte border)
        {
            if (!ProfileEditable() || !profileRead.Value.Identity.CanWear(selectedEmblem, border)) return;
            selectedBorder = border; UpdateProfileSelection();
        }
        private void UpdateProfileSelection()
        { if (profileRead != null && profileRead.IsCurrent) DrawProfile(); }
        public Task WearProfileSelection()
        {
            if (!ProfileEditable() || !ProfileSelectionChanged() || !profileRead.Value.Identity.CanWear(selectedEmblem, selectedBorder)) return Task.CompletedTask;
            byte emblem = selectedEmblem, border = selectedBorder;
            return Run(async (epoch, token) => {
                economyActionPending = true; status.text = "Saving selection…"; Controls();
                try
                {
                    var result = await Flow.SetFeaturedIdentity(emblem, border, token);
                    if (!Current(epoch)) return;
                    ShowReceipt(result.Value, identity.Owner); await RefreshProfilePage(epoch, token);
                }
                finally
                {
                    economyActionPending = false;
                    if (Current(epoch)) Controls(); else economyReadbackNeeded = true;
                }
            });
        }
    }
}
