using System;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core;
using ZKube.Integration.App;
using ZKube.Integration.Client;
using ZKube.Integration.Execution;

namespace ZKube.Integration.Presentation
{
    public sealed partial class MoneyAppController
    {
        private RectTransform rewardPanel;
        private Button rewardButton;
        private MoneyRead<MoneyRewardState> rewardRead;
        private bool browsingRewards;
        private uint rewardDay;
        private int scorePage, themePage;
        private RewardPayment rewardPayment;
        public bool BrowsingRewards => browsingRewards;
        public uint RewardDay => rewardDay;
        private sealed class RewardPayment
        {
            internal IdentityLease Owner;
            internal uint Day, Points;
            internal string Kind, Signature;
            internal ulong Amount, PreviousPoints;
        }

        public Task OpenRewards(uint? day = null) => Run(async (epoch, token) => {
            if (identity.Owner == null) return;
            uint today = checked((uint)(now() / 86400));
            uint selected = day ?? today;
            if (selected > today) throw new ArgumentOutOfRangeException(nameof(day));
            CloseProductViews(); browsingRewards = true; rewardDay = selected; scorePage = themePage = 0;
            overviewPanel.gameObject.SetActive(false);
            await RefreshRewardPage(epoch, token);
        });
        private void CloseRewardView()
        {
            ClearRewardObservation(); browsingRewards = false;
            if (overviewPanel != null) overviewPanel.gameObject.SetActive(true);
        }
        private void ClearRewardObservation()
        {
            rewardRead = null;
            if (rewardPanel != null) { rewardPanel.gameObject.SetActive(false); Destroy(rewardPanel.gameObject); rewardPanel = null; }
        }
        private async Task RefreshRewardPage(long epoch, CancellationToken token)
        {
            ClearRewardObservation();
            if (identity.Owner == null) { CloseRewardView(); return; }
            DrawRewardNotice("Checking results and rewards…"); status.text = "Checking results…";
            var read = await Flow.RefreshRewards(rewardDay, token);
            if (!Current(epoch) || !browsingRewards) return;
            rewardRead = read; economyReadbackNeeded = false;
            if (read.Value.PreviousOperation != null) ShowReceipt(read.Value.PreviousOperation, identity.Owner);
            DrawRewards(); status.text = "Results updated";
        }
        private void RefreshRewardIdentity()
        {
            if (rewardPayment != null && !identity.IsCurrent(rewardPayment.Owner)) rewardPayment = null;
            if (economyReadbackNeeded && browsingRewards && !Busy && !paused)
            { economyReadbackNeeded = false; _ = RefreshOverview(); return; }
            if (!browsingRewards || rewardRead == null) return;
            if (!rewardRead.IsCurrent)
            {
                ClearRewardObservation(); DrawRewardNotice("Your results changed. Refresh to check your rewards.");
                status.text = "Results need refreshing"; return;
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
        private void BeginRewardPanel()
        {
            ReplacePagePanel(ref rewardPanel, "Daily results");
            Label(rewardPanel, "Daily results", 32, true);
            Label(rewardPanel, DateTimeOffset.FromUnixTimeSeconds((long)rewardDay * 86400).ToString("d MMM yyyy", CultureInfo.InvariantCulture) + " UTC", 23, true);
        }
        private void RewardNavigation()
        {
            if (rewardDay > 0) Button(rewardPanel, "Previous day", () => _ = OpenRewards(rewardDay - 1));
            if (rewardDay < now() / 86400) Button(rewardPanel, "Next day", () => _ = OpenRewards(rewardDay + 1));
            Button(rewardPanel, "Refresh results", () => _ = RefreshOverview());
            Button(rewardPanel, "Daily", () => _ = OpenDaily());
            Button(rewardPanel, "This device", () => _ = OpenSession());
            Button(rewardPanel, "Overview", () => _ = OpenOverview());
            Button(rewardPanel, "Disconnect", () => _ = Disconnect());
        }
        private void DrawRewardNotice(string message)
        { BeginRewardPanel(); Label(rewardPanel, message, 20, false); RewardNavigation(); }
        private void DrawRewards()
        {
            var state = rewardRead.Value; BeginRewardPanel();
            Label(rewardPanel, "Ladder · " + state.Profile.LadderPoints + " points", 23, true);
            string paid = ConfirmedRewardText(state);
            if (paid != null) Label(rewardPanel, paid, 23, true);
            if (economyActionPending || sessionActionPending) Label(rewardPanel, "Your transaction is still finishing.", 20, false);
            else if (state.Pending != null)
            {
                Label(rewardPanel, "Check your pending transaction before collecting another reward.", 20, false);
                Button(rewardPanel, "Check transaction", () => _ = CheckTransaction());
            }
            else if (!state.Session.Current) Label(rewardPanel, "Set up this device to collect rewards.", 20, false);
            else if (state.Session.Funding != "ready") Label(rewardPanel, "Refill this device's fee allowance to collect rewards.", 20, false);
            DrawRewardBoard(state.Boards.Score, ref scorePage);
            DrawRewardBoard(state.Boards.Theme, ref themePage);
            RewardNavigation(); Controls();
        }
        private static string RewardName(string kind) => kind == "score" ? "Score" : "Theme";
        private static string RewardSol(ulong lamports) => (lamports / 1000000000m).ToString("0.#########", CultureInfo.InvariantCulture) + " SOL";
        private void DrawRewardBoard(PrizeBoard board, ref int page)
        {
            string name = RewardName(board.Kind);
            Label(rewardPanel, name, 28, true);
            string message = board.ClaimStatus switch {
                "claimable" => "Your reward · " + RewardSol(board.Yours.PayoutLamports),
                "claimed" => "Reward collected", "expired" => "The claim window has closed.",
                "unsealed" => "Results are being finalized. Rewards open when this board is sealed.",
                "not-ranked" => board.Rows.Count == 0 ? "No qualifying winners on this board." : "You have no reward on this board.",
                _ => "Results are not available yet."
            };
            Label(rewardPanel, message, 20, false);
            if (board.ExpiresAt.HasValue)
                Label(rewardPanel, "Claim deadline · " + DateTimeOffset.FromUnixTimeSeconds(board.ExpiresAt.Value)
                    .ToString("d MMM yyyy HH:mm:ss", CultureInfo.InvariantCulture) + " UTC", 18, false);
            if (board.ClaimStatus == "claimable") Button(rewardPanel, "Collect " + name, () => _ = CollectReward(board.Kind));
            const int count = 5;
            page = Math.Max(0, Math.Min(page, Math.Max(0, (board.Rows.Count - 1) / count)));
            foreach (var row in board.Rows.Skip(page * count).Take(count))
            {
                string player = row.Record.Player == identity.Owner ? "You" : row.Record.Player.Substring(0, 6) + "…" + row.Record.Player.Substring(row.Record.Player.Length - 4);
                Label(rewardPanel, "#" + row.Rank + "  " + player + "  ·  " + row.Metric + "  ·  " + RewardSol(row.PayoutLamports), 18, false);
            }
            if (page > 0) Button(rewardPanel, "Previous " + name + " rows", () => ChangeRewardRows(board.Kind, -1));
            if ((page + 1) * count < board.Rows.Count) Button(rewardPanel, "More " + name + " rows", () => ChangeRewardRows(board.Kind, 1));
        }
        private void ChangeRewardRows(string kind, int delta)
        {
            if (Busy || rewardRead == null || !rewardRead.IsCurrent) return;
            if (kind == "score") scorePage += delta; else themePage += delta;
            DrawRewards();
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
            return RewardName(payment.Kind) + " reward received · " + RewardSol(payment.Amount) + "\n+" + payment.Points + " ladder points";
        }
        public Task CollectReward(string kind)
        {
            if (!CanClaimReward(kind)) return Task.CompletedTask;
            var board = RewardBoard(kind);
            var payment = new RewardPayment { Owner = identity.Lease(), Day = rewardDay, Kind = kind, Amount = board.Yours.PayoutLamports,
                Points = NativeEngine.LadderPoints(board.Account.QualifiedCount, board.Yours.Rank), PreviousPoints = rewardRead.Value.Profile.LadderPoints };
            rewardPayment = payment;
            return Run(async (epoch, token) => {
                economyActionPending = true; DrawRewards();
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
                    if (Current(epoch)) { if (rewardRead != null && rewardRead.IsCurrent) DrawRewards(); Controls(); }
                    else economyReadbackNeeded = true;
                }
            });
        }
        private void RewardControls(bool available)
        {
            if (rewardButton != null) rewardButton.interactable = available && !Busy && identity?.Owner != null;
            if (rewardPanel == null) return;
            foreach (var button in rewardPanel.GetComponentsInChildren<Button>(true))
                button.interactable = available && (button.name == "Disconnect" || (!Busy &&
                    (button.name == "Collect Score" ? CanClaimReward("score") : button.name == "Collect Theme" ? CanClaimReward("theme") : true)));
        }
    }
}
