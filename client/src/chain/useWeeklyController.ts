import { useCallback, useEffect, useRef, useState } from "react";

import { useSolanaConnection } from "./connectionContext";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { submitVersionedTransactionPlan } from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import {
  buildClaimWeeklySolPlan,
  buildClaimWeeklyStarsPlan,
  currentWeeklyId,
  fetchOwnerClaimableWeeklyIds,
  fetchWeeklyView,
  type WeeklyView,
} from "./weeklyClient";

export function useWeeklyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const [weekly, setWeekly] = useState<WeeklyView | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maintaining = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const current = currentWeeklyId();
      const [currentWeek, previousWeek] = await Promise.all([
        fetchWeeklyView({ connection, wallet, weekId: current }),
        current > 0
          ? fetchWeeklyView({ connection, wallet, weekId: current - 1 })
          : Promise.resolve(null),
      ]);
      const preferred =
        previousWeek?.status === "claimable" ? previousWeek : currentWeek;
      setWeekly(preferred);
      setError(null);
      return { currentWeek, previousWeek, preferred };
    } catch (cause) {
      setError(message(cause));
      return null;
    } finally {
      setLoading(false);
    }
  }, [connection, wallet]);

  const maintain = useCallback(async () => {
    if (player.sessionStatus !== "ready" || maintaining.current) return;
    maintaining.current = true;
    try {
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      const claimableWeekIds = await fetchOwnerClaimableWeeklyIds({
        connection,
        wallet,
      });
      for (const claimableWeekId of claimableWeekIds.slice(0, 4)) {
        const claimable = await fetchWeeklyView({
          connection,
          wallet,
          weekId: claimableWeekId,
        });
        if (claimable?.status !== "claimable" || !claimable.player) continue;
        const rank = claimable.leaderboard.findIndex((entry) =>
          entry.player.equals(wallet.publicKey),
        );
        const solWinner = rank >= 0 && rank < claimable.solWinnerCount;
        const starWinner =
          rank >= 0 && rank < claimable.solWinnerCount + claimable.starWinnerCount;
        const transactionPlans = [];
        // Stars settle first so a sol transfer failure cannot strand the
        // participation budget. Every still-claimable owner week is scanned,
        // not only the immediately previous cadence.
        if (starWinner && !claimable.player.starsClaimed) {
          transactionPlans.push(
            await buildClaimWeeklyStarsPlan({
              connection,
              wallet: sessionWallet,
              ownerAuthority: session.owner,
              sessionToken: session.sessionToken,
              weekly: claimable,
            }),
          );
        }
        if (solWinner && !claimable.player.solClaimed) {
          transactionPlans.push(
            await buildClaimWeeklySolPlan({
              connection,
              wallet: sessionWallet,
              ownerAuthority: session.owner,
              sessionToken: session.sessionToken,
              weekly: claimable,
            }),
          );
        }
        for (const transactionPlan of transactionPlans) {
          const signature = await submitVersionedTransactionPlan({
            transactionPlan,
            wallet: sessionWallet,
          });
          await connection.confirmTransaction(signature, "confirmed");
        }
      }
      await refresh();
    } catch (cause) {
      setError(message(cause));
    } finally {
      maintaining.current = false;
    }
  }, [connection, player, refresh, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void maintain();
    const timer = globalThis.setInterval(() => void maintain(), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [maintain]);

  const claim = useCallback(
    async (kind: "sol" | "stars") => {
      if (!weekly) throw new Error("Weekly rewards are not ready");
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before claiming rewards");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setAction(`claim:${kind}`);
      try {
        const transactionPlan =
          kind === "sol"
            ? await buildClaimWeeklySolPlan({
                connection,
                wallet: sessionWallet,
                ownerAuthority: owner,
                sessionToken: session.sessionToken,
                weekly,
              })
            : await buildClaimWeeklyStarsPlan({
                connection,
                wallet: sessionWallet,
                ownerAuthority: owner,
                sessionToken: session.sessionToken,
                weekly,
              });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        await refresh();
        return signature;
      } catch (cause) {
        setError(message(cause));
        throw cause;
      } finally {
        setAction(null);
      }
    },
    [connection, player, refresh, weekly],
  );

  return {
    weekly,
    loading,
    action,
    error,
    refresh,
    claimSol: () => claim("sol"),
    claimStars: () => claim("stars"),
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
