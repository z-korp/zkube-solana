import { useEffect, useState } from "react";
import { useSolanaConnection } from "./connectionContext";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";
import {
  deriveMapCatalogPda,
  deriveProgressCatalogPda,
  deriveProtocolConfigPda,
} from "./pdas";
import { fetchPaymasterClient } from "./paymasterClient";

/** Below this reserve (~3-4 fresh players of fronted rent) the Home banner
 *  warns before a map tap burns into a doomed prepare simulation. */
export const PAYMASTER_MIN_LAMPORTS = Number(
  import.meta.env.VITE_PUBLIC_PAYMASTER_MIN_LAMPORTS ?? 50_000_000,
);

export type DevnetRuntimePhase =
  | "checking"
  | "bootstrap-pending"
  | "paymaster-unavailable"
  | "ready"
  | "error";

export interface DevnetRuntimeStatus {
  phase: DevnetRuntimePhase;
  message: string;
  paymasterBalanceLamports?: number;
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
      deriveProgressCatalogPda(1),
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
    try {
      const paymaster = await fetchPaymasterClient(connection);
      const paymasterBalanceLamports = await connection.getBalance(
        paymaster.pubkey,
        "confirmed",
      );
      if (paymasterBalanceLamports < PAYMASTER_MIN_LAMPORTS) {
        return {
          phase: "paymaster-unavailable",
          message:
            "Sponsored play reserve is low — new runs may fail until it is refilled",
          paymasterBalanceLamports,
        };
      }
      return {
        phase: "ready",
        message: "MagicBlock Devnet ready",
        paymasterBalanceLamports,
      };
    } catch (error) {
      return {
        phase: "paymaster-unavailable",
        message:
          error instanceof Error
            ? `Protocol live · ${error.message}`
            : "Protocol live · paymaster unavailable",
      };
    }
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
