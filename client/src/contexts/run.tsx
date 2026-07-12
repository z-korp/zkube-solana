/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useRebootRun } from "@/solana/reboot/useRebootRun";

export type RunController = ReturnType<typeof useRebootRun>;

const RunContext = createContext<RunController | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const run = useRebootRun();
  return <RunContext.Provider value={run}>{children}</RunContext.Provider>;
}

export function useRun(): RunController {
  const run = useContext(RunContext);
  if (!run) throw new Error("useRun must be used within RunProvider");
  return run;
}
