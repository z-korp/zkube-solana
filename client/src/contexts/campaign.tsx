/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useRebootCampaign } from "@/solana/reboot/useRebootCampaign";

export type CampaignController = ReturnType<typeof useRebootCampaign>;

const CampaignContext = createContext<CampaignController | null>(null);

export function CampaignProvider({ children }: { children: ReactNode }) {
  const campaign = useRebootCampaign();
  return (
    <CampaignContext.Provider value={campaign}>
      {children}
    </CampaignContext.Provider>
  );
}

export function useCampaignController(): CampaignController {
  const campaign = useContext(CampaignContext);
  if (!campaign) {
    throw new Error(
      "useCampaignController must be used within CampaignProvider",
    );
  }
  return campaign;
}
