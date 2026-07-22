import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { useSolanaConnection } from "./connectionContext";
import {
  buildSetFeaturedEmblemPlan,
  fetchPlayerStateView,
  invalidatePlayerEmblems,
} from "./playerStateClient";
import { submitVersionedTransactionPlan } from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import { createChainTraceId, emitChainMetric } from "./telemetry";

/**
 * Owner-authorized featured-emblem controller. This is the only emblem write
 * path and mirrors usePlayerLabelController exactly: reads the current stored
 * emblem for display, and on save signs the setFeaturedEmblem instruction with
 * the device session (owner authority + optional session token gate the write,
 * the session signer is the actor). Emblems are cosmetic; the write never
 * touches money or progression.
 */
export function useFeaturedEmblemController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const [featuredEmblem, setFeaturedEmblem] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const owner = player.publicKey;
    if (!owner) {
      setFeaturedEmblem(null);
      return null;
    }
    setLoading(true);
    try {
      const view = await fetchPlayerStateView({
        connection,
        wallet: player.readOnlyWallet,
        owner,
      });
      const next = view?.featuredEmblem ?? 0;
      setFeaturedEmblem(next);
      setError(null);
      return next;
    } catch (cause) {
      setFeaturedEmblem(null);
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, player.publicKey, player.readOnlyWallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (emblemId: number) => {
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before choosing an emblem");
      const device = player.requireSession();
      const wallet = new SessionWallet(device.signer);
      const traceId = createChainTraceId();
      const startedAt = Date.now();
      setSaving(true);
      setError(null);
      emitChainMetric({
        traceId,
        operation: "featured-emblem:start",
        layer: "solana-base",
        phase: "save",
        ok: true,
        owner: owner.toBase58(),
        actor: wallet.publicKey.toBase58(),
      });
      try {
        const transactionPlan = await buildSetFeaturedEmblemPlan({
          connection,
          wallet,
          ownerAuthority: owner,
          sessionToken: device.sessionToken,
          emblemId,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        invalidatePlayerEmblems(owner);
        await refresh();
        emitChainMetric({
          traceId,
          operation: "featured-emblem:done",
          layer: "solana-base",
          phase: "save",
          ok: true,
          signature,
          durationMs: Date.now() - startedAt,
        });
        return signature;
      } catch (cause) {
        const message = errorMessage(cause);
        setError(message);
        emitChainMetric({
          traceId,
          operation: "featured-emblem:error",
          layer: "solana-base",
          phase: "save",
          ok: false,
          error: message,
          durationMs: Date.now() - startedAt,
        });
        throw cause;
      } finally {
        setSaving(false);
      }
    },
    [connection, player, refresh],
  );

  return { featuredEmblem, loading, saving, error, refresh, save };
}
