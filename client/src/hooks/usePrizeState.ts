import { useCallback, useEffect, useState } from "react";

import { useClientState } from "@/backend/client";
import { appStorage } from "@/platform/storage";

export type PrizeLabel = "Score" | "Theme" | "Daily";

export interface PrizeDelta {
  periodLabel: PrizeLabel;
  amountLamports: bigint;
  bestPrizeRank: number;
}

const REWARDS_SEEN_KEY_PREFIX = "zkube:v5:rewards-seen:";
const NOTIFICATIONS_ENABLED_KEY = "zkube:v5:notifications-enabled";

/** Detects a newly observed aggregate reward from the Economy projection. */
export function usePrizeCeremony() {
  const { identity, economy } = useClientState();
  const [prize, setPrize] = useState<PrizeDelta | null>(null);
  const total =
    economy.profile.records.score.rewardsLamports +
    economy.profile.records.theme.rewardsLamports;

  useEffect(() => {
    if (!identity.address) return;
    const storage = appStorage();
    if (!storage) return;
    const key = `${REWARDS_SEEN_KEY_PREFIX}${identity.address}`;
    const previous = storage.getItem(key);
    storage.setItem(key, total.toString());
    if (previous === null) return;
    let seen: bigint;
    try {
      seen = BigInt(previous);
    } catch {
      return;
    }
    const delta = total - seen;
    if (delta <= 0n) return;
    const ranks = [
      economy.profile.records.score.bestPrizeRank,
      economy.profile.records.theme.bestPrizeRank,
    ].filter((rank) => rank > 0);
    setPrize({
      periodLabel: "Daily",
      amountLamports: delta,
      bestPrizeRank: ranks.length > 0 ? Math.min(...ranks) : 0,
    });
  }, [economy.profile.records, identity.address, total]);

  return {
    prize,
    dismissPrize: useCallback(() => setPrize(null), []),
  };
}

export type NotificationPermissionState =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

function notificationPermission(): NotificationPermissionState {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "unsupported";
}

/** Browser-local courtesy-alert preference; it has no protocol authority. */
export function useNotificationPreference() {
  const [permission, setPermission] = useState(notificationPermission);
  const [preferenceEnabled, setPreferenceEnabled] = useState(
    () => appStorage()?.getItem(NOTIFICATIONS_ENABLED_KEY) === "1",
  );
  const requestAndEnable = useCallback(async () => {
    if (notificationPermission() === "unsupported") return;
    const next = await Notification.requestPermission().catch(
      () => Notification.permission,
    );
    setPermission(next);
    if (next === "granted") {
      setPreferenceEnabled(true);
      appStorage()?.setItem(NOTIFICATIONS_ENABLED_KEY, "1");
    }
  }, []);
  const disable = useCallback(() => {
    setPreferenceEnabled(false);
    appStorage()?.setItem(NOTIFICATIONS_ENABLED_KEY, "0");
  }, []);
  return {
    supported: permission !== "unsupported",
    permission,
    enabled: preferenceEnabled && permission === "granted",
    preferenceEnabled,
    requestAndEnable,
    disable,
  };
}
