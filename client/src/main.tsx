import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { MusicPlayerProvider } from "./contexts/music";
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
            <App />
          </RunProvider>
        </MusicPlayerProvider>
      </SolanaProvider>
    </ThemeProvider>
  </StrictMode>,
);
