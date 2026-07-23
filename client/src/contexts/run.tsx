/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useRunController } from "@/chain/useRunController";
import { useNavigationStore } from "@/stores/navigationStore";

export type SlotRunController = ReturnType<typeof useRunController>;
export type RunController = SlotRunController & {
  campaign: SlotRunController;
  arcade: SlotRunController;
};

const RunContext = createContext<RunController | null>(null);

export function RunProvider({ children }: { children: ReactNode }) {
  const campaign = useRunController("campaign");
  const arcade = useRunController("arcade");
  const currentPage = useNavigationStore((state) => state.currentPage);
  const previousPage = useNavigationStore((state) => state.previousPage);
  const gameId = useNavigationStore((state) => state.gameId);
  const recoveryRunId = useNavigationStore((state) => state.recoveryRunId);
  const selectedRunId = gameId ?? recoveryRunId;

  const run = useMemo<RunController>(() => {
    const campaignOwnsSelectedRun =
      selectedRunId !== null &&
      (campaign.activeRun?.runId === selectedRunId ||
        campaign.receipt?.runId === selectedRunId);
    const arcadeOwnsSelectedRun =
      selectedRunId !== null &&
      (arcade.activeRun?.runId === selectedRunId ||
        arcade.receipt?.runId === selectedRunId);
    const selected =
      campaignOwnsSelectedRun ||
      (!arcadeOwnsSelectedRun &&
        (currentPage === "campaign" ||
          currentPage === "map" ||
          (currentPage === "play" &&
            (previousPage === "campaign" || previousPage === "map"))))
        ? campaign
        : arcade;
    return { ...selected, campaign, arcade };
  }, [
    arcade,
    campaign,
    currentPage,
    previousPage,
    selectedRunId,
  ]);
  return <RunContext.Provider value={run}>{children}</RunContext.Provider>;
}

export function useRun(): RunController {
  const run = useContext(RunContext);
  if (!run) throw new Error("useRun must be used within RunProvider");
  return run;
}
