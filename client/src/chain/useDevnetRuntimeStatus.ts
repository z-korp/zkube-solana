import { useEffect, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";
import {
  deriveMapCatalogPda,
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
  deriveStarSalesLedgerPda,
} from "./pdas";
export type DevnetRuntimePhase =
  | "checking"
  | "bootstrap-pending"
  | "ready"
  | "error";

export interface DevnetRuntimeStatus {
  phase: DevnetRuntimePhase;
  message: string;
}

export function useDevnetRuntimeStatus(): DevnetRuntimeStatus {
  const { connection } = useSolanaConnection();
  const [status, setStatus] = useState<DevnetRuntimeStatus>({
    phase: "checking",
    message: "Checking MagicBlock Devnet…",
  });

  useEffect(() => {
    let cancelled = false;
    setStatus({ phase: "checking", message: "Checking MagicBlock Devnet…" });
    void probeDevnetRuntime(connection).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [connection]);

  return status;
}

export async function probeDevnetRuntime(
  connection: import("@solana/web3.js").Connection,
): Promise<DevnetRuntimeStatus> {
  try {
    const catalogAddresses = [
      deriveEconomyConfigPda(),
      deriveStarSalesLedgerPda(),
      deriveDailyRulesCatalogPda(1),
      ...Array.from({ length: 10 }, (_, index) =>
        deriveMapCatalogPda(1, index + 1),
      ),
    ];
    const [genesis, program, protocol, catalogs] = await Promise.all([
      connection.getGenesisHash(),
      connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed"),
      connection.getAccountInfo(deriveProtocolConfigPda(), "confirmed"),
      connection.getMultipleAccountsInfo(catalogAddresses, "confirmed"),
    ]);
    if (genesis !== SOLANA_DEVNET_GENESIS_HASH) {
      return {
        phase: "error",
        message: "Configured RPC is not Solana Devnet.",
      };
    }
    if (!program?.executable) {
      return {
        phase: "error",
        message: "zKube program is not live on Devnet.",
      };
    }
    if (!protocol?.owner.equals(ZKUBE_PROGRAM_ID)) {
      return {
        phase: "bootstrap-pending",
        message: "Program live · protocol bootstrap pending",
      };
    }
    if (catalogs.some((catalog) => catalog === null)) {
      return {
        phase: "bootstrap-pending",
        message: "Protocol live · catalogs pending",
      };
    }
    if (
      catalogs.some(
        (catalog) => catalog && !catalog.owner.equals(ZKUBE_PROGRAM_ID),
      )
    ) {
      return {
        phase: "error",
        message: "A Devnet catalog has an invalid owner.",
      };
    }
    return { phase: "ready", message: "MagicBlock Devnet ready" };
  } catch (error) {
    return {
      phase: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to inspect MagicBlock Devnet",
    };
  }
}
