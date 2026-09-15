using System;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Client.Runs;

namespace ZKube.Integration.App
{
    public sealed class MoneyDailyState
    {
        public DailyLobby Lobby { get; }
        public DailyEntryReadiness Entry { get; }
        public RunClientState Run { get; }
        internal MoneyDailyState(DailyLobby lobby, DailyEntryReadiness entry, RunClientState run)
        { Lobby = lobby; Entry = entry; Run = run; }
    }

    public sealed partial class MoneyAppFlow
    {
        public Task<MoneyRead<MoneyDailyState>> RefreshDaily(CancellationToken cancellation = default) =>
            ReadOwnerProduct(cancellation, async (lease, token) => {
                var lobby = await services.Products.CurrentDaily(token).ConfigureAwait(false);
                var run = await services.Runs.Inspect("daily", token).ConfigureAwait(false);
                var readiness = await services.EntryReadiness.Read(token).ConfigureAwait(false);
                if (lobby.Value.DayId != readiness.Value.DayId)
                    throw new OperationCanceledException("UTC Daily changed during refresh");
                return new MoneyDailyState(lobby.Value, readiness.Value, run);
            });

        // This is called only after the explicit one-Kredit entry choice.
        // Re-read readiness; a previously rendered enabled button grants no
        // authority and cannot bypass suspension, freeze or an occupied slot.
        public Task<MoneyRead<MoneyRunLaunch>> StartDailyRun(CancellationToken cancellation = default) =>
            LaunchNewRun(cancellation, async (lease, token) => {
                var readiness = await services.EntryReadiness.Read(token).ConfigureAwait(false);
                if (!readiness.Value.Ready)
                    throw new InvalidOperationException("Daily entry is unavailable: " + readiness.Value.Status);
                var occupied = await services.Runs.Inspect("daily", token).ConfigureAwait(false);
                if (occupied.Phase != "none")
                    throw new InvalidOperationException("Resume the saved Daily run first");
                token.ThrowIfCancellationRequested();
                var first = await CaptureRun(lease, "daily", null, scope =>
                    services.Runs.StartDaily(token, scope)).ConfigureAwait(false);
                return await OpenAcceptedRun(lease, "daily", first, token).ConfigureAwait(false);
            });
    }
}
