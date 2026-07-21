import { useCallback, useEffect, useRef, useState } from "react";

import { errorMessage } from "@/utils/errors";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { useSolanaConnection } from "./connectionContext";
import { submitVersionedTransactionPlan } from "./runPlan";
import {
  buildCubePurchasePlan,
  fetchCubeShopView,
  hasCubePackQuoteChanged,
  type CubePackQuote,
  type CubeShopView,
} from "./shopClient";

export class CubeShopQuoteChangedError extends Error {
  constructor() {
    super("The pack price or availability changed. Review the refreshed quote.");
    this.name = "CubeShopQuoteChangedError";
  }
}

export function useShopController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const queryWallet = player.readOnlyWallet;
  const [shop, setShop] = useState<CubeShopView | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchasingPack, setPurchasingPack] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const purchaseLock = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchCubeShopView({ connection, wallet: queryWallet });
      setShop(next);
      setError(next ? null : "The Cube Shop is not configured yet.");
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, queryWallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const purchase = useCallback(
    async (quotedPack: CubePackQuote) => {
      if (purchaseLock.current !== null) {
        throw new Error("A Cube purchase is already pending");
      }
      purchaseLock.current = quotedPack.index;
      setPurchasingPack(quotedPack.index);
      setError(null);
      try {
        const wallet = player.wallet;
        if (!wallet) throw new Error("Connect a wallet before buying Cubes");
        const fresh = await fetchCubeShopView({ connection, wallet });
        if (!fresh) throw new Error("The Cube Shop is not configured yet");
        setShop(fresh);
        const freshPack = fresh.packs[quotedPack.index];
        if (hasCubePackQuoteChanged(quotedPack, freshPack)) {
          throw new CubeShopQuoteChangedError();
        }
        const transactionPlan = await buildCubePurchasePlan({
          connection,
          wallet,
          shop: fresh,
          packIndex: quotedPack.index,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        setError(null);
        await refresh();
        return signature;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        purchaseLock.current = null;
        setPurchasingPack(null);
      }
    },
    [connection, player, refresh],
  );

  return { shop, loading, purchasingPack, error, refresh, purchase };
}
