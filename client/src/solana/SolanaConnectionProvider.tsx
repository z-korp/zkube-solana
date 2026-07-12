import { useMemo, type ReactNode } from "react";
import { Connection } from "@solana/web3.js";
import { SOLANA_ENDPOINT } from "./constants";
import { SolanaConnectionContext } from "./connectionContext";

export function SolanaConnectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ connection: new Connection(SOLANA_ENDPOINT, "confirmed") }),
    [],
  );
  return (
    <SolanaConnectionContext.Provider value={value}>
      {children}
    </SolanaConnectionContext.Provider>
  );
}
