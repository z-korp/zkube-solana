import React from "react";
import type { ThemeColors } from "@/config/themes";

export interface RankContextEntry {
  rank: number;
  score: number;
  name: string;
}

interface TierContextProps {
  colors: ThemeColors;
  myRank: number | null;
  myScore: number;
  myName?: string;
  entries: RankContextEntry[];
  scoreLabel?: string;
}

/**
 * Keeps the compact position card while using adjacent live leaderboard rows.
 * Daily standings feed the Weekly points and reward calculation on-chain.
 */
const TierContext: React.FC<TierContextProps> = ({
  colors,
  myRank,
  myScore,
  myName = "You",
  entries,
  scoreLabel = "",
}) => {
  if (!myRank || entries.length === 0) return null;

  const sorted = [...entries].sort((left, right) => left.rank - right.rank);
  const above = sorted.find((entry) => entry.rank === myRank - 1) ?? null;
  const below = sorted.find((entry) => entry.rank === myRank + 1) ?? null;

  return (
    <div
      className="rounded-2xl border px-3 py-2.5 backdrop-blur-xl"
      style={{
        background: "rgba(255,255,255,0.06)",
        borderColor: "rgba(255,255,255,0.12)",
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <p
          className="font-sans text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: colors.textMuted }}
        >
          Your Position
        </p>
        <span className="font-sans text-[10px] font-semibold text-white/35">
          Daily rank #{myRank}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {above && <ContextRow entry={above} scoreLabel={scoreLabel} />}

        <div
          className="flex items-center justify-between rounded-lg px-2.5 py-2"
          style={{
            background: `${colors.accent}20`,
            border: `1px solid ${colors.accent}50`,
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="w-6 shrink-0 text-center font-sans text-[12px] font-black"
              style={{ color: colors.accent }}
            >
              #{myRank}
            </span>
            <span
              className="truncate font-sans text-[12px] font-bold"
              style={{ color: colors.text }}
            >
              {myName}
            </span>
          </div>
          <span
            className="shrink-0 font-sans text-[12px] font-black"
            style={{ color: colors.accent }}
          >
            {myScore.toLocaleString()}
            {scoreLabel}
          </span>
        </div>

        {below && <ContextRow entry={below} scoreLabel={scoreLabel} />}
      </div>
    </div>
  );
};

function ContextRow({
  entry,
  scoreLabel,
}: {
  entry: RankContextEntry;
  scoreLabel: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-6 shrink-0 text-center font-sans text-[11px] font-bold text-white/30">
          #{entry.rank}
        </span>
        <span className="truncate font-sans text-[11px] font-semibold text-white/40">
          {entry.name}
        </span>
      </div>
      <span className="shrink-0 font-sans text-[11px] font-bold text-white/30">
        {entry.score.toLocaleString()}
        {scoreLabel}
      </span>
    </div>
  );
}

export default TierContext;
