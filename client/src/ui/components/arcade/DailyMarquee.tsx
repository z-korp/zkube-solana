import type { ReactNode } from "react";
import { Timer, Users } from "lucide-react";
import { motion } from "motion/react";

import type { DailyLeaderboardView } from "@/chain/dailyClient";
import { dailyScoringRuleName } from "@/chain/dailyRules";
import type { DailyScoringRuleView } from "@/chain/dailyRules";
import { getZoneGuardian } from "@/config/bossCharacters";
import { ladderTierColor, ladderTierName } from "@/config/ladderTiers";
import { tierFrameInnerSize } from "@/config/tierFrames";
import { useLeaderboardEmblems } from "@/hooks/useLeaderboardEmblems";
import { RankBadge } from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import {
  GuardianFaceBlock,
  MONEY_GOLD,
  SolMark,
  TierFrame,
  computeRankPayouts,
  dailyBoardPools,
} from "@/ui/components/economy";
import { useCountdown } from "@/hooks/useNowTick";
import { formatSolBalanceLamports } from "@/utils/currency";
import { formatCountdown } from "@/utils/time";

/** The public face of today's Daily — every field readable without a wallet. */
export interface DailyMarqueeView {
  dailyPotLamports: bigint;
  runsCloseAt: number;
  uniquePlayers: number;
  leaderboard: readonly DailyLeaderboardView[];
  scoringRule: DailyScoringRuleView | null;
  scoreQualifiedPlayers: number;
  themeQualifiedPlayers: number;
}

const AVATAR_BOX = 38;

interface DailyMarqueeProps {
  zoneId: number;
  view: DailyMarqueeView | null;
  /** Connected wallet base58; drives the "you" row. Omit on the landing. */
  address?: string | null;
  /** The gold slot: the one best next action, or CONNECT on the landing. */
  children: ReactNode;
}

/**
 * The marquee — the lobby's one card, identical on the landing and on Home so
 * connection never reflows the spectacle: guardian block over an opaque panel
 * with the realm and its objective, the pot, the entry window, two rows, and
 * the key slot.
 *
 * Two rows, not three. A podium of strangers answered no question a player has
 * and never showed them; the leader is the aspiration and your own row is the
 * only standing you can act on, so those are the two the lobby keeps. The full
 * board is one tap away in Arcade.
 */
