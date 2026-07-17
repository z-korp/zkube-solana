import { useCallback, useEffect, useState } from "react";

import { useConnectedPlayer } from "./connectedPlayerContext";
import { useSolanaConnection } from "./connectionContext";
import {
  buildRegisterUsernamePlan,
  buildRenameUsernamePlan,
  fetchPlayerIdentity,
  invalidatePlayerIdentity,
  type PlayerIdentityView,
} from "./identityClient";
import { submitVersionedTransactionPlan } from "./runPlan";

export function useIdentityController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const [identity, setIdentity] = useState<PlayerIdentityView | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const owner = player.publicKey;
    if (!owner) {
      setIdentity(null);
      return null;
    }
    setLoading(true);
    try {
      const next = await fetchPlayerIdentity({
        connection,
        wallet: player.readOnlyWallet,
        owner,
      });
      setIdentity(next);
      setError(null);
      return next;
    } catch (cause) {
      setIdentity(null);
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
      const wallet = player.wallet;
      if (!wallet)
        throw new Error("Connect a wallet before setting a username");
      setSaving(true);
      setError(null);
      try {
        const transactionPlan = identity
          ? await buildRenameUsernamePlan({
              connection,
              wallet,
              identity,
              displayName,
            })
          : await buildRegisterUsernamePlan({
              connection,
              wallet,
              displayName,
            });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        invalidatePlayerIdentity(wallet.publicKey);
        await refresh();
        return signature;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setSaving(false);
      }
    },
    [connection, identity, player.wallet, refresh],
  );

  return { identity, loading, saving, error, refresh, save };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
