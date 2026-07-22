/**
 * DEV-ONLY fixtures provider for the wallet-bypass harness (see devBypass.ts).
 *
 * Rendered by App only when `import.meta.env.DEV && DEV_BYPASS_ACTIVE`, it wraps
 * the page tree and re-provides the five contexts the menu screens read from —
 * ConnectedPlayer, Campaign, Daily, Weekly, Season — with fixture values that
 * override the real (empty, RPC-backed) providers stacked in main.tsx. The
 * `run` field of the Daily controller is passed through from the real
 * RunProvider (no live run exists without a wallet, so it reads as "none").
 */
import { useMemo, type ReactNode } from "react";

import { ConnectedPlayerContext } from "@/chain/connectedPlayerContext";
import { CampaignContext, type CampaignController } from "@/contexts/campaign";
import { DailyContext, type DailyController } from "@/contexts/daily";
import { SeasonContext, type SeasonController } from "@/contexts/season";
import { WeeklyContext, type WeeklyController } from "@/contexts/weekly";
import { useRun } from "@/contexts/run";
import {
  buildDevCampaignView,
  buildDevConnectedPlayer,
  buildDevDailyView,
  buildDevSeasonView,
  buildDevWeeklyView,
} from "./fixtures";

const NO_REAL_RUN = "Dev bypass does not start real runs";

export function DevFixturesProvider({ children }: { children: ReactNode }) {
  const run = useRun();

  const connectedPlayer = useMemo(() => buildDevConnectedPlayer(), []);

  const daily = useMemo<DailyController>(() => {
    const view = buildDevDailyView();
    return {
      daily: view,
      practiceDaily: null,
      practiceAvailable: false,
      loading: false,
      action: null,
      error: null,
      refresh: async () => view,
      maintain: async () => view,
      enter: async () => {
        throw new Error(NO_REAL_RUN);
      },
      practice: async () => {
        throw new Error(NO_REAL_RUN);
      },
      run,
    };
  }, [run]);

  const weekly = useMemo<WeeklyController>(() => {
    const view = buildDevWeeklyView();
    return { weekly: view, loading: false, error: null, refresh: async () => view };
  }, []);

  const season = useMemo<SeasonController>(() => {
    const view = buildDevSeasonView();
    return { season: view, loading: false, error: null, refresh: async () => view };
  }, []);

  const campaign = useMemo<CampaignController>(() => {
    const view = buildDevCampaignView();
    return {
      campaign: view,
      loading: false,
      loaded: true,
      error: null,
      refresh: async () => view,
    };
  }, []);

  return (
    <ConnectedPlayerContext.Provider value={connectedPlayer}>
      <CampaignContext.Provider value={campaign}>
        <DailyContext.Provider value={daily}>
          <WeeklyContext.Provider value={weekly}>
            <SeasonContext.Provider value={season}>
              {children}
            </SeasonContext.Provider>
          </WeeklyContext.Provider>
        </DailyContext.Provider>
      </CampaignContext.Provider>
    </ConnectedPlayerContext.Provider>
  );
}
