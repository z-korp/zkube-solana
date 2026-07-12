import { createContext, useContext } from "react";
import type { Connection } from "@solana/web3.js";

export interface SolanaConnectionValue {
  connection: Connection;
}

export const SolanaConnectionContext =
  createContext<SolanaConnectionValue | null>(null);

export function useSolanaConnection(): SolanaConnectionValue {
  const context = useContext(SolanaConnectionContext);
  if (!context) {
    throw new Error("useSolanaConnection requires SolanaConnectionProvider");
  }
  return context;
}
