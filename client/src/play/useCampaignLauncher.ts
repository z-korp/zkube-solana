import { useCallback, useRef, useState } from "react";

import { useRun } from "@/contexts/run";
import { useNavigationStore } from "@/stores/navigationStore";
import { showToast } from "@/utils/toast";
import { describeRunStartError } from "@/play/usePlayController";

/**
 * In-place campaign run launch, mirroring the Daily flow: the run is created
 * while the player is still looking at the level's constraints (Map preview /
 * boss reveal), and navigation to the play screen happens only once the run is
 * delegated and hydrated. Failures keep the player where they are with a
 * toast; a launch that timed out after the base delegate committed is healed
 * by the run watcher, surfacing through the existing "playing node" / resume
 * affordances.
 */
export function useCampaignLauncher(): {
  starting: boolean;
  startLevel: (mapId: number, level: number) => Promise<void>;
} {
  const run = useRun();
  const navigate = useNavigationStore((state) => state.navigate);
  const [starting, setStarting] = useState(false);
  // Synchronous double-tap guard — state alone leaves a same-tick window.
  const startingRef = useRef(false);

  const startCampaignRun = run.startCampaignRun;
  const runBusy = run.busy;
  const runPhase = run.phase;
  const watchPhase = run.watchStatus?.phase;

  const startLevel = useCallback(
    async (mapId: number, level: number) => {
      if (startingRef.current || runBusy) return;
      if (runPhase === "resolving" || watchPhase === "resolving") {
        showToast({
          message: "Still checking an existing run — try again in a moment.",
          type: "error",
        });
        return;
      }
      // "missing" (stale local marker, nothing on-chain) may start fresh;
      // anything else means a run is attached and must be finished first.
      if (runPhase !== "none" && runPhase !== "missing") {
        showToast({
          message: "Finish your current run before starting a new one.",
          type: "error",
        });
        return;
      }

      startingRef.current = true;
      setStarting(true);
      try {
        const activeRun = await startCampaignRun(mapId, level);
        navigate("play", activeRun.runId);
      } catch (cause) {
        showToast({
          message: describeRunStartError(
            cause instanceof Error ? cause.message : String(cause),
          ).headline,
          type: "error",
        });
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [navigate, runBusy, runPhase, startCampaignRun, watchPhase],
  );

  return { starting, startLevel };
}
