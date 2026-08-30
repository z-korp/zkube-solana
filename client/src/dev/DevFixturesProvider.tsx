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
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { ConnectedPlayerContext } from "@/chain/connectedPlayerContext";
import { CampaignContext, type CampaignController } from "@/contexts/campaign";
import { DailyContext, type DailyController } from "@/contexts/daily";
import { RunContext, useRun, type RunController } from "@/contexts/run";
import {
  buildDevActiveRun,
  playDevBonus,
  playDevMove,
  playDevReroll,
} from "./devBoard";
import { devBoardModeFromUrl } from "./devBypass";
import {
  buildDevCampaignView,
  buildDevConnectedPlayer,
  buildDevDailyView,
  DEV_PLAYER_PUBLIC_KEY,
} from "./fixtures";

const NO_REAL_RUN = "Dev bypass does not start real runs";

/**
 * The staged board, when `&board=` asks for one, advances through the exact
 * browser core boundary used by connected runs.
 */
function useDevRunController(realRun: RunController): RunController {
  const mode = useMemo(() => devBoardModeFromUrl(), []);
  const [activeRun, setActiveRun] = useState(() =>
    mode ? buildDevActiveRun(mode, DEV_PLAYER_PUBLIC_KEY) : null,
  );
  const activeRunRef = useRef(activeRun);
  const apply = useCallback(
    (
      transition: (
        run: NonNullable<typeof activeRun>,
      ) => NonNullable<typeof activeRun>,
    ) => {
      const current = activeRunRef.current;
      if (!current) return Promise.reject(new Error(NO_REAL_RUN));
      try {
        const next = transition(current);
        activeRunRef.current = next;
        setActiveRun(next);
        return Promise.resolve(next);
      } catch (error) {
        return Promise.reject(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    },
    [],
  );
  return useMemo(() => {
    if (!mode || !activeRun) return realRun;
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
      playMove: (row, start, destination) =>
        apply((run) => playDevMove(run, row, start, destination)),
      applyBonus: (row, column) =>
        apply((run) => playDevBonus(run, row, column)),
      requestReroll: () => apply(playDevReroll),
      settleAndAdvance: reject,
      abandonRun: reject,
    };
    return { ...slot, campaign: slot, arcade: slot };
  }, [activeRun, apply, mode, realRun]);
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
