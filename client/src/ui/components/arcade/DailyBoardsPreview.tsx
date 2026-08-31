import type { ClientDailyView } from "@/backend/client";
import type { BoardKind, BoardState } from "@/backend/views";
import { playerLabelWithWallet } from "@/ui/components/arena/leaderboardName";
import { MONEY_GOLD, SolMark } from "@/ui/components/economy";
import { formatSolBalanceLamports } from "@/utils/currency";
import { boardPreviewRows } from "./dailyBoardPreview";

const PANEL_STYLE: React.CSSProperties = {
  background: "linear-gradient(180deg, #131F35 0%, #0D1626 100%)",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow:
    "0 12px 30px rgba(0,0,0,0.4), inset 0 1.5px 0 rgba(255,255,255,0.09)",
};

interface DailyBoardsPreviewProps {
  view: ClientDailyView;
  address: string | null;
}

const BoardColumn: React.FC<{
  kind: BoardKind;
  state: BoardState | undefined;
  address: string | null;
}> = ({ kind, state, address }) => {
  const rows = boardPreviewRows(state, address);
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between border-b border-white/[0.08] pb-2">
        <h3 className="font-sans text-[11px] font-extrabold uppercase tracking-[0.16em] text-white/80">
          {kind}
        </h3>
        <span className="font-sans text-[8px] font-bold uppercase tracking-[0.12em] text-white/35">
          Rank · points
        </span>
      </div>
      <div className="mt-1.5 space-y-1">
        {rows.map(({ row, isYou, separated }) => (
          <div
            key={`${row.address}:${row.rank}`}
            className={`grid grid-cols-[22px_minmax(0,1fr)] gap-x-1 rounded-lg px-1.5 py-1.5 ${
              isYou
                ? "border border-yellow-300/50 bg-yellow-300/10"
                : "bg-black/20"
            } ${separated ? "mt-2" : ""}`}
          >
            <span className="row-span-2 font-mono text-[11px] font-black tabular-nums text-white/55">
              #{row.rank}
            </span>
            <span className="truncate font-sans text-[10px] font-bold text-white/85">
              {isYou
                ? "You"
                : playerLabelWithWallet(row.label ?? null, row.address)}
            </span>
            <span className="flex min-w-0 items-center justify-between gap-1">
              <span className="truncate font-mono text-[10px] font-bold tabular-nums text-cyan-100/80">
                {row.metric.toLocaleString()}
              </span>
              {row.payoutLamports > 0n && (
                <span
                  className="money flex items-center gap-0.5 font-mono text-[9px] font-bold tabular-nums"
                  style={{ color: MONEY_GOLD }}
                >
                  {formatSolBalanceLamports(row.payoutLamports)}
                  <SolMark size={7} />
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="py-4 text-center font-sans text-[10px] font-semibold text-white/40">
          Rank 1 is open
        </p>
      )}
    </div>
  );
};

/** Score and Theme stay visible together so the same run's two races compare. */
const DailyBoardsPreview: React.FC<DailyBoardsPreviewProps> = ({
  view,
  address,
}) => (
  <section className="rounded-2xl p-3.5" style={PANEL_STYLE}>
    <p className="font-sans text-[10px] font-bold uppercase tracking-[0.22em] text-white/45">
      Today's boards
    </p>
    <div className="mt-2.5 flex gap-2.5">
      <BoardColumn
        kind="score"
        state={view.boards.find((board) => board.kind === "score")}
        address={address}
      />
      <div className="w-px flex-none bg-white/[0.08]" />
      <BoardColumn
        kind="theme"
        state={view.boards.find((board) => board.kind === "theme")}
        address={address}
      />
    </div>
  </section>
);

export default DailyBoardsPreview;
