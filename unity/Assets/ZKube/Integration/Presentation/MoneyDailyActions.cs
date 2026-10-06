using System;
using ZKube.Integration.Client;
using System.Globalization;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyRead<MoneyDailyState> dailyRead;
        private bool browsingDaily, confirmingDaily;
        private long dailyRefreshAt = long.MaxValue;
        public bool BrowsingDaily => browsingDaily;
        public bool ConfirmingDailyEntry => confirmingDaily;

        public Task OpenDaily() => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            CloseProductViews(); browsingDaily = true;
            await RefreshDailyPage(epoch, token);
        }, true);

        private void CloseDailyView() { ClearDailyObservation(); browsingDaily = false; }
        private void ClearDailyObservation()
        {
            dailyRead = null; confirmingDaily = false; dailyRefreshAt = long.MaxValue; pageNotice = null; StopLanding(); Present();
        }
        private async Task RefreshDailyPage(long epoch, CancellationToken token)
        {
            ClearDailyObservation();
            if (identity.Owner == null) { CloseDailyView(); return; }
            Status = "Checking Daily…"; Notice(Words.ArenaDailyChecking);
            var result = await Flow.RefreshDaily(token);
            if (!Current(epoch) || !browsingDaily) return;
            dailyRead = result; pageNotice = null; AwaitLaunch(result.Value.Lobby.Launched);
            if (ResultAvailable("Daily") && lastResult.Day == result.Value.Lobby.DayId)
                lastResult.Streak = (uint?)result.Value.Lobby.Profile.Fields?["entry_streak_days"];
            var value = result.Value.Lobby; long timestamp = now();
            dailyRefreshAt = (long)NativeEngine.Daily(checked(value.DayId + 1)).OpensAt;
            if (value.PotLamports.HasValue)
            {
                var window = NativeEngine.Daily(value.DayId);
                long opens = (long)window.OpensAt, freezes = (long)window.FreezesAt;
                if (opens > timestamp) dailyRefreshAt = Math.Min(dailyRefreshAt, opens);
                if (freezes > timestamp) dailyRefreshAt = Math.Min(dailyRefreshAt, freezes);
            }
            if (value.Launched) ReadLanding(value.DayId);
            Present(); Status = "Daily updated";
        }
        private void RefreshDailyIdentity()
        {
            if (!browsingDaily || dailyRead == null) return;
            if (!dailyRead.IsCurrent)
            {
                // An entry on its way keeps its card: its own looks retire this read, and the page reads again when it ends.
                if (opening == null) ClearDailyObservation();
                return;
            }
            if (!Busy && now() >= dailyRefreshAt) { confirmingDaily = false; _ = RefreshOverview(); }
        }
        private bool CanUseDaily() => browsingDaily && !Busy && !sessionActionPending && !economyActionPending && !paused && !detached && isActiveAndEnabled &&
            dailyRead != null && dailyRead.IsCurrent;
        private bool CanEnterDaily() => CanUseDaily() && now() < dailyRefreshAt && dailyRead.Value.Entry.Ready;
        public void AskDailyEntry()
        {
            if (!CanEnterDaily()) return;
            confirmingDaily = true; Present();
        }
        public Task ConfirmDailyEntry()
        {
            if (!confirmingDaily || !CanEnterDaily() || boardHost == null) return Task.CompletedTask;
            confirmingDaily = false;
            return OpenRun(() => Flow.StartDailyRun(), Words.ArenaStepEntering, true);
        }
        public Task ResumeDailyRun() => !CanUseDaily() || boardHost == null ? Task.CompletedTask :
            OpenRun(() => Flow.OpenSavedRun(), Words.ArenaStepOpening, false);

        // The Arena's landing page: today's Daily with its prize pool, the Kredit
        // figure and one action, which is the player's next step, or the reason
        // there is none; then today's two boards with the player's own rows.
        public DailyPageView DailyPage()
        {
            if (identity.Owner == null) return ConnectHome();
            // A read invalidated since this frame's check is as good as absent: the next frame replaces it.
            if (dailyRead == null || !dailyRead.TryValue(out var state))
            {
                // An entry on its way keeps the card it was tapped on: what the chain last confirmed, with the loader on its button.
                if (opening == null || enteringFrom == null) return WaitingHome();
                state = enteringFrom;
            }
            var lobby = state.Lobby;
            var arcade = new ArcadeView { Pot = lobby.PotLamports.HasValue ? Sol(lobby.PotLamports.Value) : null };
            long freezes = (long)NativeEngine.Daily(lobby.DayId).FreezesAt;
            DailyPageView Page(PageAction action) => new DailyPageView { Day = lobby.DayId, Realm = lobby.Realm, ClosesAt = freezes, Now = now,
                ObjectiveKind = lobby.ObjectiveKind, ObjectiveValue = lobby.ObjectiveValue, Status = PublicStatus(lobby.Status), Arcade = arcade,
                Actions = action == null ? Array.Empty<PageAction>() : new[] { action } };
            var campaign = PageAction(Words.ArenaPlayCampaign, () => _ = OpenCampaign(), () => PageAvailable(), "Play Campaign");
            // Before the Arena launches there is no entry, device or Kredit to offer: the Campaign is the way on.
            if (!lobby.Launched) { arcade.Headline = Words.ArenaHeadlineOpensSoon; arcade.Pot = null; return Page(campaign); }
            // The day's state heads the clock.
            switch (lobby.Status)
            {
                case "frozen": case "finalized": arcade.Headline = Words.ArenaHeadlineEntriesClosed; break;
                case "suspended": arcade.Headline = Words.ArenaHeadlineEntriesPaused; arcade.Warning = true; break;
                case "paused": arcade.Headline = Words.ArenaHeadlinePlayPaused; arcade.Warning = true; break;
                case "not-open": arcade.Headline = Words.ArenaHeadlineLaterToday; break;
            }
            var refresh = PageAction(Words.ActionRefresh, () => _ = RefreshOverview(), CanUseDaily, "Refresh", SkinSlots.IconRetry);
            var boards = PageAction(Words.ArenaSeeBoards, () => _ = OpenRewards(lobby.DayId), () => PageAvailable() && !Busy, "See boards", SkinSlots.IconTrophy);
            // The one action is the player's next step; a reason stands only where the action does not say why.
            PageAction action;
            bool device = state.Entry.Status == "needs-session" || state.Entry.Status == "missing-player";
            if (state.Entry.Status == "pending-transaction")
            {
                // A transaction still unconfirmed: the card's action is the loader, followed without a tap.
                if (RefusalOn("Daily") != null) Reason(arcade, RefusalOn("Daily"), null); else if (slow) Reason(arcade, StillChecking, null);
                action = RefusalOn("Daily") != null ? PageAction(Words.ActionTryAgain, refusalRetry, CanUseDaily, "Try again", SkinSlots.IconRetry) : Progressing();
            }
            // Readiness says whether the slot holds a run to resume; one past its recovery deadline is retired by the next entry.
            else if (state.Entry.Status == "resume")
                action = PageAction(Words.DailyResume, () => _ = ResumeDailyRun(), () => CanUseDaily() && boardHost != null, "Resume run");
            else switch (state.Entry.Status)
            {
                case "ready": action = PageAction(Words.ArenaEntryEnter, AskDailyEntry, () => CanEnterDaily() && boardHost != null, "Enter · 1 Kredit"); break;
                case "needs-kredits": action = PageAction(Words.ArenaKreditsBuy, () => _ = OpenKredits(), () => PageAvailable() && !Busy, "Buy Kredits", SkinSlots.IconKredit); break;
                case "needs-session": case "missing-player": action = PageAction(Words.ArenaDeviceSetUp, () => _ = OpenSession(), CanUseDaily, "Set up device", SkinSlots.IconDevice); break;
                case "needs-refill": action = PageAction(Words.ArenaDeviceTopUp, () => _ = OpenSession(), CanUseDaily, "Top up deposit", SkinSlots.IconPlus); break;
                case "suspended":
                    arcade.Headline = Words.ArenaHeadlineEntriesPaused; arcade.Warning = true; Reason(arcade, Words.ArenaReasonEntriesPaused, null); action = campaign; break;
                case "paused":
                    arcade.Headline = Words.ArenaHeadlinePlayPaused; arcade.Warning = true; Reason(arcade, Words.ArenaReasonPlayPaused, null); action = campaign; break;
                case "frozen": case "closed": arcade.Headline = Words.ArenaHeadlineEntriesClosed; action = boards; break;
                case "not-open": arcade.Headline = Words.ArenaHeadlineLaterToday; action = campaign; break;
                case "changed": Reason(arcade, Words.ArenaReasonEntryChanged, null); action = refresh; break;
                case "run-address-occupied": Reason(arcade, Words.ArenaReasonSavedRun, null); action = refresh; break;
                default: Reason(arcade, Words.ArenaReasonUnavailable, null); action = refresh; break;
            }
            // A device request still finishing keeps the next step in view, waiting.
            if (sessionActionPending) Reason(arcade, Words.ArenaReasonDevicePending, null);
            // What a page would note above itself is said in the card: the page has no room for another.
            else if (NoticeFor("Daily") is string notice) { if (arcade.Reason == null) arcade.Reason = notice; else if (arcade.Detail == null) arcade.Detail = notice; }
            // The Kredit figure shows its own state; before a device exists the next step is the device, not Kredits.
            ulong kredits = lobby.Profile.Kredits;
            arcade.Kredits = NumberFit.Figure(kredits);
            arcade.KreditLevel = device || kredits > 1 ? KreditLevel.Enough : kredits == 1 ? KreditLevel.Last : KreditLevel.None;
            arcade.OpenKredits = PageAction(Words.ArenaKreditsTitle, () => _ = OpenKredits(), () => PageAvailable() && !Busy, "Kredits");
            LandingBoards(arcade, lobby);
            // An entry on its way: the card's button is its loader until the board takes the screen.
            if (opening != null) action = new PageAction { Label = opening, Name = "Action progress", Progress = opening };
            return Page(action);
        }

        // Today's boards and the rewards still to claim are read beside the
        // Daily, each on its own: the Daily card works before they arrive, a
        // failed boards read says so in its card alone, and a failed claims
        // read shows no badge. Nothing is saved and nothing polls: they are
        // read when the page's Daily is.
        private CancellationTokenSource landingReads;
        private int landingSerial;
        private DailyBoards landingBoards;
        private bool landingBoardsFailed;
        private void StopLanding()
        {
            landingSerial++;
            var old = landingReads; landingReads = null;
            try { old?.Cancel(); } catch (ObjectDisposedException) { }
            old?.Dispose();
            landingBoards = null; landingBoardsFailed = false;
        }
        private void ReadLanding(uint day)
        {
            StopLanding(); landingReads = new CancellationTokenSource();
            _ = ReadLandingBoards(landingSerial, day, landingReads.Token); ReadClaims();
        }
        private bool LandingCurrent(int serial) => this != null && serial == landingSerial && browsingDaily && !detached;
        private async Task ReadLandingBoards(int serial, uint day, CancellationToken token)
        {
            try { var boards = await Flow.Boards(day, token); if (!LandingCurrent(serial)) return; landingBoards = boards; }
            catch (OperationCanceledException) { return; }
            catch (Exception error)
            { ZKube.Integration.Transport.ClientLog.Failure("landing boards", error); if (!LandingCurrent(serial)) return; landingBoardsFailed = true; }
            Present();
        }
        private void LandingBoards(ArcadeView arcade, DailyLobby lobby)
        {
            arcade.HasBoards = true;
            var waiting = Claims;
            if (waiting.Length > 0)
                arcade.Claims = PageAction(Words.ArenaRewardsToClaim(waiting.Length), () => _ = OpenRewards(waiting[0].Day, waiting[0].Kind), () => PageAvailable() && !Busy, "Rewards to claim");
            if (landingBoardsFailed)
            {
                arcade.BoardsNotice = Words.ArenaBoardsNotLoaded;
                arcade.BoardsRetry = PageAction(Words.ActionTryAgain, () => { ReadLanding(lobby.DayId); Present(); }, () => PageAvailable(), "Reload boards");
                return;
            }
            if (landingBoards == null || landingBoards.DayId != lobby.DayId) return;
            // A Classic day has no objective and so no second board.
            var shown = lobby.ObjectiveKind == 0 ? new[] { landingBoards.Score } : new[] { landingBoards.Score, landingBoards.Theme };
            // Whether the player has entered today: a board without their row then says they have no score on it.
            bool played = PlayedOn(lobby.Profile, lobby.DayId);
            arcade.Boards = shown.Select(board => BoardColumn(board, lobby.DayId, played)).ToArray();
        }
        // The profile's last paid entry was on this day.
        private static bool PlayedOn(PlayerProfile profile, uint day) => (uint?)profile?.Fields?["last_entry_day_id"] == day;
        // What a board says of a player who has played its day and holds no row
        // on it: a result of zero qualifies for no place, and a run still in
        // flight has none yet.
        private static BoardRowView Unscored() => new BoardRowView { Player = Words.ArenaYou, Note = Words.ArenaBoardsNoScore, Yours = true };
        // A board as the landing page shows it: its top rows as the chain holds
        // them now and the player's own line, with the way into the board.
        private BoardColumnView BoardColumn(PrizeBoard board, uint day, bool played)
        {
            var (icon, chip) = BoardIcon(board.Kind, day);
            string kind = board.Kind;
            var column = new BoardColumnView { Name = MoneyText.Board(kind, catalog), Pictogram = icon, Chip = chip,
                Open = PageAction("Open " + MoneyText.Board(kind, catalog) + " board", () => _ = OpenRewards(day, kind), () => PageAvailable() && !Busy) };
            var rows = BoardRows(board).ToArray();
            column.Rows = rows.Take(PageViews.LandingRowsSeeker).ToArray();
            if (rows.Length == 0) column.Empty = Words.ArenaBoardsNoRuns;
            // The player's line: their row where the board holds them; once they have played, that they have no score here; else none.
            column.Yours = rows.FirstOrDefault(row => row.Yours) ?? (played ? Unscored() : null);
            return column;
        }
        // A board's rows in order: a sealed board's paying rows with their
        // payouts, a live board's standings as they are now.
        private IEnumerable<BoardRowView> BoardRows(PrizeBoard board)
        {
            if (board.Live)
                return board.Account.Rows.Select(row => Row(row.Position + 1, row.Player, board.Metric(row), null));
            return board.Rows.Select(row => Row(row.Rank, row.Record.Player, row.Metric, row.PayoutLamports));
        }
        private BoardRowView Row(uint rank, string player, ulong metric, ulong? payout) => new BoardRowView { Rank = rank.ToString(CultureInfo.InvariantCulture),
            Player = player == identity.Owner ? Words.ArenaYou : Short(player), Value = Words.Number(metric),
            Payout = payout.HasValue ? Sol(payout.Value) : null, Yours = player == identity.Owner };
        // The page before its read: today's realm and objective come from the day alone.
        private DailyPageView Home(ArcadeView arcade, long closesAt, params PageAction[] actions)
        {
            var today = NativeEngine.Daily(Today);
            return new DailyPageView { Day = Today, Realm = today.Realm, ObjectiveKind = today.Kind, ObjectiveValue = today.Value,
                ClosesAt = closesAt, Now = now, Arcade = arcade, Actions = actions };
        }
        // Without an address the page asks for the wallet, or says why it did not connect.
        private DailyPageView ConnectHome()
        {
            var today = publicRead != null && publicRead.IsCurrent ? publicRead.Value : null;
            var arcade = new ArcadeView { Headline = today != null && !today.Launched ? Words.ArenaHeadlineOpensSoon : null };
            var connect = PageAction(Words.ArenaConnect, () => _ = Connect(), () => PageAvailable() && !Busy, "Connect", SkinSlots.IconWallet);
            string refused = RefusalOn("Connect");
            if (refused != null)
            {
                arcade.Reason = refused; arcade.Warning = true;
                connect = PageAction(Words.ActionTryAgain, refusalRetry, () => PageAvailable() && !Busy, "Try again", SkinSlots.IconRetry);
            }
            else if (failure != null && !Busy) { arcade.Reason = failure; arcade.Warning = true; }
            else { arcade.Reason = Words.ArenaConnectReason; arcade.Detail = arcade.Headline != null ? Words.ArenaConnectCampaignOpen : Words.ArenaConnectFree; }
            var page = Home(arcade, today?.FreezesAt ?? 0, connect);
            page.NoTabs = true; return page;
        }
        // With an address and no read yet: what the page waits for, or why the read is not there.
        private DailyPageView WaitingHome()
        {
            if (failure != null && !Busy)
                return Home(new ArcadeView { Headline = Words.ArenaHeadlineNotLoaded, Reason = failure, Warning = true },
                    0, PageAction(Words.ActionTryAgain, () => _ = RefreshOverview(), () => PageAvailable() && !Busy, "Try again", SkinSlots.IconRetry),
                    PageAction(Words.ArenaPlayCampaign, () => _ = OpenCampaign(), () => PageAvailable(), "Play Campaign"));
            if (opening != null) return Home(new ArcadeView(), 0, new PageAction { Label = opening, Name = "Action progress", Progress = opening });
            return Home(new ArcadeView { Headline = Words.ArenaChecking }, 0);
        }
        private static void Reason(ArcadeView arcade, string reason, string detail)
        { if (arcade.Reason != null) return; arcade.Reason = reason; arcade.Detail = detail; }

        // The entry choice: what one entry costs against the confirmed balance,
        // and that it cannot be refunded.
        private PanelPageView EntryPage()
        {
            var lobby = dailyRead.Value.Lobby; var realm = catalog.Realm(lobby.Realm);
            Action close = () => { confirmingDaily = false; Present(); };
            var cancel = PageAction(Words.ActionNotNow, close, CanUseDaily, "Cancel entry");
            return new PanelPageView { Key = "Entry", Title = Words.ArenaEntryTitle, Subtitle = realm.realmName + " · " + Day(lobby.DayId),
                Back = cancel,
                Blocks = new[] {
                    PanelBlock.Card("Entry card",
                        PanelBlock.Row("Entry cost", Words.ArenaEntryCostLabel, Words.ArenaEntryCost, icon: SkinSlots.IconKredit),
                        PanelBlock.Row("Entry balance", Words.ArenaEntryBalance, NumberFit.Figure(lobby.Profile.Kredits), icon: SkinSlots.IconKredit),
                        PanelBlock.Text("Entry terms", Words.ArenaEntryTerms, SkinTokens.TextMuted)) },
                // The entry is the primary, with Not now beside it on the one row: its words alone, since an icon there would stack the two.
                Primary = PageAction(Words.ArenaEntryConfirm, () => _ = ConfirmDailyEntry(), () => CanEnterDaily() && boardHost != null, "Confirm 1 Kredit", SkinSlots.IconPlay),
                Secondary = cancel };
        }
    }
}
