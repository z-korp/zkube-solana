/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useSeasonController } from "@/chain/useSeasonController";

export type SeasonController = ReturnType<typeof useSeasonController>;

export const SeasonContext = createContext<SeasonController | null>(null);

export function SeasonProvider({ children }: { children: ReactNode }) {
  const season = useSeasonController();
  return (
    <SeasonContext.Provider value={season}>{children}</SeasonContext.Provider>
  );
}

export function useSeason(): SeasonController {
  const season = useContext(SeasonContext);
  if (!season) throw new Error("useSeason must be used within SeasonProvider");
  return season;
}
