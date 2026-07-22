import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useSolanaConnection } from "@/chain/connectionContext";
import {
  fetchPlayerEmblems,
  type PlayerEmblemView,
} from "@/chain/playerStateClient";

/**
 * Batch the featured-emblem/star projection for a board's visible wallets in a
 * single {@link fetchPlayerEmblems} read, keyed by base58 address. Mirrors the
 * label batch the daily controller already performs: one round trip for the
 * whole board rather than one account read per row, with a short per-owner
 * cache inside the client. RPC data is untrusted — an unknown or malformed
 * account simply yields no entry, so a row renders its wallet identity without
 * a fabricated emblem.
 *
 * The connected owner's read-only wallet decodes the accounts; no signature is
 * ever requested. Addresses should be passed in a stable order so the batch
 * only refetches when the visible set actually changes.
 */
export function useLeaderboardEmblems(
  addresses: readonly string[],
): Map<string, PlayerEmblemView> {
  const { connection } = useSolanaConnection();
  const { readOnlyWallet } = useConnectedPlayer();
  const [emblems, setEmblems] = useState<Map<string, PlayerEmblemView>>(
    () => new Map(),
  );

  // A primitive key keeps the effect from refetching on every render while the
  // caller hands us a fresh array each time.
  const key = addresses.join(",");

  useEffect(() => {
    const owners: PublicKey[] = [];
    for (const value of key ? key.split(",") : []) {
      try {
        owners.push(new PublicKey(value));
      } catch {
        // Untrusted board data: skip anything that is not a valid address.
      }
    }
    if (owners.length === 0) {
      setEmblems(new Map());
      return;
    }
    let cancelled = false;
    void fetchPlayerEmblems({ connection, wallet: readOnlyWallet, owners })
      .then((views) => {
        if (cancelled) return;
        setEmblems(
          new Map(views.map((view) => [view.address.toBase58(), view])),
        );
      })
      .catch(() => {
        // A malformed emblem read never fabricates progression.
      });
    return () => {
      cancelled = true;
    };
  }, [key, connection, readOnlyWallet]);

  return emblems;
}

export default useLeaderboardEmblems;
