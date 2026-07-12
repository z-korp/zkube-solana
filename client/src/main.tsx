import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { CampaignProvider } from "./contexts/campaign";
import { DailyProvider } from "./contexts/daily";
import { MusicPlayerProvider } from "./contexts/music";
import { ProgressProvider } from "./contexts/progress";
import { RunProvider } from "./contexts/run";
import { SolanaProvider } from "./solana/provider";
import { ThemeProvider } from "./ui/elements/theme-provider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SolanaProvider>
        <MusicPlayerProvider>
          <RunProvider>
            <CampaignProvider>
              <ProgressProvider>
                <DailyProvider>
                  <App />
                </DailyProvider>
              </ProgressProvider>
            </CampaignProvider>
          </RunProvider>
        </MusicPlayerProvider>
      </SolanaProvider>
    </ThemeProvider>
  </StrictMode>,
);
