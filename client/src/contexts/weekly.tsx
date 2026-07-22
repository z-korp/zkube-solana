/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useWeeklyController } from "@/chain/useWeeklyController";

export type WeeklyController = ReturnType<typeof useWeeklyController>;

export const WeeklyContext = createContext<WeeklyController | null>(null);

export function WeeklyProvider({ children }: { children: ReactNode }) {
  const weekly = useWeeklyController();
  return <WeeklyContext.Provider value={weekly}>{children}</WeeklyContext.Provider>;
}

export function useWeekly(): WeeklyController {
  const weekly = useContext(WeeklyContext);
  if (!weekly) throw new Error("useWeekly must be used within WeeklyProvider");
  return weekly;
}
