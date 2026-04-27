import { createContext } from "react";
import type { ReactNode } from "react";

// ── Stub Dojo context (migration Solana) ──────────────────────────────────────
// Le jeu tourne désormais sur Solana / Phantom.
// Ce stub permet aux hooks qui importent encore DojoContext de compiler
// sans crash. Ils retourneront des données vides.
// TODO: supprimer les hooks Dojo restants au fil des migrations.

export const DojoContext = createContext<any>(null);

export const DojoProvider = ({ children }: { children: ReactNode }) => {
  return <>{children}</>;
};
