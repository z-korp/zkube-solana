import { useEffect, useRef } from "react";

import { useRun } from "@/contexts/run";
import { toDisplayGrid } from "@/solana/reboot/rebootGrid";
import useDeepMemo from "./useDeepMemo";

export const useGrid = (options: {
  gameId: bigint | undefined;
  shouldLog: boolean;
}): number[][] => {
  const run = useRun();
  const blocksRef = useRef<number[][]>([]);
  const blocks = useDeepMemo(
    () => (run.activeRun ? toDisplayGrid(run.activeRun.grid) : []),
    [run.activeRun?.grid],
  );

  useEffect(() => {
    if (blocks.length > 0) blocksRef.current = blocks;
  }, [blocks]);

  void options;
  return blocksRef.current;
};
