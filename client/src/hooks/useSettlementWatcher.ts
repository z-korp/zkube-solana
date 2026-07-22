import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey, type AccountInfo } from "@solana/web3.js";

import {
  decodePlayerStateAccount,
  type PlayerStateView,
} from "@/chain/campaignClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useSolanaConnection } from "@/chain/connectionContext";
import { derivePlayerStatePda } from "@/chain/pdas";
import { zkubeProgram } from "@/chain/runPlan";
import {
  detectSettlementEvents,
  pickPrimaryEvent,
  type SettlementEvent,
} from "@/chain/settlementEvents";
import { errorMessage } from "@/utils/errors";

export interface SettlementWatcher {
  /** Latest confirmed PlayerState for the connected owner (null when absent). */
  view: PlayerStateView | null;
  /**
   * The most recent precise pushed-prize signal (largest reward increase since
   * the previously observed snapshot), or null until one lands this session.
   * Sticky by design; consumers dedupe their own one-shot reactions.
   */
  latestEvent: SettlementEvent | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<PlayerStateView | null>;
}

/**
 * Real-time settlement watcher for the connected owner. Subscribes to the
 * player's PlayerState PDA with `onAccountChange` and decodes the pushed account
 * data directly with the shared, relationship-verified decoder — the same idiom
 * used by `useDailyController`, `usePlayerStateSync`, and `ActiveRunObserver`.
 * Because settlement writes to PlayerState the instant the keeper's push
 * confirms, a landed Daily/Weekly/Season prize surfaces immediately rather than
 * at the next render poll.
 *
 * Untrusted RPC: every snapshot flows through `decodePlayerStateAccount`, which
 * verifies the owning program, account size, Anchor discriminator, version,
 * embedded owner, and PDA seed before any field is trusted; a malformed or
 * wrong-owner payload is ignored and the last trusted snapshot stands, so a prize
 * event is never fabricated from bad data. The subscription is torn down on
 * unmount and whenever the connection or connected wallet changes.
 */
export function useSettlementWatcher(): SettlementWatcher {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const ownerKey = player.publicKey?.toBase58() ?? null;

  const [view, setView] = useState<PlayerStateView | null>(null);
  const [latestEvent, setLatestEvent] = useState<SettlementEvent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Last decoded snapshot, kept in a ref so the subscription callback always sees
  // the previous value for diffing without being re-created on every state change.
  const previousRef = useRef<PlayerStateView | null>(null);
  // Live refresh implementation; swapped in by the effect (same idiom as
  // usePlayerStateSync's refresh ref) so the returned handle stays stable.
  const refreshRef = useRef<() => Promise<PlayerStateView | null>>(
    async () => null,
  );
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    // Reset the diff baseline whenever the identity changes so the next owner is
    // never diffed against the previous owner's rewards.
    previousRef.current = null;
    setView(null);
    setLatestEvent(null);
    setError(null);

    if (!ownerKey) {
      setLoading(false);
      refreshRef.current = async () => null;
      return;
    }

    let cancelled = false;
    const ownerPk = new PublicKey(ownerKey);
    const address = derivePlayerStatePda(ownerPk);
    const program = zkubeProgram(connection, wallet);

    const apply = (info: AccountInfo<Buffer> | null): PlayerStateView | null => {
      if (cancelled) return null;
      if (!info) {
        // No account yet (or it disappeared): reset the baseline, never invent a
        // prize. The first paid entry initialises PlayerState.
        previousRef.current = null;
        setView(null);
        return null;
      }
      let decoded: PlayerStateView;
      try {
        decoded = decodePlayerStateAccount(program, address, ownerPk, info);
      } catch {
        // Untrusted RPC: keep the last trusted snapshot, emit nothing.
        return null;
      }
      const events = detectSettlementEvents(previousRef.current, decoded);
      previousRef.current = decoded;
      setView(decoded);
      const primary = pickPrimaryEvent(events);
      if (primary) setLatestEvent(primary);
      return decoded;
    };

    const fetchOnce = async (): Promise<PlayerStateView | null> => {
      if (cancelled) return null;
      setLoading(true);
      try {
        const info = await connection.getAccountInfo(address, "confirmed");
        const decoded = apply(info);
        if (!cancelled) setError(null);
        return decoded;
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
        return null;
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    refreshRef.current = fetchOnce;

    let subscriptionId: number | null = null;
    try {
      subscriptionId = connection.onAccountChange(
        address,
        (info) => {
          apply(info);
        },
        "confirmed",
      );
    } catch (cause) {
      if (!cancelled) setError(errorMessage(cause));
    }

    // Establish the silent baseline snapshot; increases from here are real prizes.
    void fetchOnce();

    return () => {
      cancelled = true;
      refreshRef.current = async () => null;
      if (subscriptionId !== null) {
        void connection.removeAccountChangeListener(subscriptionId);
      }
    };
  }, [connection, ownerKey, wallet]);

  return { view, latestEvent, loading, error, refresh };
}
