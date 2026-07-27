import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { CampaignProvider } from "./contexts/campaign";
import { DailyProvider } from "./contexts/daily";
import { MusicPlayerProvider } from "./contexts/music";
import { RunProvider } from "./contexts/run";
import { SeasonProvider } from "./contexts/season";
import { WeeklyProvider } from "./contexts/weekly";
import { SolanaProvider } from "./chain/provider";
import { captureInstallPrompt } from "./platform/installPrompt";
import { initializePwaLifecycle } from "./platform/pwaLifecycle";
import { PwaLifecycleBanner } from "./ui/components/shared/PwaLifecycleBanner";
import { ThemeProvider } from "./ui/elements/theme-provider";
import "./index.css";

// `beforeinstallprompt` can fire before React mounts and never fires again,
// so the capture must start ahead of the first render.
captureInstallPrompt();
initializePwaLifecycle();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SolanaProvider>
        <MusicPlayerProvider>
          <RunProvider>
            <CampaignProvider>
              <DailyProvider>
                <WeeklyProvider>
                  <SeasonProvider>
                    <App />
                    <PwaLifecycleBanner />
                  </SeasonProvider>
                </WeeklyProvider>
              </DailyProvider>
            </CampaignProvider>
          </RunProvider>
        </MusicPlayerProvider>
      </SolanaProvider>
    </ThemeProvider>
  </StrictMode>,
);