const DailyMarquee: React.FC<DailyMarqueeProps> = ({
  zoneId,
  view,
  address = null,
  children,
}) => {
  const guardian = getZoneGuardian(zoneId);
  const entrySeconds = useCountdown(view?.runsCloseAt);
  const rows = view?.leaderboard ?? [];
  const owners = rows.map((entry) => entry.player);
  const emblems = useLeaderboardEmblems(owners);

  const myIndex = address
    ? rows.findIndex((entry) => entry.player.toBase58() === address)
    : -1;
  // What a place pays if the board froze now — the Score board, which is the
  // one the lobby's figures are quoted from.
  const payouts = view
    ? computeRankPayouts(
        dailyBoardPools(view.dailyPotLamports, view.themeQualifiedPlayers).score,
        view.scoreQualifiedPlayers,
      ).payouts
    : [];

  const row = (index: number, isYou: boolean) => {
    const entry = rows[index];
    if (!entry) return null;
    const rank = index + 1;
    const emblem = emblems.get(entry.player.toBase58());
    const tier = emblem?.featuredFrameTier ?? 0;
    const inner = tierFrameInnerSize(tier, AVATAR_BOX);
    const prize = payouts[index] ?? 0n;
    return (
      <div
        className={`flex items-center gap-2.5 px-2.5 py-1.5 ${
          isYou ? "rounded-xl" : ""
        }`}
        style={
          isYou
            ? {
                border: "1px solid #FACC15",
                background: "rgba(250,204,21,0.10)",
              }
            : undefined
        }
      >
        <span
          className="relative flex flex-none items-center justify-center"
          style={{ width: AVATAR_BOX, height: AVATAR_BOX }}
        >
          {emblem &&
          emblem.featuredEmblem >= 1 &&
          emblem.featuredEmblem <= 10 ? (
            <TierFrame tier={tier} size={inner}>
              <GuardianFaceBlock
                zoneId={emblem.featuredEmblem}
                size={inner}
                framed
              />
            </TierFrame>
          ) : (
            <span
              style={{
                width: AVATAR_BOX - 10,
                height: AVATAR_BOX - 10,
                borderRadius: "24%",
                background: "rgba(255,255,255,0.05)",
                boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.09)",
              }}
            />
          )}
          <RankBadge rank={rank} size={16} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left font-sans text-[13px] font-bold text-white/85">
          {isYou
            ? "You"
            : (entry.playerName ??
              playerLabelWithWallet(null, entry.player.toBase58()))}
        </span>
        {emblem && (
          <span
            className="flex-none font-sans text-[9px] font-bold uppercase tracking-[0.14em]"
            style={{ color: ladderTierColor(tier) }}
          >
            {ladderTierName(tier)}
          </span>
        )}
        <span className="font-mono text-[13px] font-bold tabular-nums text-white">
          {entry.dailyScore.toLocaleString()}
        </span>
        {prize > 0n && (
          <span
            className="flex w-[62px] flex-none items-center justify-end gap-1 font-mono text-[13px] font-bold tabular-nums"
            style={{ color: MONEY_GOLD }}
          >
            {formatSolBalanceLamports(prize)}
            <SolMark size={9} />
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      <div className="absolute -top-[52px] left-1/2 z-10 -translate-x-1/2">
        <GuardianFaceBlock zoneId={zoneId} size={104} breathe />
      </div>
      <div
        className="rounded-[26px] px-4 pb-4 pt-[62px] text-center"
        style={{
          background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
          border: "1px solid rgba(255,255,255,0.10)",
          boxShadow:
            "0 18px 44px rgba(0,0,0,0.5), inset 0 1.5px 0 rgba(255,255,255,0.09)",
        }}
      >
        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.24em] text-white/45">
          Daily arena
        </p>
        <h1 className="font-display text-[30px] leading-tight text-white">
          {guardian.name}
        </h1>
        {/* What today actually asks of you. Without it the realm name is a
            mood and the objective only appears once you are already inside. */}
        {view?.scoringRule && (
          <p className="font-mono text-[11px] font-semibold text-white/55">
            {dailyScoringRuleName(view.scoringRule)}
          </p>
        )}

        {view && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="mt-2 flex items-center justify-center gap-2.5">
              <span
                className="money font-display text-[52px] leading-none tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolBalanceLamports(view.dailyPotLamports)}
              </span>
              <SolMark size={26} />
            </div>
            <p className="mt-1.5 font-sans text-[10px] font-bold uppercase tracking-[0.24em] text-white/40">
              Today's pot
            </p>

            <div className="mt-2.5 flex items-center justify-center gap-2">
              <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-xs font-bold tabular-nums text-white">
                <Timer size={12} className="text-white/50" />
                {entrySeconds > 0
                  ? formatCountdown(entrySeconds)
                  : "Entries closed"}
              </span>
              <span className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-black/40 px-3 py-1.5 font-mono text-xs font-bold tabular-nums text-white">
                <Users size={12} className="text-white/50" />
                {view.uniquePlayers}
              </span>
            </div>

            {rows.length > 0 && (
              <div className="mt-3 space-y-1 rounded-2xl border border-white/[0.06] bg-black/30 p-1">
                {row(0, myIndex === 0)}
                {/* Your own standing, which is the only row you can change.
                    Absent until you enter, where the absence is the message. */}
                {address !== null &&
                  myIndex > 0 &&
                  row(myIndex, true)}
                {address !== null && myIndex < 0 && (
                  <p className="px-2.5 py-2 font-sans text-[12px] font-semibold text-white/45">
                    You are not in today's arena yet
                  </p>
                )}
              </div>
            )}
          </motion.div>
        )}

        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
};

export default DailyMarquee;
