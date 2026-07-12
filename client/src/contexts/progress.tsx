/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useProgressController } from "@/chain/useProgressController";

export type ProgressController = ReturnType<typeof useProgressController>;

const ProgressContext = createContext<ProgressController | null>(null);

export function ProgressProvider({ children }: { children: ReactNode }) {
  const progress = useProgressController();
  return (
    <ProgressContext.Provider value={progress}>
      {children}
    </ProgressContext.Provider>
  );
}

export function useProgress(): ProgressController {
  const progress = useContext(ProgressContext);
  if (!progress) {
    throw new Error(
      "useProgress must be used within ProgressProvider",
    );
  }
  return progress;
}
