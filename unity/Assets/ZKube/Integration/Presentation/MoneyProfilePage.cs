using System;
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
    public sealed partial class MoneyAppController
    {
        private RectTransform profilePanel;
        private Button profileButton;
        private MoneyRead<MoneyProfileState> profileRead;
        private bool browsingProfile, profilePortraitLoading;
        private byte selectedEmblem, selectedBorder;
        private readonly Dictionary<Button, byte> emblemButtons = new Dictionary<Button, byte>();
        private readonly Dictionary<Button, byte> borderButtons = new Dictionary<Button, byte>();
        private TMP_Text selectionText;
        private BoardArt profilePortraitArt;
        private long profileArtEpoch;
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
        private void ReleaseProfilePortraits()
        {
            profileArtEpoch++; profilePortraitLoading = false;
            if (profilePanel != null)
                foreach (var image in profilePanel.GetComponentsInChildren<Image>(true)) image.sprite = null;
            profilePortraitArt?.Dispose(); profilePortraitArt = null;
        }
        private void ClearProfileObservation()
        {
            profileRead = null; ReleaseProfilePortraits(); emblemButtons.Clear(); borderButtons.Clear(); selectionText = null;
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
        private static Color TierColor(byte id)
        { if (!ColorUtility.TryParseHtmlString(TierDefinition(id).Color, out var color)) throw new FormatException("Invalid generated tier colour"); return color; }
        private void BeginProfilePanel()
        {
            ReleaseProfilePortraits(); emblemButtons.Clear(); borderButtons.Clear(); selectionText = null;
            ReplacePagePanel(ref profilePanel, "Player profile"); Label(profilePanel, "Profile", 32, true);
        }
        private void ProfileNavigation()
        {
            Button(profilePanel, "Refresh profile", () => _ = RefreshOverview());
            Button(profilePanel, "Campaign", () => _ = OpenCampaign());
            Button(profilePanel, "Results", () => _ = OpenRewards());
            Button(profilePanel, "Overview", () => _ = OpenOverview());
            Button(profilePanel, "Disconnect", () => _ = Disconnect());
        }
        private void DrawProfileNotice(string message)
        { BeginProfilePanel(); Label(profilePanel, message, 20, false); ProfileNavigation(); }
        private void DrawProfile()
        {
            var state = profileRead.Value; var player = state.Profile; var worn = state.Identity;
            BeginProfilePanel();
            if (catalog == null) catalog = PageCatalog.Load();
            var portraits = new List<KeyValuePair<byte, Image>>();
            var displayed = EmblemDefinition(worn.DisplayedEmblem);
            Label(profilePanel, displayed.Name, 27, true).color = TierColor(player.WornTier);
            if (displayed.Kind == ProfileEmblemKind.Guardian)
            {
                var frame = Rect("Worn guardian", profilePanel);
                var height = frame.gameObject.AddComponent<LayoutElement>(); height.minHeight = height.preferredHeight = 112;
                var portrait = ProfilePortrait(frame, displayed.Realm, portraits);
                portrait.rectTransform.anchorMin = portrait.rectTransform.anchorMax = new Vector2(.5f, .5f);
                portrait.rectTransform.sizeDelta = new Vector2(96, 96);
            }
            Label(profilePanel, player.Owner, 16, false);
            Label(profilePanel, "Wearing · " + EmblemDefinition(worn.StoredEmblem).Name + " · " + TierDefinition(player.WornTier).Name + " border", 19, false);
            Label(profilePanel, "Ladder · " + player.LadderPoints.ToString("N0", CultureInfo.InvariantCulture) + " points", 26, true);
            Label(profilePanel, TierDefinition(player.CurrentTier).Name + (player.HighestTier > player.CurrentTier ?
                " · Best ever " + TierDefinition(player.HighestTier).Name : ""), 21, true).color = TierColor(player.CurrentTier);
            if (player.NextTierFloor.HasValue)
            {
                ulong remaining = player.NextTierFloor.Value > player.LadderPoints ? player.NextTierFloor.Value - player.LadderPoints : 0;
                Label(profilePanel, remaining.ToString("N0", CultureInfo.InvariantCulture) + " to " + TierDefinition((byte)(player.CurrentTier + 1)).Name, 18, false);
                var track = Rect("Ladder progress", profilePanel); track.gameObject.AddComponent<LayoutElement>().minHeight = 10;
                track.gameObject.AddComponent<Image>().color = new Color(.12f, .17f, .25f);
                var fill = Rect("Earned points", track); Stretch(fill);
                float fraction = (float)((decimal)(player.LadderPoints - player.CurrentTierFloor) / (player.NextTierFloor.Value - player.CurrentTierFloor));
                fill.anchorMax = new Vector2(Mathf.Clamp01(fraction), 1); fill.gameObject.AddComponent<Image>().color = TierColor(player.CurrentTier);
            }
            else Label(profilePanel, "Top tier", 18, false);
            var fields = player.Fields;
            Label(profilePanel, "Campaign · " + (state.Campaign.TotalStars.HasValue ? state.Campaign.TotalStars + " / 300 stars" : "Progress unavailable"), 22, true);
            Label(profilePanel, "Best Daily score · " + ((uint?)fields?["best_daily_score"] ?? 0).ToString("N0", CultureInfo.InvariantCulture), 20, false);
            uint streak = (uint?)fields?["entry_streak_days"] ?? 0;
            Label(profilePanel, streak == 0 ? "No entry streak yet" : streak + "-day entry streak", 20, false);
            foreach (string kind in new[] { "score", "theme" })
            {
                var record = fields?[kind + "_record"]; uint rank = (uint?)record?["best_prize_rank"] ?? 0;
                Label(profilePanel, (kind == "score" ? "Score" : "Theme") + " · Best paid place " + (rank == 0 ? "—" : "#" + rank) +
                    " · " + ((uint?)record?["wins"] ?? 0) + " wins", 19, false);
                Label(profilePanel, "Rewards · " + (((ulong?)record?["rewards_lamports"] ?? 0) / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL", 18, false);
            }
            if (!player.Exists) Label(profilePanel, "Set up this device to create your player profile.", 20, false);
            if (!worn.ProgressAvailable) Label(profilePanel, "Campaign progress is unavailable. Refresh to check earned emblems.", 20, false);
            if (state.Pending != null)
            { Label(profilePanel, "Check your pending transaction before changing your profile.", 20, false); Button(profilePanel, "Check transaction", () => _ = CheckTransaction()); }
            else if (!state.Session.Current || state.Session.Funding != "ready")
            { Label(profilePanel, "Set up this device to change your emblem or border.", 20, false); Button(profilePanel, "This device", () => _ = OpenSession()); }
            Label(profilePanel, "Emblem", 26, true);
            Label(profilePanel, "Defeat a guardian to wear its emblem. Automatic follows your strongest earned emblem.", 18, false);
            int columns = safe.rect.width < 370 || textScale > 1 ? 2 : 3;
            RectTransform row = null; int index = 0;
            foreach (var choice in worn.Emblems)
            {
                if (index++ % columns == 0)
                {
                    row = Rect("Emblem row", profilePanel);
                    var layout = row.gameObject.AddComponent<HorizontalLayoutGroup>(); layout.spacing = 8; layout.childControlWidth = true;
                    layout.childForceExpandWidth = true; layout.childControlHeight = true; layout.childForceExpandHeight = true;
                    row.gameObject.AddComponent<LayoutElement>().minHeight = 102 * textScale;
                }
                byte selected = choice.Definition.Id;
                var button = Button(row, choice.Definition.Name, () => SelectProfileEmblem(selected)); button.name = "Emblem " + selected;
                button.gameObject.GetComponent<LayoutElement>().flexibleWidth = 1;
                var label = button.GetComponentInChildren<TMP_Text>(); label.fontSize = 15 * textScale;
                if (choice.Definition.Kind == ProfileEmblemKind.Guardian)
                {
                    var image = ProfilePortrait((RectTransform)button.transform, choice.Definition.Realm, portraits);
                    image.rectTransform.anchorMin = new Vector2(.25f, .4f); image.rectTransform.anchorMax = new Vector2(.75f, .95f);
                    image.rectTransform.offsetMin = image.rectTransform.offsetMax = Vector2.zero;
                    image.color = choice.Earned ? Color.white : new Color(.45f, .45f, .45f, 1);
                    label.rectTransform.anchorMax = new Vector2(1, .4f);
                }
                emblemButtons.Add(button, selected);
            }
            Label(profilePanel, "Border", 26, true);
            foreach (var tier in ProfileIdentityCatalog.Tiers)
            {
                byte selected = tier.Id;
                var button = Button(profilePanel, tier.Name, () => SelectProfileBorder(selected)); button.name = "Border " + selected;
                button.targetGraphic.color = Color.Lerp(TierColor(selected), new Color(.08f, .1f, .15f), .6f);
                borderButtons.Add(button, selected);
            }
            selectionText = Label(profilePanel, "", 19, false);
            Button(profilePanel, "Wear selection", () => _ = WearProfileSelection());
            ProfileNavigation(); UpdateProfileSelection();
            if (portraits.Count > 0) StartCoroutine(LoadProfilePortraits(portraits, profileArtEpoch));
        }
        private Image ProfilePortrait(RectTransform parent, byte realm, List<KeyValuePair<byte, Image>> portraits)
        {
            var image = Rect("Guardian portrait", parent).gameObject.AddComponent<Image>(); image.enabled = false;
            image.preserveAspect = true; image.raycastTarget = false; portraits.Add(new KeyValuePair<byte, Image>(realm, image)); return image;
        }
        private IEnumerator LoadProfilePortraits(List<KeyValuePair<byte, Image>> portraits, long epoch)
        {
            profilePortraitLoading = true;
            var owned = profilePortraitArt = new BoardArt(); var request = owned.LoadPortraits();
            while (true)
            {
                bool more;
                try { more = request.MoveNext(); }
                catch (Exception) { ProfilePortraitFailure(owned, epoch); yield break; }
                if (!more) break; yield return request.Current;
            }
            if (epoch != profileArtEpoch || !browsingProfile) { owned.Dispose(); yield break; }
            try
            {
                foreach (var pair in portraits)
                    if (pair.Value != null) { pair.Value.sprite = owned.Sprite(catalog.Portrait(pair.Key).sprite); pair.Value.enabled = true; }
            }
            catch (Exception) { ProfilePortraitFailure(owned, epoch); yield break; }
            profilePortraitLoading = false;
        }
        private void ProfilePortraitFailure(BoardArt owned, long epoch)
        {
            if (epoch == profileArtEpoch)
            {
                if (profilePanel != null) foreach (var image in profilePanel.GetComponentsInChildren<Image>(true)) image.sprite = null;
                profilePortraitLoading = false; status.text = "Portraits unavailable. Refresh to try again.";
            }
            owned.Dispose();
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
        {
            if (profileRead == null || !profileRead.IsCurrent) return;
            foreach (var pair in emblemButtons)
            {
                var choice = profileRead.Value.Identity.Emblems.Single(value => value.Definition.Id == pair.Value);
                pair.Key.GetComponentInChildren<TMP_Text>().text = choice.Definition.Name + "\n" +
                    (!choice.Earned ? "Locked" : pair.Value == selectedEmblem ? "Selected" : choice.Gold ? "Perfected" : "Earned");
            }
            foreach (var pair in borderButtons)
                pair.Key.GetComponentInChildren<TMP_Text>().text = TierDefinition(pair.Value).Name +
                    (pair.Value > profileRead.Value.Profile.HighestTier ? " · Locked" : pair.Value == selectedBorder ? " · Selected" : "");
            if (selectionText != null) selectionText.text = "Selection · " + EmblemDefinition(selectedEmblem).Name + " · " + TierDefinition(selectedBorder).Name;
            Controls();
        }
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
        private void ProfileControls(bool available)
        {
            if (profileButton != null) profileButton.interactable = available && !Busy && identity?.Owner != null;
            if (profilePanel == null) return;
            foreach (var button in profilePanel.GetComponentsInChildren<Button>(true))
            {
                bool enabled = available && (button.name == "Disconnect" || !Busy);
                if (emblemButtons.TryGetValue(button, out byte emblem)) enabled &= ProfileEditable() && profileRead.Value.Identity.CanWear(emblem, selectedBorder);
                if (borderButtons.TryGetValue(button, out byte border)) enabled &= ProfileEditable() && profileRead.Value.Identity.CanWear(selectedEmblem, border);
                if (button.name == "Wear selection") enabled &= ProfileEditable() && ProfileSelectionChanged();
                button.interactable = enabled;
            }
        }
    }
}
