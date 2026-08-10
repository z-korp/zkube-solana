import { useEffect, useMemo, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useSolanaConnection } from "@/chain/connectionContext";
import {
  fetchPlayerEmblems,
  type PlayerEmblemView,
} from "@/chain/playerStateClient";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { buildDevLeaderboardEmblems } from "@/dev/fixtures";

/**
 * Emblem and ladder-tier projection for the wallets on a board, keyed by
 * base58 address.
 *
 * One batched `getMultipleAccountsInfo` behind a short per-owner cache, so a
 * board draws every player's tier without an account read per row. A missing
 * or malformed account simply yields no entry: the row still renders from the
 * board's own data and never invents progression for a wallet.
 */
export function useLeaderboardEmblems(
  owners: readonly PublicKey[],
): Map<string, PlayerEmblemView> {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const [emblems, setEmblems] = useState<Map<string, PlayerEmblemView>>(
    () => new Map(),
  );

  // Addresses, not PublicKey identities: the board rebuilds its rows on every
  // poll, so comparing objects would refetch on an unchanged field.
  const key = useMemo(
    () =>
      owners
        .map((owner) => owner.toBase58())
        .sort()
        .join(","),
    [owners],
  );

  useEffect(() => {
    // DEV-ONLY: the bypass has no chain, so a live board would render six
    // empty avatar slots and the layout could not be judged. Folds away in
    // production builds.
    if (import.meta.env.DEV && DEV_BYPASS_ACTIVE) {
      setEmblems(
        new Map(
          buildDevLeaderboardEmblems().map((view) => [
            view.address.toBase58(),
            view,
          ]),
        ),
      );
      return;
    }
    if (key === "") {
      setEmblems(new Map());
      return;
    }
    let live = true;
    void fetchPlayerEmblems({
      connection,
      wallet: player.readOnlyWallet,
      owners,
    })
      .then((views) => {
        if (!live) return;
        setEmblems(
          new Map(views.map((view) => [view.address.toBase58(), view])),
        );
      })
      .catch(() => {
        // A board never fails to render because a profile read did.
      });
    return () => {
      live = false;
    };
    // `owners` is covered by `key`; depending on it directly would refetch on
    // every poll that returns an identical field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, connection, player.readOnlyWallet]);

  return emblems;
}
