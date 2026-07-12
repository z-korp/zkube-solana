/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useRebootProgress } from "@/solana/reboot/useRebootProgress";

export type ProgressController = ReturnType<typeof useRebootProgress>;

const ProgressContext = createContext<ProgressController | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const progress = useRebootProgress();
  return (
    <ProgressContext.Provider value={progress}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgressController(): ProgressController {
  const progress = useContext(ProgressContext);
  if (!progress) {
    throw new Error(
      "useProgressController must be used within ProgressProvider",
    );
  }
  return progress;
}
