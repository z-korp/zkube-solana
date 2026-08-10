/**
 * DEV-ONLY fixtures provider for the wallet-bypass harness (see devBypass.ts).
 *
 * Rendered by App only when `import.meta.env.DEV && DEV_BYPASS_ACTIVE`, it wraps
 * the page tree and re-provides the five contexts the menu screens read from —
 * ConnectedPlayer, Campaign, and Daily — with fixture values that
 * override the real (empty, RPC-backed) providers stacked in main.tsx. The
 * `run` field of the Daily controller is passed through from the real
 * RunProvider (no live run exists without a wallet, so it reads as "none").
 */
import { useMemo, type ReactNode } from "react";

import { ConnectedPlayerContext } from "@/chain/connectedPlayerContext";
import { CampaignContext, type CampaignController } from "@/contexts/campaign";
import { DailyContext, type DailyController } from "@/contexts/daily";
import { RunContext, useRun, type RunController } from "@/contexts/run";
import { buildDevActiveRun } from "./devBoard";
import { devBoardModeFromUrl } from "./devBypass";
import {
  buildDevCampaignView,
  buildDevConnectedPlayer,
  buildDevDailyView,
  DEV_PLAYER_PUBLIC_KEY,
} from "./fixtures";

const NO_REAL_RUN = "Dev bypass does not start real runs";

/**
 * The staged board, when `&board=` asked for one.
 *
 * Every action rejects rather than pretending: the harness renders an
 * authoritative snapshot so the surface can be judged, and a move that appeared
 * to work would be the client simulating the game — the one thing the board is
 * never allowed to do.
 */
function useDevRunController(realRun: RunController): RunController {
  const mode = useMemo(() => devBoardModeFromUrl(), []);
  return useMemo(() => {
    if (!mode) return realRun;
    const activeRun = buildDevActiveRun(mode, DEV_PLAYER_PUBLIC_KEY);
    const reject = async () => {
      throw new Error(NO_REAL_RUN);
    };
    const slot: RunController["campaign"] = {
      ...realRun.campaign,
      activeRun,
      receipt: null,
      phase: "delegated",
      watchStatus: null,
      busy: false,
      error: null,
      lastSignature: null,
      // Input is gated on an authorized session, so the staged board must
      // carry one or it renders permanently locked.
      sessionAuthorized: true,
      settleStage: null,
      connected: true,
      publicKey: DEV_PLAYER_PUBLIC_KEY,
      playMove: reject,
      applyBonus: reject,
      settleAndAdvance: reject,
      abandonRun: reject,
    };
    return { ...slot, campaign: slot, arcade: slot };
  }, [mode, realRun]);
}

export function DevFixturesProvider({ children }: { children: ReactNode }) {
  const realRun = useRun();
  const run = useDevRunController(realRun);

  const connectedPlayer = useMemo(() => buildDevConnectedPlayer(), []);

  const daily = useMemo<DailyController>(() => {
    const view = buildDevDailyView();
    return {
      daily: view,
      loading: false,
      action: null,
      error: null,
      refresh: async () => view,
      maintain: async () => view,
      enter: async () => {
        throw new Error(NO_REAL_RUN);
      },
      buyKredits: async () => {
        throw new Error(NO_REAL_RUN);
      },
      run,
    };
  }, [run]);

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
      <RunContext.Provider value={run}>
        <CampaignContext.Provider value={campaign}>
          <DailyContext.Provider value={daily}>
            {children}
          </DailyContext.Provider>
        </CampaignContext.Provider>
      </RunContext.Provider>
    </ConnectedPlayerContext.Provider>
  );
}
