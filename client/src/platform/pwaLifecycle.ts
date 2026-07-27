export type PwaUpdateState =
  | "idle"
  | "available"
  | "activating"
  | "activation-failed";

export interface PwaLifecycleSnapshot {
  online: boolean;
  update: PwaUpdateState;
}

let snapshot: PwaLifecycleSnapshot = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  update: "idle",
};
let registration: ServiceWorkerRegistration | null = null;
let initialized = false;
let reloadForUpdate = false;
let cancelActivationTimeout: (() => void) | null = null;
const listeners = new Set<() => void>();
export const PWA_UPDATE_ACTIVATION_TIMEOUT_MS = 15_000;

export function getPwaLifecycleSnapshot(): PwaLifecycleSnapshot {
  return snapshot;
}

export function getServerPwaLifecycleSnapshot(): PwaLifecycleSnapshot {
  return { online: true, update: "idle" };
}

export function subscribePwaLifecycle(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function initializePwaLifecycle(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const updateOnlineState = () => {
    setSnapshot({ online: navigator.onLine });
  };
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);

  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!reloadForUpdate) return;
    cancelActivationTimeout?.();
    cancelActivationTimeout = null;
    reloadForUpdate = false;
    window.location.reload();
  });

  const register = () => {
    void navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        // The lower-impact Firefox module-worker compatibility gap remains
        // explicit; this Seeker-focused slice does not add a classic fallback.
        type: "module",
        updateViaCache: "none",
      })
      .then((nextRegistration) => {
        registration = nextRegistration;
        observeRegistration(nextRegistration, navigator.serviceWorker);
      })
      .catch((cause: unknown) => {
        // A failed worker must not prevent the network app from starting.
        console.error("zKube service worker registration failed", cause);
      });
  };

  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}

/**
 * Requests activation only after an explicit UI action. Cache activation never
 * clears localStorage, run markers, or the time-bounded device authorization.
 */
export function activateWaitingPwaUpdate(): boolean {
  if (snapshot.update === "activation-failed" && snapshot.online) {
    window.location.reload();
    return true;
  }
  const waiting = registration?.waiting;
  if (!waiting || !snapshot.online || snapshot.update === "activating") {
    return false;
  }
  reloadForUpdate = true;
  setSnapshot({ update: "activating" });
  try {
    cancelActivationTimeout = requestServiceWorkerActivation(waiting, () => {
      cancelActivationTimeout = null;
      reloadForUpdate = false;
      setSnapshot({ update: "activation-failed" });
    });
  } catch {
    reloadForUpdate = false;
    setSnapshot({ update: "available" });
    return false;
  }
  return true;
}

export function requestServiceWorkerActivation(
  waiting: Pick<ServiceWorker, "postMessage">,
  onTimeout: () => void,
  timeoutMs = PWA_UPDATE_ACTIVATION_TIMEOUT_MS,
): () => void {
  waiting.postMessage({ type: "SKIP_WAITING" });
  const timer = globalThis.setTimeout(onTimeout, timeoutMs);
  return () => globalThis.clearTimeout(timer);
}

function observeRegistration(
  nextRegistration: ServiceWorkerRegistration,
  container: ServiceWorkerContainer,
): void {
  if (nextRegistration.waiting && container.controller) {
    setSnapshot({ update: "available" });
  }
  nextRegistration.addEventListener("updatefound", () => {
    const installing = nextRegistration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (
        installing.state === "installed" &&
        nextRegistration.waiting &&
        container.controller
      ) {
        setSnapshot({ update: "available" });
      }
    });
  });
}

function setSnapshot(change: Partial<PwaLifecycleSnapshot>): void {
  const next = { ...snapshot, ...change };
  if (next.online === snapshot.online && next.update === snapshot.update)
    return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}
