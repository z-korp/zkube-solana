import { createContext, useContext } from "react";
import type { Keypair, PublicKey } from "@solana/web3.js";
import type { WalletLike } from "./sessionWallet";

export interface EmbeddedIdentityValue {
  keypair: Keypair;
  wallet: WalletLike;
  publicKey: PublicKey;
  balanceLamports: number | null;
  usdcBaseUnits: bigint | null;
  balanceLoading: boolean;
  refreshBalance(): Promise<number | null>;
  recoveryCode(): string;
  restore(code: string): PublicKey;
  withdrawSol(to: string, lamports: number): Promise<string>;
  withdrawUsdc(to: string, baseUnits: bigint): Promise<string>;
}

export const EmbeddedIdentityContext =
  createContext<EmbeddedIdentityValue | null>(null);

export function useEmbeddedIdentity(): EmbeddedIdentityValue {
  const context = useContext(EmbeddedIdentityContext);
  if (!context) {
    throw new Error("useEmbeddedIdentity requires EmbeddedIdentityProvider");
  }
  return context;
}
