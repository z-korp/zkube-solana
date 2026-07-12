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
  const projectedBlocks = useDeepMemo(
    () => (run.activeRun ? toDisplayGrid(run.activeRun.grid) : []),
    [run.activeRun?.grid],
  );
  const runId = run.activeRun?.runId ?? null;
  const terminal = useMemo(
    () =>
      run.activeRun?.lifecycle === "levelComplete" ||
      run.activeRun?.lifecycle === "finished" ||
      run.activeRun?.lifecycle === "settled",
    [run.activeRun?.lifecycle],
  );

  useEffect(() => {
    if (!run.activeRun || runId === null) {
      runIdRef.current = null;
      setBlocks([]);
      return;
    }

    // A new (or directly resumed) run must hydrate even when its first
    // observed projection is already terminal.
    if (runIdRef.current !== runId) {
      runIdRef.current = runId;
      setBlocks(projectedBlocks);
      return;
    }

    // Preserve the last playable board while terminal settlement progresses.
    // The receipt projection and terminal snapshot own the frozen result; a
    // watcher refresh must not replace it underneath completion animations.
    if (terminal) return;

    setBlocks(projectedBlocks);
  }, [projectedBlocks, run.activeRun, runId, terminal]);

  void options;
  return blocks;
};
