/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from "react";

import { useCampaignController } from "@/chain/useCampaignController";

export type CampaignController = ReturnType<typeof useCampaignController>;

const CampaignContext = createContext<CampaignController | null>(null);

export function CampaignProvider({ children }: { children: ReactNode }) {
  const campaign = useCampaignController();
  return (
    <CampaignContext.Provider value={campaign}>
      {children}
    </CampaignContext.Provider>
  );
}

export function useCampaign(): CampaignController {
  const campaign = useContext(CampaignContext);
  if (!campaign) {
    throw new Error(
      "useCampaign must be used within CampaignProvider",
    );
  }
  return campaign;
}
