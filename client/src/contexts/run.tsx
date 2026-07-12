/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useRunController } from "@/chain/useRunController";

export type RunController = ReturnType<typeof useRunController>;

const RunContext = createContext<RunController | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const run = useRunController();
  return <RunContext.Provider value={run}>{children}</RunContext.Provider>;
}

export function useRun(): RunController {
  const run = useContext(RunContext);
  if (!run) throw new Error("useRun must be used within RunProvider");
  return run;
}
