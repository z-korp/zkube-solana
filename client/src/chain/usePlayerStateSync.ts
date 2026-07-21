import { useEffect, useRef } from "react";
import { PublicKey } from "@solana/web3.js";

import { useCampaign } from "@/contexts/campaign";
import { useDaily } from "@/contexts/daily";
import { useProgress } from "@/contexts/progress";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { useSolanaConnection } from "./connectionContext";
import { derivePlayerStatePda } from "./pdas";

/**
 * Single invalidation point for everything that displays PlayerState-derived
 * figures (Arcade XP, stats, and Campaign completion). The campaign, progress,
 * and daily controllers each cache their own snapshot, so instead of wiring
 * cross-refreshes into every terminal path, watch the account itself and re-pull the
 * views when it changes. The subscription is only a signal — data still
 * flows through the controllers' validated fetchers.
 */
export function usePlayerStateSync(): void {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const campaign = useCampaign();
  const progress = useProgress();
  const daily = useDaily();

  // Latest-refresh ref so the subscription never has to be re-created when
  // controller identities change render-to-render.
  const refreshAllRef = useRef<() => void>(() => {});
  refreshAllRef.current = () => {
    void campaign.refresh();
    void progress.refresh();
    void daily.refresh();
  };

  // Key the subscription on the stable base58 string, not the PublicKey
  // object identity (same idiom as the daily leaderboard subscription).
  const ownerKey = player.publicKey?.toBase58() ?? null;
  useEffect(() => {
    if (!ownerKey) return;
    const playerState = derivePlayerStatePda(new PublicKey(ownerKey));
    // Settlement touches PlayerState several times in quick succession;
    // trail-debounce so one burst becomes one refetch sweep.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const subscription = connection.onAccountChange(
      playerState,
      () => {
        if (timer !== null) globalThis.clearTimeout(timer);
        timer = globalThis.setTimeout(() => {
          timer = null;
          refreshAllRef.current();
        }, 800);
      },
      "confirmed",
    );
    return () => {
      if (timer !== null) globalThis.clearTimeout(timer);
      void connection.removeAccountChangeListener(subscription);
    };
  }, [connection, ownerKey]);
}
