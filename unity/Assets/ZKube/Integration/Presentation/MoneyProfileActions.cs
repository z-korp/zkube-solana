using System;
using ZKube.Integration.Client;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private enum ProfileView { Main, Records, Borders, Selection }
        private MoneyRead<MoneyProfileState> profileRead;
        private bool browsingProfile;
        private ProfileView profileView;
        private byte selectedEmblem, selectedBorder;
        public bool BrowsingProfile => browsingProfile;
        public byte SelectedEmblem => selectedEmblem;
        public byte SelectedBorder => selectedBorder;

        public Task OpenProfile() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingProfile = true; profileView = ProfileView.Main;
            await RefreshProfilePage(epoch, token);
        });
        private void CloseProfileView() { ClearProfileObservation(); browsingProfile = false; profileView = ProfileView.Main; }
        private void ClearProfileObservation() { profileRead = null; pageNotice = null; Present(); }
        private async Task RefreshProfilePage(long epoch, CancellationToken token)
        {
            ClearProfileObservation();
            if (identity.Owner == null) { CloseProfileView(); return; }
            Notice("Checking your profile…"); Status = "Checking profile…";
            var read = await Flow.RefreshProfile(token);
            if (!Current(epoch) || !browsingProfile) return;
            profileRead = read; economyReadbackNeeded = false; pageNotice = null;
            selectedEmblem = read.Value.Identity.StoredEmblem; selectedBorder = read.Value.Profile.WornTier;
            if (profileView == ProfileView.Selection) profileView = ProfileView.Main;
            if (read.Value.PreviousOperation != null) ShowReceipt(read.Value.PreviousOperation, identity.Owner);
            Present(); Status = "Profile updated";
        }
        private void RefreshProfileIdentity()
        {
            if (economyReadbackNeeded && browsingProfile && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingProfile || profileRead == null || profileRead.IsCurrent) return;
            ClearProfileObservation(); Notice("Your profile changed. Refresh before choosing what to wear.");
            Status = "Profile needs refreshing";
        }
        private bool ProfileEditable() => browsingProfile && !Busy && !sessionActionPending && !economyActionPending &&
            !paused && !detached && isActiveAndEnabled && profileRead != null && profileRead.IsCurrent &&
            profileRead.Value.Pending == null && profileRead.Value.Session.Current && profileRead.Value.Session.Funding == "ready";
        private bool ProfileSelectionChanged() => profileRead != null && profileRead.IsCurrent &&
            (selectedEmblem != profileRead.Value.Identity.StoredEmblem || selectedBorder != profileRead.Value.Profile.WornTier);
        private static ProfileEmblemDefinition EmblemDefinition(byte id) => ProfileEmblems.All.Single(value => value.Id == id);
        private static ProfileTierDefinition TierDefinition(byte id) => ProfileIdentityCatalog.Tiers.Single(value => value.Id == id);
        // Automatic wears the strongest emblem the Campaign has earned.
        private byte Shown(byte emblem) => emblem == 0 ? profileRead.Value.Campaign.StrongestEmblem : emblem;
        private static byte EmblemRealm(byte emblem) => Math.Max((byte)1, EmblemDefinition(emblem).Realm);
        private byte ProfileRealm() => EmblemRealm(profileView == ProfileView.Selection ? Shown(selectedEmblem) : profileRead.Value.Identity.DisplayedEmblem);
        private void ShowProfile(ProfileView view) { if (profileRead == null || !profileRead.IsCurrent) return; profileView = view; Present(); }

        // The profile: the worn emblem in the worn ladder border, the standing,
        // the records and the emblems; choosing an emblem or a border previews it.
        public ProfilePageView ProfilePage()
        {
            var state = profileRead.Value; var player = state.Profile; var worn = state.Identity; var fields = player.Fields;
            var notices = new List<string>(); var actions = new List<PageAction>();
            if (!player.Exists) notices.Add("Set up this device to create your player profile.");
            if (!worn.ProgressAvailable) notices.Add("Campaign progress is unavailable. Refresh to check earned emblems.");
            if (state.Pending != null)
            {
                notices.Add("Check your pending transaction before changing your profile.");
                actions.Add(PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy));
            }
            else if (!state.Session.Current || state.Session.Funding != "ready")
            {
                notices.Add("Set up this device to change your emblem or border.");
                actions.Add(PageAction("Manage device", () => _ = OpenSession(), () => PageAvailable() && !Busy));
            }
            if (worn.StoredEmblem != 0 && state.Pending == null)
                actions.Add(PageAction("Wear the automatic emblem", () => SelectProfileEmblem(0),
                    () => ProfileEditable() && worn.CanWear(0, selectedBorder), "Emblem 0"));
            return new ProfilePageView {
                Name = Short(player.Owner), Emblem = worn.DisplayedEmblem, Realm = EmblemRealm(worn.DisplayedEmblem), Tier = player.WornTier,
                Standing = EmblemDefinition(worn.DisplayedEmblem).Name + (worn.StoredEmblem == 0 && worn.DisplayedEmblem != 0 ? " (automatic)" : "") + " · " +
                    TierDefinition(player.WornTier).Name + " · " + NumberFit.Figure(player.LadderPoints) + " ladder points",
                Records = PageAction("Your records", () => ShowProfile(ProfileView.Records), () => PageAvailable() && !Busy),
                ChooseBorder = PageAction("Choose a border", () => ShowProfile(ProfileView.Borders), () => PageAvailable() && !Busy),
                Stars = state.Campaign.TotalStars ?? 0,
                Streak = (uint?)fields?["entry_streak_days"] ?? 0, BestDailyScore = (uint?)fields?["best_daily_score"] ?? 0,
                Notice = notices.Count == 0 ? null : string.Join(" ", notices), Actions = actions.ToArray(),
                Emblems = worn.Emblems.Where(choice => choice.Definition.Id != 0).Select(choice => {
                    byte id = choice.Definition.Id;
                    return new ProfileChoiceView { Id = id, Realm = choice.Definition.Kind == ProfileEmblemKind.Guardian ? choice.Definition.Realm : (byte)0,
                        Name = choice.Definition.Name, Detail = id == worn.StoredEmblem ? "Worn" : null,
                        Available = choice.Earned, CanSelect = () => ProfileEditable() && profileRead.Value.Identity.CanWear(id, selectedBorder),
                        Select = () => SelectProfileEmblem(id) };
                }).ToArray() };
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
        // A changed choice is previewed until it is worn or put back.
        private void UpdateProfileSelection()
        {
            if (profileRead == null || !profileRead.IsCurrent) return;
            profileView = ProfileSelectionChanged() ? ProfileView.Selection : ProfileView.Main; Present();
        }
        private void KeepProfileLook()
        {
            if (profileRead == null || !profileRead.IsCurrent) return;
            selectedEmblem = profileRead.Value.Identity.StoredEmblem; selectedBorder = profileRead.Value.Profile.WornTier;
            profileView = ProfileView.Main; Present();
        }
        public Task WearProfileSelection()
        {
            if (!ProfileEditable() || !ProfileSelectionChanged() || !profileRead.Value.Identity.CanWear(selectedEmblem, selectedBorder)) return Task.CompletedTask;
            byte emblem = selectedEmblem, border = selectedBorder;
            return Run(async (epoch, token) => {
                economyActionPending = true; Status = "Saving selection…"; Present();
                try
                {
                    var result = await Flow.SetFeaturedIdentity(emblem, border, token);
                    if (!Current(epoch)) return;
                    ShowReceipt(result.Value, identity.Owner); await RefreshProfilePage(epoch, token);
                }
                finally
                {
                    economyActionPending = false;
                    if (Current(epoch)) Present(); else economyReadbackNeeded = true;
                }
            });
        }

        private PanelPageView ProfilePanel()
        {
            var state = profileRead.Value; var player = state.Profile;
            var back = PageAction("Back", () => ShowProfile(ProfileView.Main), () => PageAvailable() && !Busy);
            switch (profileView)
            {
                case ProfileView.Records: return Records(state, back);
                case ProfileView.Borders:
                {
                    var rows = new List<PanelBlock> {
                        PanelBlock.Portrait(Shown(selectedEmblem), 114, SkinSlots.LadderBorder(selectedBorder), 26, 3),
                        PanelBlock.Eyebrow("Choose a border", gap: 20) };
                    foreach (var tier in ProfileIdentityCatalog.Tiers)
                    {
                        byte id = tier.Id; bool earned = id <= player.HighestTier;
                        string value = !earned ? "Locked" : id == player.WornTier ? "Worn" : id == selectedBorder ? "Selected" : "Wear";
                        rows.Add(PanelBlock.Row("Border " + id, tier.Name, value, SkinTokens.Accent,
                            earned ? PageAction(tier.Name, () => SelectProfileBorder(id),
                                () => ProfileEditable() && profileRead.Value.Identity.CanWear(selectedEmblem, id), "Border " + id) : null,
                            SkinSlots.LadderBorder(id), SkinSlots.LadderBadge(id), !earned));
                    }
                    rows.Add(PanelBlock.Text("Border rule", "Earned borders stay available. Ladder points are permanent and pay no rewards.", 14,
                        SkinTokens.TextMuted, gap: 0, lead: 6));
                    return new PanelPageView { Key = "Profile Borders", Title = "Borders", Subtitle = Short(player.Owner), Back = back, Tab = 2,
                        Blocks = rows.ToArray() };
                }
                default:
                {
                    // The preview of a changed choice, to wear or put back.
                    var name = EmblemDefinition(Shown(selectedEmblem)).Name + " · " + TierDefinition(selectedBorder).Name;
                    var blocks = new List<PanelBlock> {
                        PanelBlock.Portrait(Shown(selectedEmblem), 152, SkinSlots.LadderBorder(selectedBorder), 43, 33),
                        PanelBlock.Card("Selection card", PanelBlock.Title(name, 28, gap: 24, centered: true, name: "Selection"),
                            PanelBlock.Text("Selection rule", "Your current emblem and border stay worn until this change is confirmed.", 16, gap: 0)) };
                    var receipt = ReceiptRow("Profile");
                    if (receipt != null) blocks.Add(receipt);
                    if (economyActionPending || sessionActionPending)
                    {
                        blocks.Add(PanelBlock.Text("Selection notice", "Your wallet request is still finishing.", 16, gap: 20, lead: 20));
                        blocks.Add(DisconnectButton());
                    }
                    else if (state.Pending != null)
                    {
                        blocks.Add(PanelBlock.Text("Selection notice", "Check your pending transaction before changing your profile.", 16, gap: 20, lead: 20));
                        blocks.Add(PanelBlock.Button(PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy), true));
                    }
                    else if (!state.Session.Current || state.Session.Funding != "ready")
                    {
                        blocks.Add(PanelBlock.Text("Selection notice", "Set up this device to change your emblem or border.", 16, gap: 20, lead: 20));
                        blocks.Add(PanelBlock.Button(PageAction("Manage device", () => _ = OpenSession(), () => PageAvailable() && !Busy), true));
                    }
                    else blocks.Add(PanelBlock.Button(PageAction("Wear selection", () => _ = WearProfileSelection(),
                        () => ProfileEditable() && ProfileSelectionChanged()), true, lead: 36));
                    blocks.Add(PanelBlock.Button(PageAction("Keep current look", KeepProfileLook, () => PageAvailable() && !Busy), false));
                    // Back keeps the choice for more changes; Keep current look puts it back.
                    return new PanelPageView { Key = "Profile Selection", Title = "Wear selection", Back = back, Blocks = blocks.ToArray() };
                }
            }
        }

        // The ladder and both boards' paid records.
        private PanelPageView Records(MoneyProfileState state, PageAction back)
        {
            var player = state.Profile; var fields = player.Fields;
            var ladder = new List<PanelBlock> { PanelBlock.Eyebrow("Ladder", gap: 16),
                PanelBlock.Split("Ladder", null, player.LadderPoints.ToString("N0", CultureInfo.InvariantCulture), 36, TierDefinition(player.CurrentTier).Name,
                    SkinSlots.LadderBadge(player.CurrentTier), 18) };
            ladder.Add(PanelBlock.Text("Ladder next", player.NextTierFloor.HasValue ?
                NumberFit.Figure(player.NextTierFloor.Value > player.LadderPoints ? player.NextTierFloor.Value - player.LadderPoints : 0) +
                " points to " + TierDefinition((byte)(player.CurrentTier + 1)).Name : "Top tier", 14, SkinTokens.TextMuted, gap: 0));
            if (player.HighestTier > player.CurrentTier)
                ladder.Add(PanelBlock.Text("Ladder best", "Best ever · " + TierDefinition(player.HighestTier).Name, 14, SkinTokens.TextMuted, gap: 0, lead: 8));
            var blocks = new List<PanelBlock> { PanelBlock.Card("Ladder card", ladder.ToArray()) };
            foreach (string kind in new[] { "score", "theme" })
            {
                var record = fields?[kind + "_record"]; uint rank = (uint?)record?["best_prize_rank"] ?? 0; uint wins = (uint?)record?["wins"] ?? 0;
                ulong rewards = (ulong?)record?["rewards_lamports"] ?? 0;
                string name = MoneyText.Board(kind, catalog);
                blocks.Add(PanelBlock.Card(name + " record card", PanelBlock.Title(name + " boards", 24, gap: 18),
                    PanelBlock.Row(name + " best", "Best paid place", rank == 0 ? "—" : "#" + rank, gap: 18),
                    PanelBlock.Text(name + " wins", wins + (wins == 1 ? " win" : " wins") + " · " + Sol(rewards) + " received", 14, SkinTokens.TextMuted, gap: 0)));
            }
            blocks.Add(PanelBlock.Button(PageAction("Back to Profile", back.Invoke, back.CanInvoke), false, lead: 16));
            return new PanelPageView { Key = "Profile Records", Title = "Your records", Subtitle = Short(player.Owner), Back = back, Blocks = blocks.ToArray() };
        }
    }
}
