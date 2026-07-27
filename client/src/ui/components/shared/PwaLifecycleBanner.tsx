import { RefreshCw, WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useRun } from "@/contexts/run";
import {
  activateWaitingPwaUpdate,
  getPwaLifecycleSnapshot,
  getServerPwaLifecycleSnapshot,
  subscribePwaLifecycle,
  type PwaLifecycleSnapshot,
} from "@/platform/pwaLifecycle";
import { useNavigationStore } from "@/stores/navigationStore";

export function PwaLifecycleBanner() {
  const lifecycle = useSyncExternalStore(
    subscribePwaLifecycle,
    getPwaLifecycleSnapshot,
    getServerPwaLifecycleSnapshot,
  );
  const currentPage = useNavigationStore((state) => state.currentPage);
  const run = useRun();
  const refreshBlocked =
    currentPage === "play" || run.campaign.busy || run.arcade.busy;

  return (
    <PwaLifecycleNotice
      lifecycle={lifecycle}
      refreshBlocked={refreshBlocked}
      onRefresh={activateWaitingPwaUpdate}
    />
  );
}

export function PwaLifecycleNotice({
  lifecycle,
  refreshBlocked,
  onRefresh,
}: {
  lifecycle: PwaLifecycleSnapshot;
  refreshBlocked: boolean;
  onRefresh: () => boolean;
}) {
  if (lifecycle.online && lifecycle.update === "idle") return null;

  const activating = lifecycle.update === "activating";
  const activationFailed = lifecycle.update === "activation-failed";
  const updateAvailable = lifecycle.update !== "idle";
  const refreshDisabled = activating || refreshBlocked || !lifecycle.online;

  return (
    <aside
      aria-live="polite"
      className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[100] mx-auto max-w-lg rounded-2xl border border-cyan-200/25 bg-[#080414]/95 px-4 py-3 font-sans text-white shadow-2xl backdrop-blur-xl"
    >
      {!lifecycle.online && (
        <div className="flex items-start gap-3" role="status">
          <WifiOff className="mt-0.5 shrink-0 text-amber-200" size={18} />
          <p className="text-xs leading-5 text-white/85">
            You&apos;re offline. Reconnect, then retry. Chain, wallet, and score
            data are never served from the offline cache.
          </p>
        </div>
      )}
      {updateAvailable && (
        <div
          className={`flex items-center gap-3 ${!lifecycle.online ? "mt-3 border-t border-white/10 pt-3" : ""}`}
        >
          <RefreshCw
            className={`shrink-0 text-cyan-200 ${activating ? "animate-spin" : ""}`}
            size={18}
          />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold">
              {activating
                ? "Refreshing zKube…"
                : activationFailed
                  ? "The update did not activate."
                  : "A new zKube version is ready."}
            </p>
            {!activating && refreshBlocked && (
              <p className="mt-0.5 text-[11px] leading-4 text-white/65">
                Finish or leave active play before refreshing.
              </p>
            )}
          </div>
          {!activating && (
            <button
              type="button"
              disabled={refreshDisabled}
              onClick={onRefresh}
              className="shrink-0 rounded-lg border border-cyan-200/40 px-3 py-1.5 text-xs font-bold text-cyan-100 transition-colors hover:bg-cyan-200/10 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {activationFailed ? "Retry refresh" : "Refresh"}
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
