/**
 * One-shot capture of Chromium's `beforeinstallprompt` event so the connect
 * surface can offer PWA installation from an Android browser. The event can
 * fire before React mounts and is consumable at most once, so `main.tsx`
 * starts the capture ahead of the first render and UI code subscribes to this
 * module-level store (the same pattern as wallet availability).
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export type InstallPromptOutcome = "accepted" | "dismissed" | "unavailable";

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let capturing = false;
const installPromptListeners = new Set<() => void>();

export function captureInstallPrompt(): void {
  if (capturing || typeof window === "undefined") return;
  capturing = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    // Deferring suppresses Chromium's own mini-infobar and keeps the install
    // decision on the connect surface.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyInstallPromptListeners();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyInstallPromptListeners();
  });
}

export function installPromptAvailable(): boolean {
  return deferredPrompt !== null;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  installPromptListeners.add(listener);
  return () => {
    installPromptListeners.delete(listener);
  };
}

/** Shows the deferred browser install dialog. The captured event is single-use. */
export async function promptInstall(): Promise<InstallPromptOutcome> {
  const event = deferredPrompt;
  if (!event) return "unavailable";
  deferredPrompt = null;
  notifyInstallPromptListeners();
  await event.prompt();
  return (await event.userChoice).outcome;
}

function notifyInstallPromptListeners(): void {
  installPromptListeners.forEach((listener) => {
    try {
      listener();
    } catch (cause) {
      console.error("Install prompt listener failed", cause);
    }
  });
}
