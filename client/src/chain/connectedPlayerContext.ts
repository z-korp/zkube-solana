import { createContext, useContext } from "react";
import type { PublicKey } from "@solana/web3.js";

import type { WalletConnector } from "@/platform/walletStandard";
import type { DeviceSession } from "./deviceSessionStore";
import type { WalletLike } from "./sessionWallet";

export type PlayerConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected";
export type PlayerSessionStatus =
  | "missing"
  | "checking"
  | "ready"
  | "expired"
  | "needsRenewal";

export interface ConnectedPlayerValue {
  connectors: WalletConnector[];
  connectionStatus: PlayerConnectionStatus;
  connector: WalletConnector | null;
  publicKey: PublicKey | null;
  wallet: WalletLike | null;
  /** Non-signing Anchor adapter for decoding authoritative chain state. */
  readOnlyWallet: WalletLike;
  session: DeviceSession | null;
  sessionStatus: PlayerSessionStatus;
  balanceLamports: number | null;
  balanceLoading: boolean;
  error: string | null;
  connectAndEnable(connectorId: string): Promise<void>;
  enable(): Promise<string>;
  renew(): Promise<string>;
  disconnect(): Promise<void>;
  refreshBalance(): Promise<void>;
  requireSession(): DeviceSession;
  markSessionNeedsRenewal(): void;
}

export const ConnectedPlayerContext =
  createContext<ConnectedPlayerValue | null>(null);

export function useConnectedPlayer(): ConnectedPlayerValue {
  const context = useContext(ConnectedPlayerContext);
  if (!context) {
    throw new Error("useConnectedPlayer requires ConnectedPlayerProvider");
  }
  return context;
}
