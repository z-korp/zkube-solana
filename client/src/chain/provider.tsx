import React from "react";
import { ConnectedPlayerProvider } from "./ConnectedPlayerProvider";
import { SolanaConnectionProvider } from "./SolanaConnectionProvider";

/**
 * Wallet Standard owns the durable player identity. The local provider keeps
 * only a scoped, expiring device session for silent safe actions.
 */
export function SolanaProvider({ children }: { children: React.ReactNode }) {
  return (
    <SolanaConnectionProvider>
      <ConnectedPlayerProvider>{children}</ConnectedPlayerProvider>
    </SolanaConnectionProvider>
  );
}
