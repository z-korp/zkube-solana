import { useCallback, useEffect, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { useSolanaConnection } from "./connectionContext";
import {
  buildFundedCreatePlayerLabelPlan,
  buildSetPlayerLabelPlan,
  fetchPlayerLabel,
  invalidatePlayerLabel,
  type PlayerLabelView,
} from "./playerLabelClient";
import { submitVersionedTransactionPlan } from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import { createChainTraceId, emitChainMetric } from "./telemetry";

export function usePlayerLabelController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const [label, setLabel] = useState<PlayerLabelView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const owner = player.publicKey;
    if (!owner) {
      setLabel(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchPlayerLabel({
        connection,
        wallet: player.readOnlyWallet,
        owner,
      });
      setLabel(next);
      setError(null);
      return next;
    } catch (cause) {
      setLabel(null);
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
    async (displayName: string) => {
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before setting a label");
      const device = player.requireSession();
      const wallet = new SessionWallet(device.signer);
      const traceId = createChainTraceId();
      const startedAt = Date.now();
      setSaving(true);
      setError(null);
      emitChainMetric({
        traceId,
        operation: "player-label:start",
        layer: "solana-base",
        phase: label ? "update" : "create",
        ok: true,
        owner: owner.toBase58(),
        actor: wallet.publicKey.toBase58(),
      });
      try {
        const transactionPlan = label
          ? await buildSetPlayerLabelPlan({
              connection,
              wallet,
              ownerAuthority: owner,
              sessionToken: device.sessionToken,
              displayName,
            })
          : await buildFundedCreatePlayerLabelPlan({
              connection,
              wallet,
              ownerAuthority: owner,
              sessionToken: device.sessionToken,
              displayName,
            });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        invalidatePlayerLabel(owner);
        await refresh();
        emitChainMetric({
          traceId,
          operation: "player-label:done",
          layer: "solana-base",
          phase: label ? "update" : "create",
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
          operation: "player-label:error",
          layer: "solana-base",
          phase: label ? "update" : "create",
          ok: false,
          error: message,
          durationMs: Date.now() - startedAt,
        });
        throw cause;
      } finally {
        setSaving(false);
      }
    },
    [connection, label, player, refresh],
  );

  return { label, loading, saving, error, refresh, save };
}
