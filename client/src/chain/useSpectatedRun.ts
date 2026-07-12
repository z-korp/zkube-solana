import { useEffect, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import { PersistedRunWatcher, type RunWatchStatus } from "./runWatcher";
import {
  resolveSpectatedRun,
  type SpectatedRun,
  type SpectateTarget,
} from "./spectateRun";

export interface SpectatedRunState {
  run: SpectatedRun | null;
  status: RunWatchStatus | null;
}

/**
 * Read-only live view of someone else's run: push updates from the resolved
 * (ER or base) endpoint plus the watcher's periodic router re-resolution to
 * follow ER→base transitions at settlement. `not-found` is a normal state,
 * not an error — the watcher keeps its regular poll cadence.
 */
export function useSpectatedRun(
  target: SpectateTarget | null,
): SpectatedRunState {
  const { connection } = useSolanaConnection();
  const [run, setRun] = useState<SpectatedRun | null>(null);
  const [status, setStatus] = useState<RunWatchStatus | null>(null);

  useEffect(() => {
    if (!target) {
      setRun(null);
      setStatus(null);
      return;
    }
    const watcher = new PersistedRunWatcher<SpectatedRun>({
      resolve: () => resolveSpectatedRun({ baseConnection: connection, target }),
      onState: setRun,
      onStatus: setStatus,
      bindTarget: (state) =>
        state.phase === "delegated" || state.phase === "base"
          ? { connection: state.connection, address: state.activeRunPda }
          : null,
    });
    watcher.start();
    return () => void watcher.stop();
  }, [connection, target]);

  return { run, status };
}
