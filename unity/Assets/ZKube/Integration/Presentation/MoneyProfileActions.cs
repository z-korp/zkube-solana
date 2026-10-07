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
        }, true);
        private void CloseProfileView() { ClearProfileObservation(); browsingProfile = false; profileView = ProfileView.Main; }
        private void ClearProfileObservation() { profileRead = null; pageNotice = null; Present(); }
        private async Task RefreshProfilePage(long epoch, CancellationToken token)
        {
            ClearProfileObservation();
            if (identity.Owner == null) { CloseProfileView(); return; }
            Notice(Words.ArenaProfileChecking); Status = "Checking profile…";
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
            ClearProfileObservation();
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
            var notices = new List<string>(); PageAction action = null;
            if (!player.Exists) notices.Add(Words.ArenaProfileNeedsDevice);
            if (!worn.ProgressAvailable) notices.Add(Words.ArenaProfileProgressUnavailable);
            if (state.Pending != null)
            {
                if (RefusalOn("Profile") != null) action = PageAction(Words.ActionTryAgain, refusalRetry, () => PageAvailable() && !Busy, "Try again", SkinSlots.IconRetry);
                else { if (slow) notices.Add(StillChecking); action = Progressing(); }
            }
            else if (!state.Session.Current || state.Session.Funding != "ready")
            {
                notices.Add(Words.ArenaProfileLookNeedsDevice);
                action = Leading(Words.ArenaDeviceManage, () => _ = OpenSession(), () => PageAvailable() && !Busy, "Manage device", SkinSlots.IconDevice);
            }
            // Back to the automatic emblem, where the device can make that change.
            else if (worn.StoredEmblem != 0)
                action = PageAction(Words.ArenaProfileWearAutomatic, () => SelectProfileEmblem(0),
                    () => ProfileEditable() && worn.CanWear(0, selectedBorder), "Emblem 0");
            return new ProfilePageView {
                Name = SeekerName(player.Owner), Badge = VerifiedSeeker(player.Owner) ? VerifiedSeekerBadge : null, Emblem = worn.DisplayedEmblem, Realm = EmblemRealm(worn.DisplayedEmblem), Tier = player.WornTier,
                LadderPoints = player.LadderPoints, LadderTier = player.CurrentTier,
                Records = PageAction(Words.ArenaProfileRecords, () => ShowProfile(ProfileView.Records), () => PageAvailable() && !Busy, "Your records"),
                ChooseBorder = PageAction(Words.ArenaProfileChooseBorder, () => ShowProfile(ProfileView.Borders), () => PageAvailable() && !Busy, "Choose a border"),
                Stars = state.Campaign.TotalStars ?? 0,
                Streak = (uint?)fields?["entry_streak_days"] ?? 0, BestDailyScore = (uint?)fields?["best_daily_score"] ?? 0,
                Notice = notices.Count == 0 ? null : string.Join(" ", notices), Tertiary = action,
                Emblems = worn.Emblems.Where(choice => choice.Definition.Id != 0).Select(choice => {
                    byte id = choice.Definition.Id;
                    return new ProfileChoiceView { Id = id, Realm = choice.Definition.Kind == ProfileEmblemKind.Guardian ? choice.Definition.Realm : (byte)0,
                        Name = choice.Definition.Name, Detail = id == worn.StoredEmblem ? Words.ProfileWorn : null,
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
        public static string VerifiedSeekerBadge => Words.ArenaProfileVerifiedSeeker;
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
            var back = PageAction(null, () => ShowProfile(ProfileView.Main), PageAvailable);
            switch (profileView)
            {
                case ProfileView.Records: return Records(state, back);
                case ProfileView.Borders:
                {
                    var rows = new List<PanelBlock> {
                        PanelBlock.Portrait(Shown(selectedEmblem), SkinSlots.LadderBorder(selectedBorder)),
                        PanelBlock.Eyebrow(Words.ArenaProfileChooseBorderHeading) };
                    foreach (var tier in ProfileIdentityCatalog.Tiers)
                    {
                        byte id = tier.Id; bool earned = id <= player.HighestTier;
                        string value = !earned ? Words.ArenaProfileLocked : id == player.WornTier ? Words.ArenaProfileBorderWorn : id == selectedBorder ? Words.ArenaProfileSelected : Words.ArenaProfileWear;
                        rows.Add(PanelBlock.Row("Border " + id, tier.Name, value, SkinTokens.Accent,
                            earned ? PageAction(tier.Name, () => SelectProfileBorder(id),
                                () => ProfileEditable() && profileRead.Value.Identity.CanWear(selectedEmblem, id), "Border " + id) : null,
                            SkinSlots.LadderBorder(id), SkinSlots.LadderBadge(id), !earned));
                    }
                    rows.Add(PanelBlock.Text("Border rule", Words.ArenaProfileBorderRule,
                        SkinTokens.TextMuted));
                    return new PanelPageView { Key = "Profile Borders", Title = Words.ArenaProfileBorders, Subtitle = Short(player.Owner), Back = back, Tab = AppPage.Profile,
                        Blocks = rows.ToArray() };
                }
                default:
                {
                    // The preview of a changed choice, to wear or put back.
                    var name = EmblemDefinition(Shown(selectedEmblem)).Name + " · " + TierDefinition(selectedBorder).Name;
                    var blocks = new List<PanelBlock> {
                        PanelBlock.Portrait(Shown(selectedEmblem), SkinSlots.LadderBorder(selectedBorder)),
                        PanelBlock.Card("Selection card", PanelBlock.Title(name, centered: true, name: "Selection"),
                            PanelBlock.Text("Selection rule", Words.ArenaProfileSelectionRule)) };
                    // A page that asks for a decision: no tab bar, and its foot row leaves it. Keep current
                    // look puts the choice back; the Android back key returns to the profile with the
                    // choice kept, so a border can be chosen with an emblem in one change.
                    var page = new PanelPageView { Key = "Profile Selection", Title = Words.ArenaProfileWearSelection, Back = back };
                    if (economyActionPending || sessionActionPending) Requesting(page);
                    else if (state.Pending != null) Awaiting("Profile", page, () => PageAvailable() && !Busy);
                    else if (!state.Session.Current || state.Session.Funding != "ready")
                    {
                        page.Reason = PanelBlock.Text("Selection notice", Words.ArenaProfileLookNeedsDevice);
                        page.Primary = Leading(Words.ArenaDeviceManage, () => _ = OpenSession(), () => PageAvailable() && !Busy, "Manage device", SkinSlots.IconDevice);
                    }
                    else page.Primary = PageAction(Words.ArenaProfileWearSelection, () => _ = WearProfileSelection(), () => ProfileEditable() && ProfileSelectionChanged(), "Wear selection", SkinSlots.Tick);
                    page.Tertiary = PageAction(Words.ArenaProfileKeepLook, KeepProfileLook, () => PageAvailable() && !Busy, "Keep current look", SkinSlots.IconClose);
                    page.Blocks = blocks.ToArray();
                    return page;
                }
            }
        }

        // The ladder and both boards' paid records.
        private PanelPageView Records(MoneyProfileState state, PageAction back)
        {
            var player = state.Profile; var fields = player.Fields;
            var ladder = new List<PanelBlock> { PanelBlock.Eyebrow(Words.ArenaLadder),
                PanelBlock.Split("Ladder", null, Words.Number(player.LadderPoints), TierDefinition(player.CurrentTier).Name,
                    SkinSlots.LadderBadge(player.CurrentTier)) };
            ladder.Add(PanelBlock.Text("Ladder next", player.NextTierFloor.HasValue ?
                Words.ArenaLadderNext(NumberFit.Figure(player.NextTierFloor.Value > player.LadderPoints ? player.NextTierFloor.Value - player.LadderPoints : 0),
                    TierDefinition((byte)(player.CurrentTier + 1)).Name) : Words.ArenaLadderTop, SkinTokens.TextMuted));
            if (player.HighestTier > player.CurrentTier)
                ladder.Add(PanelBlock.Text("Ladder best", Words.ArenaLadderBest(TierDefinition(player.HighestTier).Name), SkinTokens.TextMuted));
            var blocks = new List<PanelBlock> { PanelBlock.Card("Ladder card", ladder.ToArray()) };
            foreach (string kind in new[] { "score", "theme" })
            {
                var record = fields?[kind + "_record"]; uint rank = (uint?)record?["best_prize_rank"] ?? 0; uint wins = (uint?)record?["wins"] ?? 0;
                ulong rewards = (ulong?)record?["rewards_lamports"] ?? 0;
                string name = MoneyText.Board(kind, catalog);
                string handle = kind == "score" ? "Score" : "Objective";
                blocks.Add(PanelBlock.Card(handle + " record card", PanelBlock.Title(Words.ArenaRecordsBoards(name), name: handle + " boards"),
                    PanelBlock.Row(handle + " best", Words.ArenaRecordsBestPlace, rank == 0 ? "—" : "#" + rank),
                    PanelBlock.Text(handle + " wins", Words.ArenaRecordsWins(wins, Sol(rewards)), SkinTokens.TextMuted)));
            }
            // A page that shows: it keeps its tab bar, Profile lit, which is its way back.
            return new PanelPageView { Key = "Profile Records", Title = Words.ArenaProfileRecordsTitle, Subtitle = Short(player.Owner), Back = back, Tab = AppPage.Profile,
                Blocks = blocks.ToArray() };
        }
    }
}
