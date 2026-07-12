import React, { useState, useEffect, useMemo, useRef } from "react";
import { ChevronUp } from "lucide-react";
import Grid, { type GridProps } from "./Grid";
import { transformDataContractIntoBlock } from "@/utils/gridUtils";
import NextLine from "./NextLine";
import { BonusType } from "@/chain/bonusTypes";
import { Game } from "@/game/model";

import "../../grid.css";

interface GameBoardProps {
  initialGrid: number[][];
  nextLine: number[];
  game: Game;
  activeBonus: BonusType;
  bonusDescription: string;
  onCascadeComplete?: () => void;
  forceTxProcessing?: boolean;
  /**
   * True while the on-chain level is transitioning. PlayScreen owns the
   * computation; we OR it into effectiveTxProcessing so the grid stays locked
   * until the authoritative snapshot catches up and the level-complete
   * navigation fires.
   */
  levelTransitionPending: boolean;
  onMove: GridProps["onMove"];
  onBonus: GridProps["onBonus"];
}

const GameBoard: React.FC<GameBoardProps> = ({
  initialGrid,
  nextLine,
  game,
  activeBonus,
  bonusDescription,
  onCascadeComplete,
  forceTxProcessing = false,
  levelTransitionPending,
  onMove,
  onBonus,
}) => {
  const ROWS = 10;
  const COLS = 8;
  const NEXT_LINE_ROWS = 1;
  const HORIZONTAL_PADDING = 24;
  const VERTICAL_CHROME = 36;
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridSize, setGridSize] = useState(40);

  const [isTxProcessing, setIsTxProcessing] = useState(false);
  const effectiveTxProcessing =
    isTxProcessing || forceTxProcessing || levelTransitionPending;
  const [nextLineHasBeenConsumed, setNextLineHasBeenConsumed] = useState(false);
  const [nextLineOverride, setNextLineOverride] = useState<number[] | null>(
    null,
  );

  // Receipt projection updates the preview before provider state necessarily
  // re-renders. Once the authoritative run prop advances, release that local
  // bridge so watcher/VRF reconciliation can keep correcting the next row.
  useEffect(() => {
    setNextLineOverride(null);
  }, [game.id, nextLine]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      const h = entry.contentRect.height;
      const safeWidth = Math.max(1, w - HORIZONTAL_PADDING);
      const safeHeight = Math.max(1, h - VERTICAL_CHROME);
      const cellByWidth = Math.floor(safeWidth / COLS);
      const cellByHeight = Math.floor(safeHeight / (ROWS + NEXT_LINE_ROWS));
      const cellSize = Math.min(cellByWidth, cellByHeight);
      setGridSize(Math.max(28, Math.min(cellSize, 72)));
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const memoizedInitialData = useMemo(() => {
    return transformDataContractIntoBlock(initialGrid);
  }, [initialGrid]);

  const memoizedNextLineData = useMemo(() => {
    return transformDataContractIntoBlock([nextLineOverride ?? nextLine]);
  }, [nextLine, nextLineOverride]);

  if (memoizedInitialData.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className={`relative flex h-full min-h-0 w-full flex-col p-2 md:p-3 ${
        effectiveTxProcessing ? "cursor-wait" : ""
      }`}
    >
      <div
        className={`flex min-h-0 flex-1 flex-col items-center ${!effectiveTxProcessing ? "cursor-move" : ""}`}
      >
        <Grid
          gameId={game.id}
          initialData={memoizedInitialData}
          nextLineData={memoizedNextLineData}
          setNextLineHasBeenConsumed={setNextLineHasBeenConsumed}
          gridSize={gridSize}
          gridHeight={ROWS}
          gridWidth={COLS}
          bonus={activeBonus}
          isTxProcessing={effectiveTxProcessing}
          setIsTxProcessing={setIsTxProcessing}
          levelTransitionPending={levelTransitionPending}
          onCascadeComplete={onCascadeComplete}
          onNextLineUpdate={setNextLineOverride}
          onMove={onMove}
          onBonus={onBonus}
        />
        <div className="mt-1 flex items-center justify-center gap-1 py-0.5">
          <div className="chevron-pulse">
            <ChevronUp size={14} className="text-white/50" />
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">
            Next Row
          </span>
        </div>
        <div>
          <NextLine
            nextLineData={nextLineHasBeenConsumed ? [] : memoizedNextLineData}
            gridSize={gridSize}
            gridHeight={1}
            gridWidth={COLS}
          />
        </div>
      </div>

      {activeBonus !== BonusType.None && (
        <div className="absolute inset-x-0 top-1/2 flex justify-center pointer-events-none z-50">
          <div className="text-yellow-500 px-3 py-1.5 rounded font-bold text-sm bg-black/70 whitespace-nowrap">
            {bonusDescription}
          </div>
        </div>
      )}

      {/* Chain-sync indicator: the move/bonus is confirming on MagicBlock. */}
      {effectiveTxProcessing && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-start justify-center pt-3">
          <div className="flex items-center gap-2 rounded-full bg-black/70 px-4 py-1.5 backdrop-blur-sm">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-white/80">
              Syncing…
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default GameBoard;
