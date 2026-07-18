import { Trophy } from "lucide-react";

import { useWeekly } from "@/contexts/weekly";
import { currentWeeklyId } from "@/chain/weeklyClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { TROPHY_IMAGES } from "@/ui/components/arena/leaderboardMedals";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import ArcadeButton from "@/ui/components/shared/ArcadeButton";
import EmptyState from "@/ui/components/shared/EmptyState";
import InfoSheet, { InfoRow } from "@/ui/components/shared/InfoSheet";
import { Spinner } from "@/ui/components/shared/LoadingState";
import StatTile from "@/ui/components/shared/StatTile";
import { useThemeColors } from "@/ui/elements/theme-provider/hooks";
import { formatDurationCoarse } from "@/utils/time";
import { formatSolLamports } from "@/utils/currency";

export default function WeeklyTab() {
  const colors = useThemeColors();
  const controller = useWeekly();
  const owner = useConnectedPlayer().publicKey;
  const weekly = controller.weekly;

  if (controller.loading && !weekly) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (!weekly) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center text-sm text-white/55">
        Weekly competition activates with Economy.
      </div>
    );
  }

  const rank = owner
    ? weekly.leaderboard.findIndex((entry) => entry.player.equals(owner))
    : -1;
  const isSolWinner = rank >= 0 && rank < weekly.solWinnerCount;
  const isStarWinner =
    rank >= 0 && rank < weekly.solWinnerCount + weekly.starWinnerCount;
  const canClaimSol =
    weekly.status === "claimable" && isSolWinner && !weekly.player?.solClaimed;
  const canClaimStars =
    weekly.status === "claimable" &&
    isStarWinner &&
    !weekly.player?.starsClaimed;

  // The controller intentionally surfaces the previous week while its claims
  // stay open, so the human label must not pretend it is still running.
  const nowUnix = Math.floor(Date.now() / 1_000);
  const isCurrentWeek = weekly.weekId === currentWeeklyId(nowUnix);
  const weekLabel = isCurrentWeek ? "This week" : "Last week";
  const timingLine = isCurrentWeek
    ? weekly.finalizesAt > nowUnix
      ? `Ends in ${formatDurationCoarse(weekly.finalizesAt - nowUnix)}`
      : "Finalizing"
    : weekly.status === "claimable" && weekly.claimsCloseAt > nowUnix
      ? `Claims close in ${formatDurationCoarse(weekly.claimsCloseAt - nowUnix)}`
      : "Finished";
  const hasCommittedPool =
    weekly.solWinnerCount > 0 && weekly.committedSolPool > 0n;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <section className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xl font-black text-white">
              {weekLabel}
            </p>
            <p className="mt-1 text-xs font-semibold text-white/55">
              {timingLine} · best 5 Daily results count
            </p>
          </div>
          <Trophy className="h-7 w-7" style={{ color: colors.accent2 }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <StatTile
            size="sm"
            label="Your score"
            value={weekly.player?.score.toString() ?? "0"}
            className="border-transparent bg-black/20"
          />
          <StatTile
            size="sm"
            label="Days"
            value={weekly.player?.resultCount.toString() ?? "0"}
            className="border-transparent bg-black/20"
          />
          <StatTile
            size="sm"
            label="SOL pool"
            value={`${formatSolLamports(weekly.committedSolPool)} SOL`}
            className="border-transparent bg-black/20"
          />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs leading-relaxed text-white/55">
            {hasCommittedPool
              ? `Top ${weekly.solWinnerCount} share the SOL pool · next ${weekly.starWinnerCount} win Stars.`
              : "The SOL pool builds from Star purchases during the week."}
          </p>
          <InfoSheet title="How Weekly payouts work">
            <p>
              Your best five Daily results add up to your Weekly score; days you
              skip count as zero.
            </p>
            <div>
              <InfoRow
                label="SOL winners"
                value={`Top ${weekly.solWinnerCount} · 55/30/15 split, renormalized`}
              />
              <InfoRow
                label="Star winners"
                value={`Next ${weekly.starWinnerCount} · 30/25/20/15/10 Stars by rank quantile`}
              />
              <InfoRow label="SOL winner bonus" value="+30 Stars" />
              <InfoRow label="Week" value={`#${weekly.weekId}`} />
            </div>
            <p>
              Rewards become claimable after the week finalizes and stay open
              for a limited claim window.
            </p>
          </InfoSheet>
        </div>
        {(canClaimSol || canClaimStars) && (
          <div className="mt-3 flex flex-col gap-2">
            {canClaimStars && (
              <ArcadeButton
                disabled={controller.action !== null}
                onClick={() => void controller.claimStars()}
              >
                {controller.action === "claim:stars"
                  ? "Claiming..."
                  : "Claim Weekly Stars"}
              </ArcadeButton>
            )}
            {canClaimSol && (
              <ArcadeButton
                disabled={controller.action !== null}
                onClick={() => void controller.claimSol()}
              >
                {controller.action === "claim:sol"
                  ? "Claiming..."
                  : "Claim Weekly SOL"}
              </ArcadeButton>
            )}
          </div>
        )}
      </section>

      {weekly.leaderboard.length === 0 ? (
        <EmptyState
          compact
          icon={<Trophy className="h-8 w-8" />}
          title="No Daily rollups yet"
          hint="Finish a Daily run and it rolls into this week's score."
        />
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1 pt-1">
            <p
              className="font-sans text-[11px] font-black uppercase tracking-[0.18em]"
              style={{ color: colors.textMuted }}
            >
              Standings
            </p>
            <p
              className="font-sans text-[11px] font-bold"
              style={{ color: colors.textMuted }}
            >
              {weekly.leaderboard.length} player
              {weekly.leaderboard.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="space-y-2">
            {weekly.leaderboard.map((entry, index) => {
              const rank = index + 1;
              const isYou = Boolean(owner && entry.player.equals(owner));
              const medalBg =
                rank === 1
                  ? "rgba(255,215,0,0.2)"
                  : rank === 2
                    ? "rgba(192,192,192,0.18)"
                    : rank === 3
                      ? "rgba(205,127,50,0.18)"
                      : "rgba(255,255,255,0.06)";
              return (
                <div
                  key={entry.player.toBase58()}
                  className={`flex items-center gap-3 rounded-2xl border px-4 py-3 backdrop-blur-xl ${isYou ? "leaderboard-pulse" : ""}`}
                  style={{
                    ...(isYou
                      ? ({
                          "--pulse-base": `${colors.accent}20`,
                          "--pulse-bright": `${colors.accent}40`,
                        } as React.CSSProperties)
                      : { backgroundColor: medalBg }),
                    borderColor: isYou
                      ? `${colors.accent}AA`
                      : rank <= 3
                        ? "rgba(255,255,255,0.28)"
                        : "rgba(255,255,255,0.12)",
                  }}
                >
                  <div
                    className="flex w-7 shrink-0 items-center justify-center font-sans text-base font-black"
                    style={{
                      color: rank <= 3 ? colors.accent2 : colors.textMuted,
                    }}
                  >
                    {rank <= 3 ? (
                      <img
                        src={TROPHY_IMAGES[rank]}
                        alt={`Rank ${rank}`}
                        className="h-6 w-6"
                        draggable={false}
                      />
                    ) : (
                      rank
                    )}
                  </div>
                  <span
                    className="min-w-0 flex-1 truncate font-sans text-sm font-extrabold"
                    style={{ color: isYou ? colors.accent : colors.text }}
                  >
                    {isYou
                      ? `You · ${playerLabelWithWallet(entry.playerName, entry.player.toBase58())}`
                      : playerLabelWithWallet(
                          entry.playerName,
                          entry.player.toBase58(),
                        )}
                  </span>
                  <span
                    className="shrink-0 font-sans text-[17px] font-black tracking-wide tabular-nums"
                    style={{ color: colors.text }}
                  >
                    {entry.score}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {controller.error && (
        <p className="text-center text-xs text-red-300">{controller.error}</p>
      )}
    </div>
  );
}
