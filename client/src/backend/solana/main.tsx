import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@/App";
import { BackendProvider } from "@/backend/provider";
import { makeLocalBackendLive } from "@/backend/local/LocalBackendLive";
import { MusicPlayerProvider } from "@/contexts/music";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { captureInstallPrompt } from "@/platform/installPrompt";
import { initializePwaLifecycle } from "@/platform/pwaLifecycle";
import { PwaLifecycleBanner } from "@/ui/components/shared/PwaLifecycleBanner";
import { ThemeProvider } from "@/ui/elements/theme-provider";
import "@/index.css";
import { initializeZkubeCore } from "@/core/zkubeCore";
import { makeSolanaBackendLive } from "./SolanaBackendLive";

// `beforeinstallprompt` can fire before React mounts and never fires again,
// so the capture must start ahead of the first render.
captureInstallPrompt();
initializePwaLifecycle();
await initializeZkubeCore();

const backendLayer =
  import.meta.env.DEV && DEV_BYPASS_ACTIVE
    ? makeLocalBackendLive()
    : makeSolanaBackendLive();

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
