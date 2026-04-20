import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-wallets";
import { SOLANA_ENDPOINT } from "./constants";

/**
 * SolanaProvider — wraps l'app avec les providers wallet Solana
 * Doit être placé en dehors de StarknetConfig (les deux coexistent)
 */
export function SolanaProvider({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={SOLANA_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
