import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import { PLAYTEST_ACTIVE } from "@/buildTarget";
import { BackendProvider } from "@/backend/provider";
import type { BackendLayer } from "@/backend/runtime";
import {
  makeSelectedBackend,
  SELECTED_BACKEND_SENTINEL,
  SELECTED_BUILD_SENTINEL,
} from "@/backend/selected";
import { MusicPlayerProvider } from "@/contexts/music";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { captureInstallPrompt } from "@/platform/installPrompt";
import { initializePwaLifecycle } from "@/platform/pwaLifecycle";
import { initializeNativeShell } from "@/platform/nativeShell";
import { PwaLifecycleBanner } from "@/ui/components/shared/PwaLifecycleBanner";
import { ThemeProvider } from "@/ui/elements/theme-provider";
import "@/index.css";
import { initializeZkubeCore } from "@/core/zkubeCore";

// `beforeinstallprompt` can fire before React mounts and never fires again,
// so the capture must start ahead of the first render.
captureInstallPrompt();
initializePwaLifecycle();
await initializeZkubeCore();
await initializeNativeShell();

let backendLayer: BackendLayer;
if (import.meta.env.DEV && DEV_BYPASS_ACTIVE) {
  const { LOCAL_BACKEND_SENTINEL, makeLocalBackendLive } =
    await import("@/backend/local/LocalBackendLive");
  backendLayer = makeLocalBackendLive();
  document.documentElement.dataset.zkubeBackend = LOCAL_BACKEND_SENTINEL;
} else {
  backendLayer = makeSelectedBackend();
  document.documentElement.dataset.zkubeBackend = SELECTED_BACKEND_SENTINEL;
}

if (PLAYTEST_ACTIVE && SELECTED_BUILD_SENTINEL) {
  document.documentElement.dataset.zkubeBuild = SELECTED_BUILD_SENTINEL;
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
