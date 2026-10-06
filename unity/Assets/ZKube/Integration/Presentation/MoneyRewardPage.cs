using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;
using ZKube.Presentation;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppAdapter
    {
        private MoneyRead<MoneyRewardState> rewardRead;
        private bool browsingRewards;
        private uint rewardDay;
        // The board shown ("score" or "theme"), how many of its rows the list
        // shows, and the row a longer list opens at.
        private string boardKind = "score";
        private const int BoardRowsStep = 50;
        private int boardRows = BoardRowsStep, boardRowsFrom;
        // The first day with a Daily, once a boards read has said it: the stepper stops there.
        private uint firstBoardDay;
        private RewardPayment rewardPayment;
        public bool BrowsingRewards => browsingRewards;
        public uint RewardDay => rewardDay;
        public string BoardKind => boardKind;
        private sealed class RewardPayment
        {
            internal IdentityLease Owner;
            internal uint Day, Points;
            internal string Kind, Signature;
            internal ulong Amount, PreviousPoints;
        }

        public Task OpenRewards(uint? day = null, string kind = null) => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            uint today = Today;
            uint selected = day ?? today;
            if (selected > today) throw new ArgumentOutOfRangeException(nameof(day));
            CloseProductViews(); browsingRewards = true; rewardDay = selected; boardKind = kind ?? "score"; boardRows = BoardRowsStep; boardRowsFrom = 0;
            await RefreshRewardPage(epoch, token);
        }, true);
        private void CloseRewardView() { ClearRewardObservation(); browsingRewards = false; boardKind = "score"; }
        private void ClearRewardObservation() { rewardRead = null; pageNotice = null; Present(); }
        private async Task RefreshRewardPage(long epoch, CancellationToken token)
        {
            ClearRewardObservation();
            if (identity.Owner == null) { CloseRewardView(); return; }
            Notice("Checking results and rewards…"); Status = "Checking results…";
            var read = await Flow.RefreshRewards(rewardDay, token);
            if (!Current(epoch) || !browsingRewards) return;
            rewardRead = read; economyReadbackNeeded = false; pageNotice = null;
            if (read.Value.Boards.LaunchDay != 0) firstBoardDay = read.Value.Boards.LaunchDay;
            ReadClaims();
            if (read.Value.PreviousOperation != null) ShowReceipt(read.Value.PreviousOperation, identity.Owner);
            Present(); Status = "Results updated";
        }
        private void RefreshRewardIdentity()
        {
            if (rewardPayment != null && !identity.IsCurrent(rewardPayment.Owner)) rewardPayment = null;
            if (economyReadbackNeeded && browsingRewards && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingRewards || rewardRead == null) return;
            // A read gone stale is dropped; the page reads again by its own rule.
            if (!rewardRead.IsCurrent) { ClearRewardObservation(); return; }
            if (!Busy && new[] { rewardRead.Value.Boards.Score, rewardRead.Value.Boards.Theme }
                .Any(board => board.ClaimStatus == "claimable" && board.ExpiresAt.HasValue && now() > board.ExpiresAt.Value))
                _ = RefreshOverview();
        }
        private PrizeBoard RewardBoard(string kind) => rewardRead == null ? null : kind == "score" ? rewardRead.Value.Boards.Score :
            kind == "theme" ? rewardRead.Value.Boards.Theme : null;
        private bool CanClaimReward(string kind)
        {
            var board = RewardBoard(kind);
            return browsingRewards && !Busy && !sessionActionPending && !economyActionPending && !paused && !detached && isActiveAndEnabled &&
                rewardRead != null && rewardRead.IsCurrent && rewardRead.Value.Pending == null && rewardRead.Value.Session.Current &&
                rewardRead.Value.Session.Funding == "ready" && board?.ClaimStatus == "claimable" && board.Yours != null &&
                board.ExpiresAt.HasValue && now() <= board.ExpiresAt.Value;
        }
        private bool CanSealResults() => browsingRewards && !Busy && !sessionActionPending && !economyActionPending && !paused && !detached &&
            isActiveAndEnabled && rewardRead != null && rewardRead.IsCurrent && rewardRead.Value.Pending == null && rewardRead.Value.Boards.Finalizable &&
            rewardRead.Value.Session.Current && rewardRead.Value.Session.Funding == "ready";
        public Task SealResults()
        {
            if (!CanSealResults()) return Task.CompletedTask;
            return Act("seal results", false, async token => (await Flow.SettleDailies(token)).Value, RefreshRewardPage, () => _ = SealResults());
        }
        // The boards page: a day's two boards, one shown at a time, the player's
        // row with its claim, the rows, the one button and, at its foot, the day
        // stepper. Its chevrons step through the days; no day after today can be
        // shown. Today's boards are live rows from the chain; a finished day waits
        // to be sealed by any player's transaction; a sealed day shows its paying rows with their payouts from the chain
        // and, under a divider, the places the board no longer holds, from the
        // public read model, which is never an authority.
        private static string BoardDay(uint day) => DateTimeOffset.FromUnixTimeSeconds((long)day * 86400).UtcDateTime.ToString("ddd d MMM", CultureInfo.InvariantCulture);
        // The arrows stop only at the stepper's real limits, the launch day and today; a read in progress does not hold them.
        private PageAction StepDay(string name, int step) => PageAction(name, () => _ = OpenRewards((uint)(rewardDay + step), boardKind), PageAvailable);
        private StepperView Stepper(string state, string token, string mark = null) => new StepperView { Label = BoardDay(rewardDay), State = state, StateToken = token,
            Mark = mark, Previous = rewardDay > Math.Max(firstBoardDay, 1U) ? StepDay("Previous day", -1) : null, Next = rewardDay < Today ? StepDay("Next day", 1) : null };
        private void ShowBoard(string kind)
        {
            if (kind == boardKind) return;
            boardKind = kind; boardRows = BoardRowsStep; boardRowsFrom = 0; Present();
        }
        // The two boards as a pair; a Classic day has the one.
        private PanelBlock BoardPair() => NativeEngine.Daily(rewardDay).Kind == 0 ? null :
            PanelBlock.Pair(PageAction("Score", () => ShowBoard("score"), PageAvailable, "Score board"),
                PageAction(MoneyText.Board("theme", catalog), () => ShowBoard("theme"), PageAvailable, "Objective board"), boardKind == "score" ? 0 : 1);

        private PanelPageView RewardPage()
        {
            // Back is a way off the page: never held.
            var back = PageAction("Back", () => _ = OpenDaily(), PageAvailable);
            // The page hands its controls over by role: one action at most in the foot
            // row, and the day stepper, the lowest row, in every state.
            var page = new PanelPageView { Key = "Boards", Title = "Boards", Back = back, Tab = AppPage.Home };
            PageAction Act(string label, Action invoke, Func<bool> available, string icon, string name = null)
            { var action = PageAction(label, invoke, available, name); action.Icon = icon; return action; }
            var blocks = new List<PanelBlock>();
            if (NativeEngine.Daily(rewardDay).Kind == 0) boardKind = "score";
            if (rewardRead == null || !rewardRead.TryValue(out var state))
            {
                // The page keeps its shape while a day is being read and when its read
                // failed: the rows' card says which, and the stepper works at its foot.
                if (BoardPair() is PanelBlock tabs) blocks.Add(tabs);
                bool failed = failure != null && !Busy;
                blocks.Add(PanelBlock.List("Board rows", new BoardRowView[0], empty: failed ? "Boards not loaded." : "Checking…"));
                if (failed) page.Primary = Act("Try again", () => _ = RefreshOverview(), () => PageAvailable() && !Busy, SkinSlots.IconRetry);
                else if (sessionActionPending || economyActionPending) Requesting(page);
                page.Stepper = Stepper(null, null);
                page.Blocks = blocks.ToArray();
                return page;
            }
            var boards = state.Boards; var board = boardKind == "score" ? boards.Score : boards.Theme;
            bool missing = boards.DailyStatus == "missing", live = !missing && board.Live && !boards.Finalizable, pending = !missing && board.Live && boards.Finalizable;
            // A board whose account is absent or could not be verified is not called sealed.
            bool unread = !missing && board.Account == null;
            // The stepper is the page's lowest row (owner, 2026-10-05): under the rows and the one button.
            page.Stepper = missing ? Stepper("No Daily this day", SkinTokens.TextMuted)
                : unread ? Stepper("Board not available", SkinTokens.TextMuted)
                : live ? Stepper("Live", SkinTokens.Positive, SkinSlots.IconLive)
                : pending ? Stepper("Results pending", SkinTokens.Accent)
                : Stepper(board.ClaimStatus == "claimable" && board.ExpiresAt.HasValue ? "Sealed · claim by " + ClaimBy(board.ExpiresAt.Value) : "Sealed", SkinTokens.Accent);
            if (BoardPair() is PanelBlock pair) blocks.Add(pair);
            string paid = ConfirmedRewardText(state);
            if (paid != null) blocks.Add(PanelBlock.Text("Reward received", paid, SkinTokens.Positive));
            var yours = YourRow(board, PlayedOn(state.Profile, rewardDay));
            if (yours != null) blocks.Add(PanelBlock.Card("Your row card", yours));
            // The rows: the chain's own, then the read model's places under the divider.
            var rows = BoardRows(board).Concat(board.Unpaid.Select(row => new BoardRowView { Rank = row.Rank.ToString(CultureInfo.InvariantCulture),
                Player = row.Player == identity.Owner ? "You" : Short(row.Player), Value = row.Metric.ToString("N0", CultureInfo.InvariantCulture),
                Yours = row.Player == identity.Owner, Unofficial = true })).ToArray();
            PageAction more = rows.Length > boardRows ? PageAction("More places", MoreRows, () => PageAvailable() && !Busy) :
                board.PlacesBeyond > 0 ? PageAction("More places", () => _ = MorePlaces(board), () => PageAvailable() && !Busy) : null;
            var list = PanelBlock.List("Board rows", rows.Take(boardRows).ToArray(), "Below the paid places · unofficial", more,
                missing ? "Nobody entered this day." : unread ? "This board could not be read." : live ? "No runs yet" : "No qualifying runs");
            list.Primary = boardRowsFrom;
            blocks.Add(list);
            // One button at most, in the foot row, on the stepper.
            if (economyActionPending || sessionActionPending) Requesting(page);
            else if (state.Pending != null) Awaiting("Rewards", page, () => PageAvailable() && !Busy);
            else if (Refused("Rewards", page, () => PageAvailable() && !Busy)) { }
            else if (pending || board.ClaimStatus == "claimable")
            {
                // Sealing a day and claiming a reward are this device's own transactions.
                if (!state.Session.Current) page.Primary = Act("Set up device", () => _ = OpenSession(), () => PageAvailable() && !Busy, SkinSlots.IconDevice);
                else if (state.Session.Funding != "ready") page.Primary = Act("Top up deposit", () => _ = OpenSession(), () => PageAvailable() && !Busy, SkinSlots.IconPlus);
                else if (pending) page.Primary = Act("Seal results", () => _ = SealResults(), CanSealResults, SkinSlots.IconLock);
                else page.Primary = Act("Claim " + Sol(board.Yours.PayoutLamports), () => _ = CollectReward(board.Kind), () => CanClaimReward(board.Kind), SkinSlots.IconTrophy,
                    "Collect " + MoneyText.Board(board.Kind, catalog));
            }
            else if (NextReward(board).HasValue)
            {
                var next = NextReward(board).Value;
                page.Primary = Act(next.Day == rewardDay ? "Next reward · " + MoneyText.Board(next.Kind, catalog) : "Next reward · " + BoardDay(next.Day),
                    () => { if (next.Day == rewardDay) ShowBoard(next.Kind); else _ = OpenRewards(next.Day, next.Kind); }, () => PageAvailable() && !Busy, SkinSlots.IconTrophy, "Next reward");
            }
            page.Blocks = blocks.ToArray();
            return page;
        }
        private static string ClaimBy(long seconds) => DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime.ToString("d MMM", CultureInfo.InvariantCulture);
        // The player's card over the rows says what the rows do not, so a player
        // is never shown twice with the same figures. A row in the list is lit
        // in place. On a live board the card stands only for a row below the top
        // ones, or to say the player has no score there yet. On a sealed board it
        // is the claim's anchor: the rank, what the reward is and where its claim
        // stands. A place below the paying rows comes from the public read model
        // and is said to be so.
        private PanelBlock YourRow(PrizeBoard board, bool played)
        {
            var (icon, chip) = BoardIcon(board.Kind);
            string Place(uint rank) => "#" + rank.ToString("N0", CultureInfo.InvariantCulture);
            string Figure(uint rank, ulong metric) => Place(rank) + " · " + metric.ToString("N0", CultureInfo.InvariantCulture);
            if (board.Live)
            {
                var row = board.Account.Rows.FirstOrDefault(value => value.Player == identity.Owner);
                if (row == null) return played ? PanelBlock.Row("Your row", "You", null, detail: NoScore, icon: icon, chip: chip) : null;
                return row.Position < PageViews.LandingRowsSeeker ? null : PanelBlock.Row("Your row", "You", Figure(row.Position + 1, board.Metric(row)), icon: icon, chip: chip);
            }
            if (board.Yours != null)
            {
                string payout = Sol(board.Yours.PayoutLamports);
                string detail = board.ClaimStatus == "claimed" ? payout + " claimed" : board.ClaimStatus == "expired" ? "Claim window closed" :
                    board.ExpiresAt.HasValue ? payout + " · claim by " + ClaimBy(board.ExpiresAt.Value) : payout;
                return PanelBlock.Row("Your row", "You", Place(board.Yours.Rank), detail: detail, icon: icon, chip: chip);
            }
            return board.Standing == null ? null :
                PanelBlock.Row("Your row", "You", Figure(board.Standing.Rank, board.Standing.Metric), detail: "Below the paid places", icon: icon, chip: chip);
        }
        private void MoreRows()
        {
            if (Busy) return;
            boardRowsFrom = Math.Max(0, boardRows - 3); boardRows += BoardRowsStep; Present();
        }
        // The next hundred places of a sealed board from the public read model; no answer adds nothing.
        private async Task MorePlaces(PrizeBoard board)
        {
            if (Busy || rewardRead == null || !rewardRead.IsCurrent) return;
            int shown = board.Rows.Count + board.Unpaid.Count;
            try { await Flow.MoreStandings(board); }
            catch (Exception error) { ZKube.Integration.Transport.ClientLog.Failure("more places", error); }
            if (this == null || !browsingRewards) return;
            boardRowsFrom = Math.Max(0, shown - 3); boardRows = Math.Max(boardRows, board.Rows.Count + board.Unpaid.Count); Present();
        }
        // A board's pictogram: the score's spark, or the day's objective in its realm's bonus with its chip.
        private (string Icon, string Chip) BoardIcon(string kind) => BoardIcon(kind, rewardDay);
        private (string Icon, string Chip) BoardIcon(string kind, uint day)
        {
            var daily = NativeEngine.Daily(day);
            if (kind == "score" || daily.Kind == 0) return (SkinSlots.GoalScore, null);
            var goal = catalog.Goal(daily.Kind, daily.Value);
            return (goal.Pictogram((byte)Protocol.Realms.Single(realm => realm.MapId == daily.Realm).GuardianAndHeight[0]), goal.chip);
        }

        // The rewards this address can still claim, read beside the pages that
        // show them (the landing page's badge, the boards page's Next reward)
        // and kept for this address only. A failed read keeps nothing.
        private (uint Day, string Kind)[] claims = Array.Empty<(uint, string)>();
        private IdentityLease claimsLease;
        private int claimsSerial;
        private (uint Day, string Kind)[] Claims => claimsLease != null && identity.IsCurrent(claimsLease) ? claims : Array.Empty<(uint, string)>();
        private void ReadClaims() => _ = ReadClaims(++claimsSerial, identity.Lease());
        private async Task ReadClaims(int serial, IdentityLease lease)
        {
            try
            {
                var read = await Flow.ClaimableRewards(Today, now());
                if (this == null || serial != claimsSerial || !identity.IsCurrent(lease)) return;
                claims = read; claimsLease = lease; Present();
            }
            catch (Exception error) { ZKube.Integration.Transport.ClientLog.Failure("claimable rewards", error); }
        }
        // The next reward to claim after the one shown: the other board of this day first, then the oldest day.
        private (uint Day, string Kind)? NextReward(PrizeBoard shown)
        {
            foreach (var claim in Claims.OrderBy(value => value.Day == rewardDay ? 0 : 1))
                if (claim.Day != rewardDay || claim.Kind != shown.Kind) return claim;
            return null;
        }
        private string ConfirmedRewardText(MoneyRewardState state)
        {
            var payment = rewardPayment; var result = state.PreviousOperation;
            if (payment == null || !identity.IsCurrent(payment.Owner) || payment.Day != rewardDay || string.IsNullOrEmpty(payment.Signature) ||
                result?.Signature != payment.Signature || result.Outcome != ExecutionOutcome.ConfirmedSuccess) return null;
            var board = payment.Kind == "score" ? state.Boards.Score : state.Boards.Theme;
            if (board.ClaimStatus != "claimed" || state.Profile.LadderPoints < payment.PreviousPoints ||
                state.Profile.LadderPoints - payment.PreviousPoints < payment.Points) return null;
            // The confirmed claim instruction awards this native-computed amount.
            // The total above is always the subsequently validated profile value.
            return MoneyText.Board(payment.Kind, catalog) + " reward received · " + Sol(payment.Amount) + "\n+" + NumberFit.Figure(payment.Points) + " ladder points";
        }
        public Task CollectReward(string kind)
        {
            if (!CanClaimReward(kind)) return Task.CompletedTask;
            var board = RewardBoard(kind);
            var payment = new RewardPayment { Owner = identity.Lease(), Day = rewardDay, Kind = kind, Amount = board.Yours.PayoutLamports,
                Points = NativeEngine.LadderPoints(board.Account.QualifiedCount, board.Yours.Rank), PreviousPoints = rewardRead.Value.Profile.LadderPoints };
            rewardPayment = payment;
            return Act("reward claim", false, async token => (await Flow.ClaimDaily(payment.Day, kind, token)).Value, RefreshRewardPage,
                () => _ = CollectReward(kind), result => payment.Signature = result.Signature);
        }
    }
}
