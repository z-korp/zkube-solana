import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { SolanaProvider } from "./solana/provider";
import { ThemeProvider } from "./ui/elements/theme-provider/index";
import { MusicPlayerProvider } from "./contexts/music";

import "./index.css";

const root = createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <React.StrictMode>
    <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
      <SolanaProvider>
        <MusicPlayerProvider>
          <App />
        </MusicPlayerProvider>
      </SolanaProvider>
    </ThemeProvider>
  </React.StrictMode>
);
