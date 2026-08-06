import { Fragment } from "react";
import { Crosshair, Layers3, Timer, Trophy, Zap } from "lucide-react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { currentWeeklyId } from "@/chain/weeklyClient";
import { useWeekly } from "@/contexts/weekly";
import { RankMedal } from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import { GuardianFaceBlock, MONEY_GOLD, SolMark } from "@/ui/components/economy";
import EmptyState from "@/ui/components/shared/EmptyState";
import InfoTip from "@/ui/components/shared/InfoTip";
import { Spinner } from "@/ui/components/shared/LoadingState";
import { useCountdown } from "@/hooks/useNowTick";
import { formatSolBalanceLamports } from "@/utils/currency";
import { formatCountdown } from "@/utils/time";

const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};

const YOU_RING: React.CSSProperties = {
  border: "1px solid #FACC15",
  background: "rgba(250,204,21,0.10)",
  boxShadow: "0 0 10px rgba(250,204,21,0.25)",
};

const BOARD_CATEGORIES = [
  { label: "Combo", icon: Layers3 },
  { label: "Single act", icon: Zap },
  { label: "Full run", icon: Crosshair },
] as const;

interface WeeklyTabProps {
  /** Today's zone, for the guardian block on the pot panel. */
  zoneId?: number;
}

/**
 * The Weekly floor: one skill-pot line, then the three missions as cards —
 * name, metric, pot share, top three — stacked vertically (a carousel attempt
 * didn't land; revisit). Your
 * row wears the gold ring, and reappears below the top three whenever you
 * rank outside them. The split rules live in the ? popup.
 */
export default function WeeklyTab({ zoneId }: WeeklyTabProps = {}) {
  const controller = useWeekly();
  const owner = useConnectedPlayer().publicKey;
  const weekly = controller.weekly;
  const closeSeconds = useCountdown(weekly?.closesAt);

  if (controller.loading && !weekly) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (!weekly) {
    return (
      <EmptyState
        compact
        icon={<Trophy className="h-8 w-8" />}
        title="Weekly is being prepared"
        hint="The keeper prepares and funds the next Weekly before it opens."
      />
    );
  }

  const now = Math.floor(Date.now() / 1_000);
  const current = weekly.weeklyId === currentWeeklyId(now);
  const statusChip =
    current && closeSeconds > 0 ? (
      <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold tabular-nums text-white">
        <Timer size={12} className="text-white/50" />
        {formatCountdown(closeSeconds)}
      </span>
    ) : (
      <span className="rounded-full border border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[11px] font-bold text-white">
        {weekly.status === "finalized" ? "PAID" : "FINALIZING"}
      </span>
    );

  // Each board competes for an equal third of the guaranteed pot.
  const perBoardPot = weekly.activePotLamports / 3n;

  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-3">
      <section className="rounded-2xl p-3.5" style={PANEL_STYLE}>
        <div className="flex items-center gap-2.5">
          {zoneId !== undefined && (
            <GuardianFaceBlock zoneId={zoneId} size={44} />
          )}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className="money flex-none font-display text-[32px] leading-none tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(weekly.activePotLamports)}
            </span>
            <SolMark size={15} />
            <span className="ml-1 truncate font-sans text-[9px] font-bold uppercase tracking-[0.2em] text-white/40">
              skill pot
            </span>
          </div>
          {statusChip}
          <InfoTip label="Weekly rules">
            The pot splits equally across the three skill boards; each pays
            its top 3 60 / 25 / 15%, floored to 0.001 SOL. Every board keeps
            one metric per category, fixed when the Weekly opens, and a
            wallet may win more than one board.
          </InfoTip>
        </div>
      </section>

      <div className="flex flex-col gap-2">
        {BOARD_CATEGORIES.map(({ label, icon: Icon }, boardIndex) => {
          const metricLabel = weekly.metricLabels[boardIndex];
          const board = weekly.boards[boardIndex];
          const rows = board.slice(0, 3);
          const myIndex = owner
            ? board.findIndex((entry) => owner.equals(entry.player))
            : -1;

          const miniRow = (index: number) => {
            const entry = board[index];
            if (!entry) return null;
            const isYou = Boolean(owner?.equals(entry.player));
            const fullLabel = `${isYou ? "You · " : ""}${playerLabelWithWallet(
              entry.playerName,
              entry.player.toBase58(),
            )}`;
            return (
              <div
                key={`${entry.player.toBase58()}-${entry.runId}`}
                className={`mt-1.5 flex items-center gap-1.5 px-1.5 py-1 ${
                  isYou ? "rounded-lg" : ""
                }`}
                style={isYou ? YOU_RING : undefined}
                title={fullLabel}
              >
                <RankMedal rank={index + 1} size={17} />
                <span className="min-w-0 flex-1 truncate text-left font-sans text-[11px] font-bold text-white/90">
                  {isYou ? "You" : (entry.playerName ?? fullLabel)}
                </span>
                <span className="font-mono text-[12px] font-bold tabular-nums text-white">
                  {entry.value.toString()}
                </span>
              </div>
            );
          };

          return (
            <section
              key={label}
              className="rounded-2xl p-3 text-center"
              style={PANEL_STYLE}
            >
              <div className="grid h-7 place-items-center text-white/65">
                <Icon size={20} />
              </div>
              <p
                className="mt-1 font-mono text-[10px] font-bold uppercase tracking-[0.16em]"
                style={{ color: MONEY_GOLD }}
              >
                {label}
              </p>
              <p className="mt-0.5 truncate font-sans text-[11px] font-bold text-white/60">
                {metricLabel}
              </p>
              <p
                className="mt-1.5 flex items-center justify-center gap-1 font-mono text-[15px] font-bold tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolBalanceLamports(perBoardPot)}
                <SolMark size={11} />
              </p>
              {rows.length === 0 ? (
                <p className="mt-2 font-sans text-[11px] font-semibold text-white/35">
                  —
                </p>
              ) : (
                <Fragment>
                  {rows.map((_, index) => miniRow(index))}
                  {myIndex >= 3 && (
                    <Fragment>
                      <div className="mt-1 border-t border-white/[0.06]" />
                      {miniRow(myIndex)}
                    </Fragment>
                  )}
                </Fragment>
              )}
            </section>
          );
        })}
      </div>
      {controller.error && (
        <p className="text-center text-xs text-red-300">{controller.error}</p>
      )}
    </div>
  );
}
