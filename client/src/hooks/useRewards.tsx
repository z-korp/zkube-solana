/* eslint-disable react-refresh/only-export-components */
import {
  default as React,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PublicKey, type AccountInfo } from "@solana/web3.js";

import {
  decodePlayerStateAccount,
  type CompetitionRecord,
  type PlayerStateView,
} from "@/chain/campaignClient";
import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useSolanaConnection } from "@/chain/connectionContext";
import {
  buildClaimDailyPrizePlan,
  currentDailyDayId,
  fetchUnclaimedRewards,
  type UnclaimedRewardView,
} from "@/chain/dailyClient";
import { derivePlayerStatePda } from "@/chain/pdas";
import { SessionWallet } from "@/backend/solana/session/sessionWallet";
import {
  detectSettlementEvents,
  PERIOD_LABELS,
  periodRecord,
  pickPrimaryEvent,
  type PeriodKind,
  type PeriodLabel,
  type SettlementEvent,
} from "@/chain/settlementEvents";
import {
  submitVersionedTransactionPlan,
  zkubeProgram,
} from "@/backend/solana/runs/runPlan";
import { useDaily } from "@/contexts/daily";
import { DEV_BYPASS_ACTIVE } from "@/dev/devBypass";
import { devUnclaimedRewards } from "@/dev/fixtures";
import {
  browserLocalStorage,
  type StorageLike,
} from "@/platform/browserStorage";
import { formatSolBalanceLamports } from "@/utils/currency";
import { errorMessage } from "@/utils/errors";

/** Both boards paid in the same burst, so neither board name alone is honest. */
export type PrizeLabel = PeriodLabel | "Daily";

export interface PrizeDelta {
  periodKind: PeriodKind | null;
  periodLabel: PrizeLabel;
  amountLamports: bigint;
  bestPrizeRank: number;
}

export interface PeriodSettlement {
  periodKind: PeriodKind;
  label: PeriodLabel;
  bestPrizeRank: number;
  podiums: number;
  wins: number;
  rewardsLamports: bigint;
  hasPrize: boolean;
}

export type NotificationPermissionState =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

export interface RewardsNotifications {
  supported: boolean;
  permission: NotificationPermissionState;
  enabled: boolean;
  preferenceEnabled: boolean;
  requestAndEnable: () => Promise<void>;
  disable: () => void;
}

export interface RewardsState {
  periods: PeriodSettlement[];
  totalRewardsLamports: bigint;
  latestEvent: SettlementEvent | null;
  prize: PrizeDelta | null;
  dismissPrize: () => void;
  unclaimed: UnclaimedRewardView[];
  unclaimedLamports: bigint;
  loading: boolean;
  claiming: boolean;
  error: string | null;
  claim: (reward: UnclaimedRewardView) => Promise<bigint>;
  refresh: () => Promise<void>;
  notifications: RewardsNotifications;
}

const EMPTY_RECORD: CompetitionRecord = {
  bestPrizeRank: 0,
  podiums: 0,
  wins: 0,
  rewardsLamports: 0n,
};
const PERIODS: readonly { kind: PeriodKind; label: PeriodLabel }[] = [
  { kind: 0, label: PERIOD_LABELS[0] },
  { kind: 1, label: PERIOD_LABELS[1] },
];

// One reward baseline drives the in-app ceremony and the optional local alert.
const REWARDS_SEEN_KEY_PREFIX = "zkube:v5:rewards-seen:";
const NOTIFICATIONS_ENABLED_KEY = "zkube:v5:notifications-enabled";
const DAILY_OPEN_SEEN_KEY = "zkube:v5:daily-open-seen";
const NOTIFICATION_ICON = "/assets/pwa-192x192.png";

const RewardsContext = createContext<RewardsState | null>(null);

function readSeen(storage: StorageLike, key: string): bigint | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function currentPermission(): NotificationPermissionState {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

function fallbackNotify(title: string, options?: NotificationOptions): void {
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      try {
        window.focus();
      } finally {
        notification.close();
      }
    };
  } catch {
    // A local courtesy alert never affects a claim or a payout.
  }
}

function toPeriod(
  kind: PeriodKind,
  label: PeriodLabel,
  record: CompetitionRecord,
): PeriodSettlement {
  return {
    periodKind: kind,
    label,
    bestPrizeRank: record.bestPrizeRank,
    podiums: record.podiums,
    wins: record.wins,
    rewardsLamports: record.rewardsLamports,
    hasPrize: record.bestPrizeRank > 0 || record.rewardsLamports > 0n,
  };
}

