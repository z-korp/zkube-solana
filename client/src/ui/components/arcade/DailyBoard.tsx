import { Fragment, useState } from "react";

import type { ClientDailyView } from "@/backend/client";
import { ladderTierColor, ladderTierName } from "@/config/ladderTiers";
import { tierFrameInnerSize } from "@/config/tierFrames";
import { PaidCutLine, RankBadge } from "@/ui/components/arena/LeaderboardRow";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import {
  GuardianFaceBlock,
  MONEY_GOLD,
  SolMark,
  TierFrame,
} from "@/ui/components/economy";
import { formatSolBalanceLamports } from "@/utils/currency";
import { MONEY_SURFACE_SENTINEL } from "@/ui/moneySurface";

const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};

const YOU_RING: React.CSSProperties = {
  border: "1px solid #FACC15",
  background: "rgba(250,204,21,0.10)",
  boxShadow: "0 0 12px rgba(250,204,21,0.25)",
};

/** Every row's avatar slot, ornament included, so the column stays straight. */
const AVATAR_BOX = 46;

interface DailyBoardProps {
  view: ClientDailyView;
  /** Connected wallet base58, for the gold ring and your below-cut row. */
  address: string | null;
  initialBoard?: "score" | "theme";
}

/**
 * The prize ladder IS the leaderboard: every rung priced from the live pot
 * whether or not anyone holds it. Nothing renders below the prize zone except
 * the connected player's own row when they sit outside it, so they always know
 * where they stand. The percentage split lives in the ? popup.
 *
 * Four things per row and no column headings: a medal, a face, a number and a
 * gold SOL amount need no labels, and the labels were crowding the title.
 *
 * Every row wears the border and guardian its player chose, which is the whole
 * point of earning either — the ladder pays no SOL, so a board is the only
 * place a rank can mean anything. The tier is named beside the wallet as well,
 * because an ornament is not readable at row height on its own.
 */
const DailyBoard: React.FC<DailyBoardProps> = ({
  view,
  address,
  initialBoard = "score",
}) => {
  const [board, setBoard] = useState<"score" | "theme">(initialBoard);
  const state = view.boards.find((candidate) => candidate.kind === board);
  const paidRows = state?.rows ?? [];
  const hasSeparateYourRow = Boolean(
    state?.yourRow &&
    !paidRows.some((entry) => entry.address === state.yourRow?.address),
  );
  const rows = hasSeparateYourRow ? [...paidRows, state!.yourRow!] : paidRows;
  const myIndex = address
    ? rows.findIndex((entry) => entry.address === address)
    : -1;

  const rowFor = (index: number, withDivider: boolean) => {
    const entry = rows[index];
    const rank = entry?.rank ?? index + 1;
    const isYou = index === myIndex;
    const prize = entry?.payoutLamports ?? 0n;
    const tier = entry?.tier ?? 0;
    const inner = tierFrameInnerSize(tier, AVATAR_BOX);
    return (
      <div
        key={rank}
        className={`flex items-center gap-2.5 px-2 py-1.5 ${
          isYou
            ? "rounded-xl"
            : withDivider
              ? "border-t border-white/[0.05]"
              : ""
        }`}
        style={isYou ? YOU_RING : undefined}
      >
        <span
          className="relative flex flex-none items-center justify-center"
          style={{ width: AVATAR_BOX, height: AVATAR_BOX }}
        >
          {entry?.emblem ? (
            <TierFrame tier={tier} size={inner}>
              {entry.emblem >= 1 && entry.emblem <= 10 ? (
                <GuardianFaceBlock zoneId={entry.emblem} size={inner} framed />
              ) : (
                <span
                  style={{
                    width: inner,
                    height: inner,
                    borderRadius: "22%",
                    background: "rgba(4,7,15,0.75)",
                  }}
                />
              )}
            </TierFrame>
          ) : (
            // No resolved profile: a neutral seat rather than a borrowed
            // border, which would claim a rank this player may not hold.
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
          <RankBadge rank={rank} />
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 truncate text-left font-sans text-[15px] font-bold text-white/90">
            {isYou
              ? "You"
              : entry
                ? playerLabelWithWallet(entry.label ?? null, entry.address)
                : "—"}
          </span>
          {entry?.tier !== undefined && (
            <span
              className="font-sans text-[9px] font-bold uppercase tracking-[0.14em]"
              style={{ color: ladderTierColor(tier) }}
            >
              {ladderTierName(tier)}
            </span>
          )}
        </span>

        <span className="w-[68px] flex-none text-right font-mono text-[15px] font-bold tabular-nums text-white">
          {entry ? entry.metric.toLocaleString() : ""}
        </span>
        <span className="flex w-[72px] flex-none items-center justify-end gap-1">
          {prize > 0n && (
            <span
              className="money flex items-center gap-1 font-mono text-[15px] font-bold tabular-nums"
              style={{ color: MONEY_GOLD }}
            >
              {formatSolBalanceLamports(prize)}
              <SolMark size={10} />
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <section
      className="rounded-2xl p-3.5"
      style={PANEL_STYLE}
      data-zkube-money-surface={MONEY_SURFACE_SENTINEL}
    >
      <div className="flex items-center justify-between">
        <p className="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
          Leaderboard
        </p>
        <div className="flex rounded-lg bg-black/30 p-0.5 text-[10px] font-bold uppercase">
          {(["score", "theme"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`rounded-md px-2 py-1 ${board === kind ? "bg-white/15 text-white" : "text-white/40"}`}
              onClick={() => setBoard(kind)}
            >
              {kind}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2.5">
        {Array.from({ length: paidRows.length }, (_, index) =>
          rowFor(index, index > 0),
        )}

        {hasSeparateYourRow && (
          <Fragment>
            <PaidCutLine />
            {rowFor(paidRows.length, false)}
          </Fragment>
        )}
      </div>

      {paidRows.length === 0 && !hasSeparateYourRow && (
        <p className="mt-1 border-t border-white/[0.05] px-2 pt-2 text-center font-sans text-xs font-semibold text-white/50">
          No entries yet — rank 1 is open.
        </p>
      )}
    </section>
  );
};

export default DailyBoard;
