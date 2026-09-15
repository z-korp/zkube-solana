import { useCallback, useRef, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useRun } from "@/backend/client";
import { useNavigationStore } from "@/stores/navigationStore";
import { showToast } from "@/utils/toast";
import { describeRunStartError } from "@/core/runStartError";

/** Start and persist the local trial before opening its board. */
export function useCampaignLauncher(): {
  starting: boolean;
  startLevel: (mapId: number, level: number) => Promise<void>;
} {
  const run = useRun().campaign;
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
      if (runPhase === "resolving" || watchPhase !== "subscribed") {
        showToast({
          message: "Still checking an existing run — try again in a moment.",
          type: "error",
        });
        return;
      }
      // Resume the saved local trial before beginning another.
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
          message: describeRunStartError(errorMessage(cause)).headline,
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
