import React from "react";
import { createRoot } from "react-dom/client";
import { SolanaProvider } from "./solana/provider";
import SolanaPage from "./ui/pages/SolanaPage";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SolanaProvider>
      <SolanaPage />
    </SolanaProvider>
  </React.StrictMode>
);
