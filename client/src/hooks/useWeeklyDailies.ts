import { useCallback, useEffect, useState } from "react";

import { useSolanaConnection } from "@/chain/connectionContext";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import {
  buildRefundDailyEntryPlan,
  currentDailyDayId,
  fetchDailyView,
  type DailyView,
} from "@/chain/dailyClient";
import { submitVersionedTransactionPlan } from "@/chain/runPlan";
import { SessionWallet } from "@/chain/sessionWallet";
import { currentWeeklyId } from "@/chain/weeklyClient";
import {
  getPlayerPosition,
  type PlayerPosition,
} from "@/ui/components/arena/dailyPosition";
import { errorMessage } from "@/utils/errors";

export interface WeeklyDaily {
  dayId: number;
  view: DailyView;
  /** Best-run standing on that day's board, or null if unranked. */
  position: PlayerPosition | null;
  score: number;
}

/**
 * The connected player's finished Daily runs earlier THIS weekly (today lives in
 * the live board). Each day's DailyView already carries its leaderboard, so a
 * row can reveal that day's ranking inline with no extra fetch.
 */
export function useWeeklyDailies() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const address = player.publicKey?.toBase58() ?? "";

  const [runs, setRuns] = useState<WeeklyDaily[]>([]);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setRuns([]);
      return;
    }
    setLoading(true);
    try {
      const today = currentDailyDayId();
      const weeklyFirstDay = Math.max(0, currentWeeklyId() * 14 - 3);
      const dayIds: number[] = [];
      for (let day = weeklyFirstDay; day < today; day += 1) dayIds.push(day);

      const views = await Promise.all(
        dayIds.map((dayId) =>
          fetchDailyView({ connection, wallet, dayId }).catch(() => null),
        ),
      );

      const played = dayIds
        .map((dayId, index) => ({ dayId, view: views[index] }))
        .filter(
          (row): row is { dayId: number; view: DailyView } =>
            row.view !== null && (row.view.player?.attempts ?? 0) > 0,
        )
        .map(({ dayId, view }) => {
          const position = getPlayerPosition(view, address);
          return {
            dayId,
            view,
            position,
            score: position?.score ?? view.player?.bestDailyScore ?? 0,
          };
        })
        .sort((a, b) => b.dayId - a.dayId);

      setRuns(played);
      setError(null);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, [address, connection, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const refund = useCallback(
    async (run: WeeklyDaily) => {
      if (!player.publicKey) {
        throw new Error("Connect a wallet before requesting a refund");
      }
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setAction(run.dayId);
      try {
        const transactionPlan = await buildRefundDailyEntryPlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: player.publicKey,
          sessionToken: session.sessionToken,
          daily: run.view,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        await refresh();
        return signature;
      } catch (cause) {
        setError(errorMessage(cause));
        throw cause;
      } finally {
        setAction(null);
      }
    },
    [connection, player, refresh],
  );

  return { runs, loading, action, error, refresh, refund };
}
