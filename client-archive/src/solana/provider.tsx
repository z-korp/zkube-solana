import React from "react";
import { EmbeddedIdentityProvider } from "./reboot/EmbeddedIdentityProvider";
import { SolanaConnectionProvider } from "./SolanaConnectionProvider";

/**
 * The app owns a stable embedded Solana identity. Gameplay never requires an
 * injected wallet or popup; the paymaster remains the base fee payer.
 */
export function SolanaProvider({ children }: { children: React.ReactNode }) {
  return (
    <SolanaConnectionProvider>
      <EmbeddedIdentityProvider>{children}</EmbeddedIdentityProvider>
    </SolanaConnectionProvider>
  );
}
