import { useCallback, useEffect, useRef, useState } from "react";

import { useDaily } from "@/contexts/daily";

import { useSolanaConnection } from "./connectionContext";
import { currentDailyDayId, fetchDailyView } from "./dailyClient";
import { fetchEconomyRuntime } from "./economyClient";
import { useConnectedPlayer } from "./connectedPlayerContext";
import { fetchPaymasterClient } from "./paymasterClient";
import { submitSponsoredTransactionPlan } from "./runPlan";
import { SessionWallet } from "./sessionWallet";
import {
  buildClaimWeeklyCashPlan,
  buildClaimWeeklyStarsPlan,
  buildFinalizeWeeklyPlan,
  buildForfeitWeeklyCashPlan,
  buildOpenWeeklyPlan,
  buildRollupDailyPlan,
  currentWeeklyId,
  fetchPendingDailyRollupOwners,
  fetchOwnerClaimableWeeklyIds,
  fetchWeeklyView,
  type WeeklyView,
} from "./weeklyClient";

export function useWeeklyController() {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const wallet = player.readOnlyWallet;
  const daily = useDaily();
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
      const runtime = await fetchEconomyRuntime({ connection, wallet });
      if (!runtime) {
        await refresh();
        return;
      }
      const paymaster = await fetchPaymasterClient(connection);
      const weekId = currentWeeklyId();
      let current = await fetchWeeklyView({ connection, wallet, weekId });
      if (!current) {
        const transactionPlan = await buildOpenWeeklyPlan({
          connection,
          wallet: sessionWallet,
          weekId,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
          paymaster,
        });
        await connection.confirmTransaction(signature, "confirmed");
        current = await fetchWeeklyView({ connection, wallet, weekId });
      }
      const dayId = currentDailyDayId();
      const yesterday =
        dayId > 0
          ? await fetchDailyView({ connection, wallet, dayId: dayId - 1 })
          : null;
      const dailyCandidates = [yesterday, daily.daily].filter(
        (candidate, index, values) =>
          candidate &&
          values.findIndex((value) => value?.dayId === candidate.dayId) === index,
      );
      let rolledThisPass = false;
      const rolledOwners = new Set<string>();
      for (const candidate of dailyCandidates) {
        if (
          candidate?.economyVersion !== 2 ||
          candidate.status !== "claimable" ||
          !candidate.player ||
          candidate.player.bestRunId === 0n ||
          candidate.player.weeklyRolledUp
        ) {
          continue;
        }
        const rollupWeek =
          candidate.weekId === current?.weekId
            ? current
            : await fetchWeeklyView({
                connection,
                wallet,
                weekId: candidate.weekId,
              });
        if (!rollupWeek) continue;
        const transactionPlan = await buildRollupDailyPlan({
          connection,
          wallet: sessionWallet,
          daily: candidate,
          weekly: rollupWeek,
          paymaster: paymaster.pubkey,
        });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
          paymaster,
        });
        await connection.confirmTransaction(signature, "confirmed");
        rolledThisPass = true;
        rolledOwners.add(`${candidate.address.toBase58()}:${wallet.publicKey.toBase58()}`);
      }
      await daily.refresh();
      if (weekId > 0) {
        const previous = await fetchWeeklyView({
          connection,
          wallet,
          weekId: weekId - 1,
        });
        if (
          previous?.status === "open" &&
          Math.floor(Date.now() / 1_000) >= previous.finalizesAt
        ) {
          const startDay = previous.weekId * 7 - 3;
          const weekDays = await Promise.all(
            Array.from({ length: 7 }, (_, offset) =>
              fetchDailyView({
                connection,
                wallet,
                dayId: startDay + offset,
              }),
            ),
          );
          let keeperBudget = 3;
          for (const candidate of weekDays) {
            if (
              keeperBudget === 0 ||
              candidate?.economyVersion !== 2 ||
              candidate.status !== "claimable"
            ) {
              continue;
            }
            const owners = await fetchPendingDailyRollupOwners({
              connection,
              wallet,
              daily: candidate,
            });
            for (const owner of owners) {
              if (keeperBudget === 0) break;
              const key = `${candidate.address.toBase58()}:${owner.toBase58()}`;
              if (rolledOwners.has(key)) continue;
              const transactionPlan = await buildRollupDailyPlan({
                connection,
                wallet: sessionWallet,
                daily: candidate,
                weekly: previous,
                paymaster: paymaster.pubkey,
                playerOwner: owner,
              });
              const signature = await submitSponsoredTransactionPlan({
                transactionPlan,
                wallet: sessionWallet,
                paymaster,
              });
              await connection.confirmTransaction(signature, "confirmed");
              rolledOwners.add(key);
              keeperBudget -= 1;
              rolledThisPass = true;
            }
          }
          if (rolledThisPass) {
            await refresh();
            return;
          }
          const transactionPlan = await buildFinalizeWeeklyPlan({
            connection,
            wallet: sessionWallet,
            weekly: previous,
            paymaster: paymaster.pubkey,
          });
          const signature = await submitSponsoredTransactionPlan({
            transactionPlan,
            wallet: sessionWallet,
            paymaster,
          });
          await connection.confirmTransaction(signature, "confirmed");
        }
      }
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
        const cashWinner = rank >= 0 && rank < claimable.cashWinnerCount;
        const starWinner =
          rank >= 0 && rank < claimable.cashWinnerCount + claimable.starWinnerCount;
        const transactionPlans = [];
        // Stars settle first so a cash transfer failure cannot strand the
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
              paymaster: paymaster.pubkey,
            }),
          );
        }
        if (cashWinner && !claimable.player.cashClaimed) {
          transactionPlans.push(
            await buildClaimWeeklyCashPlan({
              connection,
              wallet: sessionWallet,
              ownerAuthority: session.owner,
              sessionToken: session.sessionToken,
              weekly: claimable,
              paymaster: paymaster.pubkey,
            }),
          );
        }
        for (const transactionPlan of transactionPlans) {
          const signature = await submitSponsoredTransactionPlan({
            transactionPlan,
            wallet: sessionWallet,
            paymaster,
          });
          await connection.confirmTransaction(signature, "confirmed");
        }
      }
      // A week reaches its 90-day claim deadline roughly fourteen cadence
      // IDs later. This browser keeper is a fallback; operations also scan all
      // claimable weeks so an offline client cannot strand reserve funds.
      if (weekId >= 14) {
        const expiring = await fetchWeeklyView({
          connection,
          wallet,
          weekId: weekId - 14,
        });
        if (
          expiring?.status === "claimable" &&
          Math.floor(Date.now() / 1_000) > expiring.claimsCloseAt
        ) {
          const transactionPlan = await buildForfeitWeeklyCashPlan({
            connection,
            wallet: sessionWallet,
            weekly: expiring,
            paymaster: paymaster.pubkey,
          });
          const signature = await submitSponsoredTransactionPlan({
            transactionPlan,
            wallet: sessionWallet,
            paymaster,
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
  }, [connection, daily, player, refresh, wallet]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void maintain();
    const timer = globalThis.setInterval(() => void maintain(), 60_000);
    return () => globalThis.clearInterval(timer);
  }, [maintain]);

  const claim = useCallback(
    async (kind: "cash" | "stars") => {
      if (!weekly) throw new Error("Weekly rewards are not ready");
      const owner = player.publicKey;
      if (!owner) throw new Error("Connect a wallet before claiming rewards");
      const session = player.requireSession();
      const sessionWallet = new SessionWallet(session.signer);
      setAction(`claim:${kind}`);
      try {
        const paymaster = await fetchPaymasterClient(connection);
        const transactionPlan =
          kind === "cash"
            ? await buildClaimWeeklyCashPlan({
                connection,
                wallet: sessionWallet,
                ownerAuthority: owner,
                sessionToken: session.sessionToken,
                weekly,
                paymaster: paymaster.pubkey,
              })
            : await buildClaimWeeklyStarsPlan({
                connection,
                wallet: sessionWallet,
                ownerAuthority: owner,
                sessionToken: session.sessionToken,
                weekly,
                paymaster: paymaster.pubkey,
              });
        const signature = await submitSponsoredTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
          paymaster,
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
    claimCash: () => claim("cash"),
    claimStars: () => claim("stars"),
  };
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
