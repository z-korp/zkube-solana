import type { ReactNode } from "react";
import { Timer, Users } from "lucide-react";
import { motion } from "motion/react";

import type { DailyLeaderboardView } from "@/chain/dailyClient";
import { getZoneGuardian } from "@/config/bossCharacters";
import {
  GuardianFaceBlock,
  MONEY_GOLD,
  SolMark,
} from "@/ui/components/economy";
import { useCountdown } from "@/hooks/useNowTick";
import { formatSolBalanceLamports } from "@/utils/currency";
import { truncatePublicKey } from "@/utils/solanaDisplay";
import { formatCountdown } from "@/utils/time";

/** The public face of today's Daily — every field readable without a wallet. */
export interface DailyMarqueeView {
  dailyPotLamports: bigint;
  entriesCloseAt: number;
  uniquePlayers: number;
  leaderboard: readonly DailyLeaderboardView[];
}

const MEDAL_COLORS = ["#FACC15", "#C9D6E4", "#E2955C"] as const;

interface DailyMarqueeProps {
  zoneId: number;
  view: DailyMarqueeView | null;
  /** The gold slot: PLAY when connected, CONNECT WALLET on the landing. */
  children: ReactNode;
}

/**
 * The marquee — the lobby's one card, identical on the landing and on Home so
 * connection never reflows the spectacle: guardian block over an opaque panel
 * with the pot, the entry window, the live podium, and the key slot.
 */
const DailyMarquee: React.FC<DailyMarqueeProps> = ({
  zoneId,
  view,
  children,
}) => {
  const guardian = getZoneGuardian(zoneId);
  const entrySeconds = useCountdown(view?.entriesCloseAt);
  const podium = view?.leaderboard.slice(0, 3) ?? [];

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

        {view && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="mt-1 flex items-center justify-center gap-2.5">
              <SolMark size={26} />
              <span
                className="money font-display text-[52px] leading-none tabular-nums"
                style={{ color: MONEY_GOLD }}
              >
                {formatSolBalanceLamports(view.dailyPotLamports)}
              </span>
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

            {podium.length > 0 && (
              <div className="mt-3 space-y-px overflow-hidden rounded-2xl border border-white/[0.06] bg-black/30">
                {podium.map((entry, index) => (
                  <div
                    key={entry.player.toBase58()}
                    className="flex items-center gap-2.5 px-3 py-[7px]"
                  >
                    <span
                      className="flex h-5 w-5 flex-none items-center justify-center rounded-md font-mono text-[10px] font-black text-[#181205]"
                      style={{
                        background: MEDAL_COLORS[index],
                        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                      }}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-left font-sans text-[13px] font-bold text-white/85">
                      {entry.playerName ??
                        truncatePublicKey(entry.player.toBase58())}
                    </span>
                    <span className="font-mono text-[13px] font-bold tabular-nums text-white">
                      {entry.dailyScore}
                    </span>
                  </div>
                ))}
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
