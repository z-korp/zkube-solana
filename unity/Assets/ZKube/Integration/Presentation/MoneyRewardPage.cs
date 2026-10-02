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
        private int boardPage;
        // The board whose rows are shown ("score" or "theme"), or null for the rewards.
        private string boardKind;
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

        public Task OpenRewards(uint? day = null) => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            uint today = Today;
            uint selected = day ?? today;
            if (selected > today) throw new ArgumentOutOfRangeException(nameof(day));
            CloseProductViews(); browsingRewards = true; rewardDay = selected; boardKind = null; boardPage = 0;
            await RefreshRewardPage(epoch, token);
        });
        private void CloseRewardView() { ClearRewardObservation(); browsingRewards = false; boardKind = null; }
        private void ClearRewardObservation() { rewardRead = null; pageNotice = null; Present(); }
        private async Task RefreshRewardPage(long epoch, CancellationToken token)
        {
            ClearRewardObservation();
            if (identity.Owner == null) { CloseRewardView(); return; }
            Notice("Checking results and rewards…"); Status = "Checking results…";
            var read = await Flow.RefreshRewards(rewardDay, token);
            if (!Current(epoch) || !browsingRewards) return;
            rewardRead = read; economyReadbackNeeded = false; pageNotice = null;
            if (read.Value.PreviousOperation != null) ShowReceipt(read.Value.PreviousOperation, identity.Owner);
            Present(); Status = "Results updated";
        }
        private void RefreshRewardIdentity()
        {
            if (rewardPayment != null && !identity.IsCurrent(rewardPayment.Owner)) rewardPayment = null;
            if (economyReadbackNeeded && browsingRewards && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingRewards || rewardRead == null) return;
            if (!rewardRead.IsCurrent)
            {
                ClearRewardObservation(); Notice("Your results changed. Refresh to check your rewards.");
                Status = "Results need refreshing"; return;
            }
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
        // A board by its name on this day.
        private string RewardName(string kind) => MoneyText.Board(kind, catalog, rewardDay);

        private PageAction DayAction(string label, int step) =>
            PageAction(label, () => _ = OpenRewards((uint)(rewardDay + step)), () => PageAvailable() && !Busy);
        // The days either side, and the ladder total at the line's end.
        private PanelBlock Days(MoneyRewardState state) => PanelBlock.Bar("Ladder total", null, NumberFit.Figure(state.Profile.LadderPoints), "ladder points", true,
            rewardDay > 0 ? DayAction("Earlier day", -1) : null, rewardDay < Today ? DayAction("Later day", 1) : null);

        // The day's two boards, each with your position and payout and its claim,
        // or why there is none; the guardian speaks for a day with nothing to show.
        private PanelPageView RewardPage()
        {
            var back = PageAction("Back", () => _ = OpenDaily(), () => PageAvailable() && !Busy);
            string subtitle = Day(rewardDay) + " · UTC";
            if (rewardRead == null) { var waiting = Waiting("Rewards " + rewardDay, "Rewards", subtitle, AppPage.Home, pageNotice); waiting.Back = back; return waiting; }
            if (boardKind != null) return BoardPage();
            var state = rewardRead.Value; var boards = new[] { state.Boards.Score, state.Boards.Theme };
            var page = new PanelPageView { Key = "Rewards " + rewardDay, Title = "Rewards", Subtitle = subtitle, Back = back, Tab = AppPage.Home };
            var blocks = new List<PanelBlock>();
            var receipt = ReceiptRow("Rewards");
            if (receipt != null) blocks.Add(receipt);
            string paid = ConfirmedRewardText(state);
            if (economyActionPending || sessionActionPending)
            { blocks.Add(PanelBlock.Text("Reward notice", "Your transaction is still finishing.")); blocks.Add(DisconnectButton()); }
            else if (state.Pending != null)
            {
                blocks.Add(PanelBlock.Text("Reward notice", "Check your pending transaction before collecting another reward."));
                blocks.Add(PanelBlock.Button(PageAction("Check transaction", () => _ = CheckTransaction(), () => PageAvailable() && !Busy), true));
            }
            if (boards.All(board => board.ClaimStatus == "unsealed") && paid == null)
            {
                blocks.Add(PanelBlock.Talk("This board has not been sealed yet. Rewards open after its results are finalized.", "idle"));
                blocks.Add(PanelBlock.Title("Results pending"));
                blocks.Add(PanelBlock.Button(PageAction("Refresh results", () => _ = RefreshOverview(), () => PageAvailable() && !Busy), true));
                blocks.Add(Days(state));
                page.Blocks = blocks.ToArray();
                return page;
            }
            if (boards.All(board => board.Yours == null && board.Standing == null) && paid == null)
            {
                blocks.Add(PanelBlock.Talk(boards.All(board => board.Rows.Count == 0) ? "No one placed on this day’s sealed boards." :
                    "You have no placed position on a sealed board for this day.", "idle"));
                blocks.Add(PanelBlock.Icon(SkinSlots.IconTrophy, SkinTokens.Text));
                blocks.Add(PanelBlock.Title("No rewards yet"));
                blocks.Add(PanelBlock.Button(PageAction("Back to Arcade", () => _ = OpenDaily(), () => PageAvailable() && !Busy), true));
                foreach (var board in boards.Where(board => board.Rows.Count != 0))
                    blocks.Add(PanelBlock.Button(Shorter(PageAction("View " + RewardName(board.Kind) + " board", () => OpenBoard(board.Kind),
                        () => PageAvailable() && !Busy), "View " + MoneyText.Board(board.Kind, catalog) + " board"), false));
                blocks.Add(Days(state));
                page.Blocks = blocks.ToArray();
                return page;
            }
            if (paid != null) blocks.Add(PanelBlock.Text("Reward received", paid, SkinTokens.Positive));
            if (state.Pending == null && !economyActionPending && !sessionActionPending)
            {
                if (!state.Session.Current) blocks.Add(PanelBlock.Text("Reward notice", "Set up this device to collect rewards."));
                else if (state.Session.Funding != "ready") blocks.Add(PanelBlock.Text("Reward notice", "Refill this device's fee allowance to collect rewards."));
            }
            foreach (var board in boards) blocks.Add(BoardCard(board, state));
            blocks.Add(Days(state));
            blocks.Add(PanelBlock.Text("Claim window", "Each board has a 30-day claim window from sealing.", SkinTokens.TextMuted));
            page.Blocks = blocks.ToArray();
            return page;
        }
        // One board: its name and whether it is sealed, then your place (or
        // the board) with where it stands, its claim naming the payout, and
        // the board's rows.
        private PanelBlock BoardCard(PrizeBoard board, MoneyRewardState state)
        {
            string name = RewardName(board.Kind);
            bool isSealed = board.ClaimStatus != "unsealed" && board.ClaimStatus != "unavailable";
            var lines = new List<PanelBlock> { PanelBlock.Eyebrow(name + " board", SkinTokens.TextMuted, isSealed ? "Sealed" : null) };
            PanelBlock claim = null; string detail;
            switch (board.ClaimStatus)
            {
                case "claimable":
                    detail = board.ExpiresAt.HasValue ? "Claim by " + Utc(board.ExpiresAt.Value) : null;
                    if (state.Pending == null && state.Session.Current && state.Session.Funding == "ready")
                        claim = PanelBlock.Button(PageAction("Claim " + Sol(board.Yours.PayoutLamports), () => _ = CollectReward(board.Kind), () => CanClaimReward(board.Kind),
                            "Collect " + MoneyText.Board(board.Kind, catalog)), true);
                    break;
                case "claimed": detail = "Reward collected · " + Sol(board.Yours.PayoutLamports); break;
                case "expired": detail = "Claim window closed · 30 days after sealing"; break;
                case "no-placement": detail = board.Rows.Count == 0 ? "No qualifying winners on this board." : "You have no reward on this board."; break;
                default: detail = "Results are not available yet."; break;
            }
            var (icon, chip) = BoardIcon(board.Kind);
            // Your place is the board's own row, or below its rows the public read model's rank.
            uint? place = board.Yours?.Rank ?? board.Standing?.Rank;
            lines.Add(PanelBlock.Row(name + " position", place.HasValue ? "Your place" : name, place.HasValue ? "#" + place.Value : null,
                detail: detail, icon: icon, chip: chip));
            if (claim != null) lines.Add(claim);
            if (board.Rows.Count != 0 || isSealed)
                lines.Add(PanelBlock.Button(PageAction("View board", () => OpenBoard(board.Kind), () => PageAvailable() && !Busy, "View " + name + " board"), false));
            return PanelBlock.Card(name + " card", lines.ToArray());
        }
        // A board's pictogram: the score's spark, or the day's objective in its realm's bonus with its chip.
        private (string Icon, string Chip) BoardIcon(string kind)
        {
            var daily = NativeEngine.Daily(rewardDay);
            if (kind == "score" || daily.Kind == 0) return (SkinSlots.GoalScore, null);
            var goal = catalog.Goal(daily.Kind, daily.Value);
            return (goal.Pictogram((byte)Protocol.Realms.Single(realm => realm.MapId == daily.Realm).GuardianAndHeight[0]), goal.chip);
        }
        // A board's own name where it fits a pill, its general name where not.
        private static PageAction Shorter(PageAction action, string words) { action.Short = words; return action; }
        private void OpenBoard(string kind)
        {
            if (Busy || rewardRead == null || !rewardRead.IsCurrent) return;
            boardKind = kind; boardPage = 0; Present();
        }

        // One sealed board's rows, five at a time, with your place.
        private PanelPageView BoardPage()
        {
            var board = RewardBoard(boardKind); string name = RewardName(boardKind);
            var back = PageAction("Back", () => { boardKind = null; Present(); }, () => PageAvailable() && !Busy, "Back to rewards");
            var page = new PanelPageView { Key = "Rewards " + rewardDay + " " + boardKind, Title = name + " board", Subtitle = Day(rewardDay) + " · Sealed",
                Back = back, Tab = AppPage.Home };
            // The two boards as a pair; the one shown is the primary.
            var toggle = PanelBlock.Pair(PageAction("Score", () => { boardKind = "score"; boardPage = 0; Present(); }, () => PageAvailable() && !Busy),
                Shorter(PageAction(RewardName("theme"), () => { boardKind = "theme"; boardPage = 0; Present(); }, () => PageAvailable() && !Busy),
                    MoneyText.Board("theme", catalog)),
                boardKind == "score" ? 0 : 1);
            if (board.Rows.Count == 0 && board.Unpaid.Count == 0)
            {
                page.Blocks = new[] { toggle,
                    PanelBlock.Talk("No one has a positive result on this board. A run needs a result above zero to place.", "idle"),
                    PanelBlock.Title("No qualifying runs"), PanelBlock.Button(back, true) };
                return page;
            }
            const int count = 5;
            // The board's own rows, then the ranks below them when the public read model has them.
            var rows = board.Rows.Select(row => (row.Rank, row.Record.Player, row.Metric, Payout: (ulong?)row.PayoutLamports))
                .Concat(board.Unpaid.Select(row => (row.Rank, row.Player, row.Metric, Payout: (ulong?)null))).ToArray();
            boardPage = Math.Max(0, Math.Min(boardPage, (rows.Length - 1) / count));
            var lines = new List<PanelBlock> { PanelBlock.Eyebrow(name) };
            var yours = rows.Where(row => row.Player == identity.Owner).Select(row => (row.Rank, row.Metric))
                .Concat(board.Standing == null ? Enumerable.Empty<(uint, ulong)>() : new[] { (board.Standing.Rank, board.Standing.Metric) }).Take(1).ToArray();
            if (yours.Length != 0)
                lines.Add(PanelBlock.Figure(name + " yours", "Your position", "#" + yours[0].Item1 + " · " + yours[0].Item2.ToString("N0", CultureInfo.InvariantCulture)));
            foreach (var row in rows.Skip(boardPage * count).Take(count))
            {
                string player = row.Player == identity.Owner ? "You" : Short(row.Player);
                lines.Add(PanelBlock.Row(name + " row " + row.Rank, "#" + row.Rank + "  " + player,
                    row.Metric.ToString("N0", CultureInfo.InvariantCulture) + (row.Payout.HasValue ? "  ·  " + Sol(row.Payout.Value) : ""), SkinTokens.Objective));
            }
            var blocks = new List<PanelBlock> { toggle, PanelBlock.Card(name + " rows", lines.ToArray()),
                PanelBlock.Text("Board rule", "One best run per player on each board. Places are final once the board is sealed.", centered: false) };
            if (boardPage > 0 || (boardPage + 1) * count < rows.Length)
                blocks.Add(PanelBlock.Pair(boardPage > 0 ? PageAction("Earlier rows", () => ChangeBoardRows(-1), () => PageAvailable() && !Busy) : null,
                    (boardPage + 1) * count < rows.Length ? PageAction("More rows", () => ChangeBoardRows(1), () => PageAvailable() && !Busy) : null));
            page.Blocks = blocks.ToArray();
            return page;
        }
        private void ChangeBoardRows(int delta)
        {
            if (Busy || rewardRead == null || !rewardRead.IsCurrent) return;
            boardPage += delta; Present();
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
            return Run(async (epoch, token) => {
                economyActionPending = true; Present();
                try
                {
                    var result = await Flow.ClaimDaily(payment.Day, kind, token);
                    payment.Signature = result.Value.Signature;
                    if (!Current(epoch)) return;
                    ShowReceipt(result.Value, identity.Owner);
                    await RefreshRewardPage(epoch, token);
                }
                finally
                {
                    economyActionPending = false;
                    if (Current(epoch)) Present(); else economyReadbackNeeded = true;
                }
            });
        }
    }
}
