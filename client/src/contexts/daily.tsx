/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useRebootDaily } from "@/solana/reboot/useRebootDaily";

export type DailyController = ReturnType<typeof useRebootDaily>;

const DailyContext = createContext<DailyController | null>(null);

export function DailyProvider({ children }: { children: ReactNode }) {
  const daily = useRebootDaily();
  return (
    <DailyContext.Provider value={daily}>{children}</DailyContext.Provider>
  );
}

export function useDailyController(): DailyController {
  const daily = useContext(DailyContext);
  if (!daily) {
    throw new Error("useDailyController must be used within DailyProvider");
  }
  return daily;
}