export function RewardsProvider({ children }: { children: ReactNode }) {
  const { connection } = useSolanaConnection();
  const player = useConnectedPlayer();
  const owner = player.publicKey;
  const ownerKey = owner?.toBase58() ?? null;
  const wallet = player.readOnlyWallet;
  const { daily } = useDaily();

  const [view, setView] = useState<PlayerStateView | null>(null);
  const [latestEvent, setLatestEvent] = useState<SettlementEvent | null>(null);
  const [profileReady, setProfileReady] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const previousRef = useRef<PlayerStateView | null>(null);
  const refreshProfileRef = useRef<() => Promise<PlayerStateView | null>>(
    async () => null,
  );

  useEffect(() => {
    previousRef.current = null;
    setView(null);
    setLatestEvent(null);
    setProfileReady(false);
    setProfileError(null);

    if (!ownerKey) {
      setProfileLoading(false);
      refreshProfileRef.current = async () => null;
      return;
    }

    let cancelled = false;
    const ownerPk = new PublicKey(ownerKey);
    const address = derivePlayerStatePda(ownerPk);
    const program = zkubeProgram(connection, wallet);

    const apply = (info: AccountInfo<Buffer> | null): PlayerStateView | null => {
      if (cancelled) return null;
      if (!info) {
        previousRef.current = null;
        setView(null);
        setProfileReady(true);
        return null;
      }
      let decoded: PlayerStateView;
      try {
        decoded = decodePlayerStateAccount(program, address, ownerPk, info);
      } catch {
        return null;
      }
      const events = detectSettlementEvents(previousRef.current, decoded);
      previousRef.current = decoded;
      setView(decoded);
      setProfileReady(true);
      const primary = pickPrimaryEvent(events);
      if (primary) setLatestEvent(primary);
      return decoded;
    };

    const fetchOnce = async (): Promise<PlayerStateView | null> => {
      if (cancelled) return null;
      setProfileLoading(true);
      try {
        const info = await connection.getAccountInfo(address, "confirmed");
        const decoded = apply(info);
        if (!cancelled) setProfileError(null);
        return decoded;
      } catch (cause) {
        if (!cancelled) setProfileError(errorMessage(cause));
        return null;
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };
    refreshProfileRef.current = fetchOnce;

    let subscriptionId: number | null = null;
    try {
      subscriptionId = connection.onAccountChange(address, apply, "confirmed");
    } catch (cause) {
      setProfileError(errorMessage(cause));
    }
    void fetchOnce();

    return () => {
      cancelled = true;
      refreshProfileRef.current = async () => null;
      if (subscriptionId !== null) {
        void connection.removeAccountChangeListener(subscriptionId);
      }
    };
  }, [connection, ownerKey, wallet]);

  const score = view ? periodRecord(view, 0) : EMPTY_RECORD;
  const theme = view ? periodRecord(view, 1) : EMPTY_RECORD;
  const periods = useMemo<PeriodSettlement[]>(() => {
    const records: Record<PeriodKind, CompetitionRecord> = { 0: score, 1: theme };
    return PERIODS.map(({ kind, label }) => toPeriod(kind, label, records[kind]));
  }, [score, theme]);
  const totalRewardsLamports = score.rewardsLamports + theme.rewardsLamports;
  const bestPrizeRank = periods.reduce(
    (best, period) =>
      period.bestPrizeRank > 0 && (best === 0 || period.bestPrizeRank < best)
        ? period.bestPrizeRank
        : best,
    0,
  );

  const [permission, setPermission] = useState<NotificationPermissionState>(
    () => currentPermission(),
  );
  const [preferenceEnabled, setPreferenceEnabled] = useState(
    () =>
      browserLocalStorage()?.getItem(NOTIFICATIONS_ENABLED_KEY) === "1",
  );
  const enabled = preferenceEnabled && permission === "granted";
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    if (!enabledRef.current || Notification.permission !== "granted") return;
    const notificationOptions = {
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      ...options,
    };
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      void navigator.serviceWorker.ready
        .then((registration) =>
          registration.showNotification(title, notificationOptions),
        )
        .catch(() => fallbackNotify(title, notificationOptions));
      return;
    }
    fallbackNotify(title, notificationOptions);
  }, []);

  const requestAndEnable = useCallback(async () => {
    if (!notificationsSupported()) {
      setPermission("unsupported");
      return;
    }
    let result: NotificationPermissionState;
    try {
      result = await Notification.requestPermission();
    } catch {
      result = Notification.permission;
    }
    setPermission(result);
    if (result === "granted") {
      setPreferenceEnabled(true);
      browserLocalStorage()?.setItem(NOTIFICATIONS_ENABLED_KEY, "1");
    }
  }, []);

  const disableNotifications = useCallback(() => {
    setPreferenceEnabled(false);
    browserLocalStorage()?.setItem(NOTIFICATIONS_ENABLED_KEY, "0");
  }, []);

  const [prize, setPrize] = useState<PrizeDelta | null>(null);
  useEffect(() => {
    if (!ownerKey || !profileReady || profileLoading || profileError) return;
    const storage = browserLocalStorage();
    if (!storage) return;
    const key = `${REWARDS_SEEN_KEY_PREFIX}${ownerKey}`;
    const seen = readSeen(storage, key);
    if (seen === null) {
      storage.setItem(key, totalRewardsLamports.toString());
      return;
    }
    const delta = totalRewardsLamports - seen;
    if (delta <= 0n) return;
    storage.setItem(key, totalRewardsLamports.toString());
    const periodKind = latestEvent?.periodKind ?? null;
    setPrize({
      periodKind,
      periodLabel:
        periodKind === null ? "Daily" : PERIOD_LABELS[periodKind],
      amountLamports: delta,
      bestPrizeRank: latestEvent?.bestPrizeRank ?? bestPrizeRank,
    });
    notify(`You won ${formatSolBalanceLamports(delta)} SOL`, {
      body: `${periodKind === null ? "Daily" : PERIOD_LABELS[periodKind]} prize is ready.`,
      tag: `zkube-prize-${periodKind ?? "daily"}-${totalRewardsLamports}`,
      data: { url: "/" },
    });
  }, [
    bestPrizeRank,
    latestEvent,
    notify,
    ownerKey,
    profileError,
    profileLoading,
    profileReady,
    totalRewardsLamports,
  ]);
  const dismissPrize = useCallback(() => setPrize(null), []);

  const dailyStatus = daily?.status ?? null;
  const dailyDayId = daily?.dayId ?? null;
  const previousDailyStatus = useRef<string | null>(null);
  useEffect(() => {
    if (dailyStatus === null || dailyDayId === null) return;
    const storage = browserLocalStorage();
    if (!storage) return;
    const previous = previousDailyStatus.current;
    previousDailyStatus.current = dailyStatus;
    if (dailyStatus !== "open") return;
    const seenRaw = storage.getItem(DAILY_OPEN_SEEN_KEY);
    const seen = seenRaw === null ? null : Number(seenRaw);
    if (seen === dailyDayId) return;
    storage.setItem(DAILY_OPEN_SEEN_KEY, String(dailyDayId));
    if (previous === null && seen === null) return;
    notify("A new Daily is open", {
      body: "Today's ranked Arcade challenge is live.",
      tag: `zkube-daily-open-${dailyDayId}`,
      data: { url: "/" },
    });
  }, [dailyDayId, dailyStatus, notify]);

  const [unclaimed, setUnclaimed] = useState<UnclaimedRewardView[]>([]);
  const [unclaimedLoading, setUnclaimedLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const refreshUnclaimed = useCallback(async () => {
    if (!owner) {
      setUnclaimed([]);
      return;
    }
    if (import.meta.env.DEV && DEV_BYPASS_ACTIVE) {
      setUnclaimed(devUnclaimedRewards());
      return;
    }
    setUnclaimedLoading(true);
    try {
      setUnclaimed(
        await fetchUnclaimedRewards({
          connection,
          owner,
          currentDayId: currentDailyDayId(),
        }),
      );
      setClaimError(null);
    } catch {
      setUnclaimed([]);
    } finally {
      setUnclaimedLoading(false);
    }
  }, [connection, owner]);

  useEffect(() => {
    void refreshUnclaimed();
  }, [refreshUnclaimed]);

  const claim = useCallback(
    async (reward: UnclaimedRewardView) => {
      if (!owner) throw new Error("Connect a wallet before collecting");
      const device = player.requireSession();
      const sessionWallet = new SessionWallet(device.signer);
      setClaiming(true);
      setClaimError(null);
      try {
        const transactionPlan = await buildClaimDailyPrizePlan({
          connection,
          wallet: sessionWallet,
          ownerAuthority: owner,
          sessionToken: device.sessionToken,
          dayId: reward.dayId,
          board: reward.board,
          position: reward.position,
        });
        const signature = await submitVersionedTransactionPlan({
          transactionPlan,
          wallet: sessionWallet,
        });
        await connection.confirmTransaction(signature, "confirmed");
        await player.refreshBalance();
        await refreshUnclaimed();
        return reward.amountLamports;
      } catch (cause) {
        setClaimError(errorMessage(cause));
        throw cause;
      } finally {
        setClaiming(false);
      }
    },
    [connection, owner, player, refreshUnclaimed],
  );

  const refresh = useCallback(async () => {
    await Promise.all([refreshProfileRef.current(), refreshUnclaimed()]);
  }, [refreshUnclaimed]);

  const value = useMemo<RewardsState>(
    () => ({
      periods,
      totalRewardsLamports,
      latestEvent,
      prize,
      dismissPrize,
      unclaimed,
      unclaimedLamports: unclaimed.reduce(
        (total, reward) => total + reward.amountLamports,
        0n,
      ),
      loading: profileLoading || unclaimedLoading,
      claiming,
      error: profileError ?? claimError,
      claim,
      refresh,
      notifications: {
        supported: permission !== "unsupported",
        permission,
        enabled,
        preferenceEnabled,
        requestAndEnable,
        disable: disableNotifications,
      },
    }),
    [
      claim,
      claiming,
      claimError,
      disableNotifications,
      dismissPrize,
      enabled,
      latestEvent,
      periods,
      permission,
      preferenceEnabled,
      prize,
      profileError,
      profileLoading,
      refresh,
      requestAndEnable,
      totalRewardsLamports,
      unclaimed,
      unclaimedLoading,
    ],
  );

  return React.createElement(RewardsContext.Provider, { value }, children);
}

export function useRewards(): RewardsState {
  const rewards = useContext(RewardsContext);
  if (!rewards) throw new Error("useRewards must be used within RewardsProvider");
  return rewards;
}
