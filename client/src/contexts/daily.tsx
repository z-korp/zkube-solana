/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useDailyController } from "@/chain/useDailyController";

export type DailyController = ReturnType<typeof useDailyController>;

const DailyContext = createContext<DailyController | null>(null);

export function DailyProvider({ children }: { children: ReactNode }) {
  const daily = useDailyController();
  return (
    <DailyContext.Provider value={daily}>{children}</DailyContext.Provider>
  );
}

export function useDaily(): DailyController {
  const daily = useContext(DailyContext);
  if (!daily) {
    throw new Error("useDaily must be used within DailyProvider");
  }
  return daily;
}
