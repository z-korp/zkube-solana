import { useCallback, useEffect, useRef, useState } from "react";

import { useEmbeddedIdentity } from "./embeddedIdentityContext";
import { useSolanaConnection } from "./connectionContext";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import {
  buildStarPurchasePlan,
  fetchStarShopView,
  hasStarPackQuoteChanged,
  type StarPackQuote,
  type StarShopView,
} from "./shopClient";

export class StarShopQuoteChangedError extends Error {
  constructor() {
    super("The pack price or availability changed. Review the refreshed quote.");
    this.name = "StarShopQuoteChangedError";
  }
}

export function useShopController() {
  const { connection } = useSolanaConnection();
  const { wallet } = useEmbeddedIdentity();
  const [shop, setShop] = useState<StarShopView | null>(null);
  const [loading, setLoading] = useState(false);
  const [purchasingPack, setPurchasingPack] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const purchaseLock = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchStarShopView({ connection, wallet });
      setShop(next);
      setError(next ? null : "The Star Shop is not configured yet.");
      return next;
    } catch (cause) {
      setError(errorMessage(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const purchase = useCallback(
    async (quotedPack: StarPackQuote) => {
      if (purchaseLock.current !== null) {
        throw new Error("A Star purchase is already pending");
      }
      purchaseLock.current = quotedPack.index;
      setPurchasingPack(quotedPack.index);
      setError(null);
      try {
        const fresh = await fetchStarShopView({ connection, wallet });
        if (!fresh) throw new Error("The Star Shop is not configured yet");
        setShop(fresh);
        const freshPack = fresh.packs[quotedPack.index];
        if (hasStarPackQuoteChanged(quotedPack, freshPack)) {
          throw new StarShopQuoteChangedError();
        }
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan = await buildStarPurchasePlan({
          connection,
          wallet,
          shop: fresh,
          packIndex: quotedPack.index,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet,
          paymaster,
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
    [connection, refresh, wallet],
  );

  return { shop, loading, purchasingPack, error, refresh, purchase };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
