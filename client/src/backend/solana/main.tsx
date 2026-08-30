import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import { BackendProvider } from "@/backend/provider";
import { makeLocalBackendLive } from "@/backend/local/LocalBackendLive";
import type { BackendLayer } from "@/backend/runtime";
import {
  PLAYTEST_ACTIVE,
  PLAYTEST_BUILD_SENTINEL,
} from "@/backend/local/playtest";
import { MusicPlayerProvider } from "@/contexts/music";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { captureInstallPrompt } from "@/platform/installPrompt";
import { initializePwaLifecycle } from "@/platform/pwaLifecycle";
import { PwaLifecycleBanner } from "@/ui/components/shared/PwaLifecycleBanner";
import { ThemeProvider } from "@/ui/elements/theme-provider";
import "@/index.css";
import { initializeZkubeCore } from "@/core/zkubeCore";

// `beforeinstallprompt` can fire before React mounts and never fires again,
// so the capture must start ahead of the first render.
captureInstallPrompt();
initializePwaLifecycle();
await initializeZkubeCore();

let backendLayer: BackendLayer;
if (PLAYTEST_ACTIVE || (import.meta.env.DEV && DEV_BYPASS_ACTIVE)) {
  backendLayer = makeLocalBackendLive({ playtest: PLAYTEST_ACTIVE });
} else {
  const { makeSolanaBackendLive } = await import("./SolanaBackendLive");
  backendLayer = makeSolanaBackendLive();
}

if (PLAYTEST_ACTIVE) {
  document.documentElement.dataset.zkubeBuild = PLAYTEST_BUILD_SENTINEL;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <BackendProvider layer={backendLayer}>
        <MusicPlayerProvider>
          <App />
          <PwaLifecycleBanner />
        </MusicPlayerProvider>
      </BackendProvider>
    </ThemeProvider>
  </StrictMode>,
);
