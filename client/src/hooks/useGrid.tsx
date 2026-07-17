import { useEffect, useMemo, useRef, useState } from "react";

import { useRun } from "@/contexts/run";
import { toDisplayGrid } from "@/chain/gridProjection";
import useDeepMemo from "./useDeepMemo";

export const useGrid = (options: {
  gameId: bigint | undefined;
  shouldLog: boolean;
}): number[][] => {
  const run = useRun();
  const [blocks, setBlocks] = useState<number[][]>([]);
  const runIdRef = useRef<bigint | null>(null);
  const frozenTerminalRunRef = useRef<bigint | null>(null);
  const projectedBlocks = useDeepMemo(
    () => (run.activeRun ? toDisplayGrid(run.activeRun.grid) : []),
    [run.activeRun?.grid],
  );
  const runId = run.activeRun?.runId ?? null;
  const terminal = useMemo(
    () =>
      run.activeRun?.lifecycle === "levelComplete" ||
      run.activeRun?.lifecycle === "finished",
    [run.activeRun?.lifecycle],
  );

  useEffect(() => {
    if (!run.activeRun || runId === null) {
      runIdRef.current = null;
      frozenTerminalRunRef.current = null;
      setBlocks([]);
      return;
    }

    // A new (or directly resumed) run must hydrate even when its first
    // observed projection is already terminal.
    if (runIdRef.current !== runId) {
      runIdRef.current = runId;
      frozenTerminalRunRef.current = terminal ? runId : null;
      setBlocks(projectedBlocks);
      return;
    }

    // Adopt the projection that carries the terminal lifecycle — it IS the
    // final board (playMove/applyBonus commit grid + lifecycle in one update).
    // Then freeze: a later watcher refresh must not replace the frozen result
    // underneath completion animations.
    if (terminal) {
      if (frozenTerminalRunRef.current === runId) return;
      frozenTerminalRunRef.current = runId;
      setBlocks(projectedBlocks);
      return;
    }

    frozenTerminalRunRef.current = null;
    setBlocks(projectedBlocks);
  }, [projectedBlocks, run.activeRun, runId, terminal]);

  void options;
  return blocks;
};
