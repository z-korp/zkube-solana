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
            _ = ShowSeeker(identity.Owner);
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
        // Before the profile's own read lands: the emblem the profile account
        // the overview already read displays, by the same owner of that rule.
        private byte? KnownProfileRealm() => ownerRead != null && ownerRead.IsCurrent && ownerRead.Value.Profile != null
            ? EmblemRealm(new MoneyProfileIdentity(CampaignProgress.Of(ownerRead.Value.Profile)).DisplayedEmblem) : (byte?)null;
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
                if (RefusalOn("Profile") != null) actions.Add(PageAction("Try again", refusalRetry, () => PageAvailable() && !Busy));
                else { if (slow) notices.Add(StillChecking); actions.Add(Progressing()); }
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
                Name = SeekerName(player.Owner), Badge = VerifiedSeeker(player.Owner) ? VerifiedSeekerBadge : null, Emblem = worn.DisplayedEmblem, Realm = EmblemRealm(worn.DisplayedEmblem), Tier = player.WornTier,
                LadderPoints = player.LadderPoints, LadderTier = player.CurrentTier,
                Records = PageAction("Records", () => ShowProfile(ProfileView.Records), () => PageAvailable() && !Busy, "Your records"),
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
        // The profile shows the address's Seeker ID once it resolves, and the
        // shortened address until then and when it has none. The lookup runs
        // beside the page: nothing waits for it and nothing but this name reads it.
        private ZKube.Integration.Transport.SeekerProfile seeker;
        private string seekerOwner;
        private string SeekerName(string owner) => (seekerOwner == owner ? seeker?.Name : null) ?? Short(owner);
        // A wallet holding a Seeker Genesis Token wears the badge. It is a mark
        // on the profile and nothing else: no perk, no gate, and no effect on
        // Kredits, entries, prizes or the ladder.
        public const string VerifiedSeekerBadge = "Verified Seeker";
        private bool VerifiedSeeker(string owner) => seekerOwner == owner && seeker?.Verified == true;
        private async Task ShowSeeker(string owner)
        {
            if (owner == null || seekerOwner == owner) return;
            seekerOwner = owner; seeker = null;
            var found = await Flow.Seeker(owner);
            if (this == null || seekerOwner != owner) return;
            seeker = found;
            if (browsingProfile && profileRead != null) Present();
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
            return Act("profile look", false, async token => (await Flow.SetFeaturedIdentity(emblem, border, token)).Value, RefreshProfilePage,
                () => _ = WearProfileSelection());
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
                        PanelBlock.Portrait(Shown(selectedEmblem), SkinSlots.LadderBorder(selectedBorder)),
                        PanelBlock.Eyebrow("Choose a border") };
                    foreach (var tier in ProfileIdentityCatalog.Tiers)
                    {
                        byte id = tier.Id; bool earned = id <= player.HighestTier;
                        string value = !earned ? "Locked" : id == player.WornTier ? "Worn" : id == selectedBorder ? "Selected" : "Wear";
                        rows.Add(PanelBlock.Row("Border " + id, tier.Name, value, SkinTokens.Accent,
                            earned ? PageAction(tier.Name, () => SelectProfileBorder(id),
                                () => ProfileEditable() && profileRead.Value.Identity.CanWear(selectedEmblem, id), "Border " + id) : null,
                            SkinSlots.LadderBorder(id), SkinSlots.LadderBadge(id), !earned));
                    }
                    rows.Add(PanelBlock.Text("Border rule", "Earned borders stay available. Ladder points are permanent and pay no rewards.",
                        SkinTokens.TextMuted));
                    return new PanelPageView { Key = "Profile Borders", Title = "Borders", Subtitle = Short(player.Owner), Back = back, Tab = AppPage.Profile,
                        Blocks = rows.ToArray() };
                }
                default:
                {
                    // The preview of a changed choice, to wear or put back.
                    var name = EmblemDefinition(Shown(selectedEmblem)).Name + " · " + TierDefinition(selectedBorder).Name;
                    var blocks = new List<PanelBlock> {
                        PanelBlock.Portrait(Shown(selectedEmblem), SkinSlots.LadderBorder(selectedBorder)),
                        PanelBlock.Card("Selection card", PanelBlock.Title(name, centered: true, name: "Selection"),
                            PanelBlock.Text("Selection rule", "Your current emblem and border stay worn until this change is confirmed.")) };
                    if (economyActionPending || sessionActionPending) Requesting(blocks);
                    else if (state.Pending != null) Awaiting("Profile", blocks, () => PageAvailable() && !Busy);
                    else if (!state.Session.Current || state.Session.Funding != "ready")
                    {
                        blocks.Add(PanelBlock.Text("Selection notice", "Set up this device to change your emblem or border."));
                        blocks.Add(PanelBlock.Button(PageAction("Manage device", () => _ = OpenSession(), () => PageAvailable() && !Busy), true));
                    }
                    else blocks.Add(PanelBlock.Button(PageAction("Wear selection", () => _ = WearProfileSelection(),
                        () => ProfileEditable() && ProfileSelectionChanged()), true));
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
            var ladder = new List<PanelBlock> { PanelBlock.Eyebrow("Ladder"),
                PanelBlock.Split("Ladder", null, player.LadderPoints.ToString("N0", CultureInfo.InvariantCulture), TierDefinition(player.CurrentTier).Name,
                    SkinSlots.LadderBadge(player.CurrentTier)) };
            ladder.Add(PanelBlock.Text("Ladder next", player.NextTierFloor.HasValue ?
                NumberFit.Figure(player.NextTierFloor.Value > player.LadderPoints ? player.NextTierFloor.Value - player.LadderPoints : 0) +
                " points to " + TierDefinition((byte)(player.CurrentTier + 1)).Name : "Top tier", SkinTokens.TextMuted));
            if (player.HighestTier > player.CurrentTier)
                ladder.Add(PanelBlock.Text("Ladder best", "Best ever · " + TierDefinition(player.HighestTier).Name, SkinTokens.TextMuted));
            var blocks = new List<PanelBlock> { PanelBlock.Card("Ladder card", ladder.ToArray()) };
            foreach (string kind in new[] { "score", "theme" })
            {
                var record = fields?[kind + "_record"]; uint rank = (uint?)record?["best_prize_rank"] ?? 0; uint wins = (uint?)record?["wins"] ?? 0;
                ulong rewards = (ulong?)record?["rewards_lamports"] ?? 0;
                string name = MoneyText.Board(kind, catalog);
                blocks.Add(PanelBlock.Card(name + " record card", PanelBlock.Title(name + " boards"),
                    PanelBlock.Row(name + " best", "Best paid place", rank == 0 ? "—" : "#" + rank),
                    PanelBlock.Text(name + " wins", wins + (wins == 1 ? " win" : " wins") + " · " + Sol(rewards) + " received", SkinTokens.TextMuted)));
            }
            blocks.Add(PanelBlock.Button(PageAction("Back to Profile", back.Invoke, back.CanInvoke), false));
            return new PanelPageView { Key = "Profile Records", Title = "Your records", Subtitle = Short(player.Owner), Back = back, Blocks = blocks.ToArray() };
        }
    }
}
