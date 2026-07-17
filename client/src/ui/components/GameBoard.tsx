import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronUp } from "lucide-react";
import Grid, { type GridProps, type OutcomeAnimation } from "./Grid";
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
  /** Terminal board show (win/lose) — see Grid's OutcomeAnimation. */
  outcomeAnimation?: OutcomeAnimation | null;
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
  outcomeAnimation = null,
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
  const effectiveTxProcessing = isTxProcessing || forceTxProcessing;
  const [nextLineHasBeenConsumed, setNextLineHasBeenConsumed] = useState(false);

  // The preview strip must not advance mid-cascade: the chain confirms a move
  // (and the authoritative `nextLine` prop flips to the FOLLOWING row) while
  // the cascade for the current one is still animating. Hold what the strip
  // displays in local state and gate prop-driven updates on "a receipt is in
  // flight"; the receipt path (Grid's applyReceipt → onNextLineUpdate, which
  // fires exactly at cascade end) is what advances it. Idle watcher/VRF
  // corrections and the terminal clear still flow through the prop effect.
  const [displayNextRow, setDisplayNextRow] = useState<number[]>(nextLine);
  const pendingReceiptAdvanceRef = useRef(false);
  const nextLineRef = useRef(nextLine);
  nextLineRef.current = nextLine;

  useEffect(() => {
    // New game/run: hard reset the held preview.
    pendingReceiptAdvanceRef.current = false;
    setDisplayNextRow(nextLineRef.current);
  }, [game.id]);

  useEffect(() => {
    if (pendingReceiptAdvanceRef.current) return;
    setDisplayNextRow(nextLine);
  }, [nextLine]);

  const handleNextLineUpdate = useCallback((row: number[]) => {
    pendingReceiptAdvanceRef.current = false;
    setDisplayNextRow(row);
  }, []);

  const handleMove: GridProps["onMove"] = useCallback(
    async (rowIndex: number, startIndex: number, finalIndex: number) => {
      pendingReceiptAdvanceRef.current = true;
      try {
        const receipt = await onMove(rowIndex, startIndex, finalIndex);
        // A void result means no receipt (and no onNextLineUpdate) is coming.
        if (!receipt) pendingReceiptAdvanceRef.current = false;
        return receipt;
      } catch (error) {
        pendingReceiptAdvanceRef.current = false;
        throw error;
      }
    },
    [onMove],
  );

  const handleBonus: GridProps["onBonus"] = useCallback(
    async (rowIndex: number, columnIndex: number) => {
      pendingReceiptAdvanceRef.current = true;
      try {
        const receipt = await onBonus(rowIndex, columnIndex);
        if (!receipt) pendingReceiptAdvanceRef.current = false;
        return receipt;
      } catch (error) {
        pendingReceiptAdvanceRef.current = false;
        throw error;
      }
    },
    [onBonus],
  );

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

  // Grid always receives the AUTHORITATIVE row (its idle-resync and the
  // ADD_LINE insert must track the chain); only the visible strip is held.
  const memoizedNextLineData = useMemo(() => {
    return transformDataContractIntoBlock([nextLine]);
  }, [nextLine]);

  const memoizedDisplayNextLine = useMemo(() => {
    return transformDataContractIntoBlock([displayNextRow]);
  }, [displayNextRow]);

  // Gate on the grid shape, not its occupancy: a perfect-clear terminal board
  // has zero blocks but must keep rendering the frame for the outcome show.
  if (initialGrid.length === 0) return null;

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
          outcomeAnimation={outcomeAnimation}
          onCascadeComplete={onCascadeComplete}
          onNextLineUpdate={handleNextLineUpdate}
          onMove={handleMove}
          onBonus={handleBonus}
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
            nextLineData={nextLineHasBeenConsumed ? [] : memoizedDisplayNextLine}
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
    </div>
  );
};

export default GameBoard;
