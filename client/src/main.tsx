import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { CampaignProvider } from "./contexts/campaign";
import { DailyProvider } from "./contexts/daily";
import { MusicPlayerProvider } from "./contexts/music";
import { ProgressProvider } from "./contexts/progress";
import { RunProvider } from "./contexts/run";
import { WeeklyProvider } from "./contexts/weekly";
import { SolanaProvider } from "./chain/provider";
import { ThemeProvider } from "./ui/elements/theme-provider";
import "./index.css";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SolanaProvider>
        <MusicPlayerProvider>
          <RunProvider>
            <CampaignProvider>
              <ProgressProvider>
                <DailyProvider>
                  <WeeklyProvider>
                    <App />
                  </WeeklyProvider>
                </DailyProvider>
              </ProgressProvider>
            </CampaignProvider>
          </RunProvider>
        </MusicPlayerProvider>
      </SolanaProvider>
    </ThemeProvider>
  </StrictMode>,
);
