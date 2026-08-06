import { useCallback, useEffect, useRef, useState } from "react";

import { useConnectedPlayer } from "@/chain/connectedPlayerContext";
import { useDaily } from "@/contexts/daily";
import { PERIOD_LABELS, type PeriodKind } from "@/chain/settlementEvents";
import { useSettlementResult } from "@/hooks/useSettlementResult";
import {
  browserLocalStorage,
  type StorageLike,
} from "@/platform/browserStorage";
import { formatSolBalanceLamports } from "@/utils/currency";

/**
 * useNotifications — opt-in, LOCAL / in-session browser notifications.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * REMOTE / BACKGROUND PUSH IS OUT OF SCOPE (and cannot be faked here).
 * ───────────────────────────────────────────────────────────────────────────
 * zKube v4 is a static PWA/TWA with NO server signer and NO backend. True
 * remote push — a notification delivered while the app (and its tab/PWA) is
 * fully closed — requires all of:
 *   1. a Web Push server holding VAPID keys that signs and POSTs to the
 *      browser's push endpoint, and
 *   2. a `PushSubscription` (`pushManager.subscribe`) + a `push` event handler
 *      in the service worker, and
 *   3. somewhere durable to store subscriptions and something server-side that
 *      decides when to send (e.g. off the keeper's settlement writes).
 * We run none of that, so this hook is strictly LOCAL: it can only raise a
 * notification while this page (or its service worker, kept briefly alive by
 * the browser) is running. Delivery is therefore best-effort and in-session
 * only — never presented to the user as a guaranteed background alert.
 *
 * TODO(remote-push): if/when a push server exists (out of the static-client
 * scope defined in CLAUDE.md — Fly only runs the Daily/Weekly/Season keeper,
 * not a signer for clients), wire `pushManager.subscribe` here and a `push`
 * handler in `public/sw.js`, and register the subscription with that server.
 *
 * SCOPE NOTE: the reward + Daily-open observers below only run while THIS hook
 * is mounted. It is mounted once at the app root (App.tsx), so events fire for
 * the whole in-session lifetime; the Settings sheet mounts it again only for
 * the opt-out toggle. Either way it remains local/in-session (see above).
 */

export type NotificationPermissionState =
  | "unsupported"
  | "default"
  | "granted"
  | "denied";

/** Device-scoped opt-in preference — a browser/device setting, not per-wallet. */
const PREF_KEY = "zkube:v4:notifications-enabled";
/**
 * Per-wallet last-seen reward totals for the LOCAL "you won" notification.
 * Deliberately a SEPARATE baseline from `usePrizeDeltaTrigger`'s
 * `zkube:v4:rewards-seen:` key, so this notification fires independently of the
 * in-app prize celebration UI and neither can consume the other's signal.
 */
const REWARDS_SEEN_KEY_PREFIX = "zkube:v4:notify-rewards-seen:";
/** Last Daily dayId already announced as "open" (dedupes across reloads). */
const DAILY_OPEN_KEY = "zkube:v4:notify-daily-open";

/** Icon shipped in the manifest; safe to reuse for the notification chrome. */
const NOTIFICATION_ICON = "/assets/pwa-192x192.png";

function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

function currentPermission(): NotificationPermissionState {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

type SeenTriplet = [bigint, bigint, bigint];

function readSeen(storage: StorageLike, key: string): SeenTriplet | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { d?: unknown }).d !== "string" ||
      typeof (parsed as { w?: unknown }).w !== "string" ||
      typeof (parsed as { s?: unknown }).s !== "string"
    ) {
      return null;
    }
    const record = parsed as { d: string; w: string; s: string };
    return [BigInt(record.d), BigInt(record.w), BigInt(record.s)];
  } catch {
    return null;
  }
}

function writeSeen(storage: StorageLike, key: string, value: SeenTriplet): void {
  storage.setItem(
    key,
    JSON.stringify({
      d: value[0].toString(),
      w: value[1].toString(),
      s: value[2].toString(),
    }),
  );
}

function fallbackNotify(title: string, options?: NotificationOptions): void {
  try {
    // Page-level Notification (used when no service worker controls the page,
    // e.g. dev without a registered SW). Wire click-to-focus so it mirrors the
    // service worker's `notificationclick` handler.
    const notification = new Notification(title, options);
    notification.onclick = () => {
      try {
        window.focus();
      } finally {
        notification.close();
      }
    };
  } catch {
    // Some environments (certain Android WebViews) throw on the `Notification`
    // constructor even when permission is granted; the SW path is preferred
    // there. A missed local notification is never fatal, so swallow.
  }
}

export interface NotificationsController {
  /** Whether the browser exposes the Notification API at all. */
  supported: boolean;
  /** Live browser permission (`unsupported` when the API is absent). */
  permission: NotificationPermissionState;
  /** Effective state: the user opted in AND the browser granted permission. */
  enabled: boolean;
  /** User opt-in (persisted), independent of the live permission grant. */
  preferenceEnabled: boolean;
  /** Request browser permission and, on grant, persist the opt-in. */
  requestAndEnable: () => Promise<void>;
  /** Clear the opt-in (cannot revoke the browser-level grant from script). */
  disable: () => void;
}

export function useNotifications(): NotificationsController {
  const [permission, setPermission] = useState<NotificationPermissionState>(
    () => currentPermission(),
  );
  const [preferenceEnabled, setPreferenceEnabled] = useState<boolean>(() => {
    return browserLocalStorage()?.getItem(PREF_KEY) === "1";
  });

  const supported = permission !== "unsupported";
  const enabled = preferenceEnabled && permission === "granted";

  // Stable gate for the notify() closure so it always reads the latest state
  // without being re-created (and re-triggering the observer effects).
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const notify = useCallback((title: string, options?: NotificationOptions) => {
    // Opt-out and permission are both honored here — the single choke point.
    if (!enabledRef.current) return;
    if (!notificationsSupported() || Notification.permission !== "granted") {
      return;
    }

    const opts: NotificationOptions = {
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_ICON,
      ...options,
    };

    // Prefer the service-worker registration when one is actively controlling
    // the page: its notifications persist and can be re-focused via the SW's
    // `notificationclick` handler. This is still LOCAL — the SW only runs while
    // the browser keeps it alive; there is no push server (see file header).
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      void navigator.serviceWorker.ready
        .then((registration) => registration.showNotification(title, opts))
        .catch(() => fallbackNotify(title, opts));
      return;
    }
    fallbackNotify(title, opts);
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
      // Legacy Safari used a callback signature; fall back to the sync value.
      result = Notification.permission;
    }
    setPermission(result);
    if (result === "granted") {
      setPreferenceEnabled(true);
      browserLocalStorage()?.setItem(PREF_KEY, "1");
    }
  }, []);

  const disable = useCallback(() => {
    setPreferenceEnabled(false);
    browserLocalStorage()?.setItem(PREF_KEY, "0");
    // The browser-level permission grant cannot be revoked from script — the
    // user does that in browser settings. Disabling only stops us from firing.
  }, []);

  // ── Observer 1: a pushed prize newly landed → "You won X SOL" ──────────────
  // Driven by `useSettlementResult` (a real-time PlayerState subscription). A
  // period's lifetime rewards can only grow from a genuine keeper settlement
  // push, so an increase is always a real paid win — never fabricated. Baseline
  // is per-wallet and advanced even while disabled, so enabling later never
  // retroactively fires historical wins.
  const { publicKey } = useConnectedPlayer();
  const address = publicKey?.toBase58() ?? null;
  const { periods, loading, error } = useSettlementResult();
  const dailyRewards = periods[0]?.rewardsLamports ?? 0n;
  const weeklyRewards = periods[1]?.rewardsLamports ?? 0n;
  const seasonRewards = periods[2]?.rewardsLamports ?? 0n;

  useEffect(() => {
    // Never trust an in-flight or failed read; money never gates on it either.
    if (!address || loading || error) return;
    const storage = browserLocalStorage();
    if (!storage) return;

    const key = `${REWARDS_SEEN_KEY_PREFIX}${address}`;
    const current: SeenTriplet = [dailyRewards, weeklyRewards, seasonRewards];
    const seen = readSeen(storage, key);

    // First observation for this wallet — baseline silently, congratulate
    // nothing (a returning winner is never falsely re-congratulated).
    if (seen === null) {
      writeSeen(storage, key, current);
      return;
    }

    // Advance every grown period at once so a burst that pays several boards is
    // never double-counted later; announce the single largest genuine increase.
    const next: SeenTriplet = [seen[0], seen[1], seen[2]];
    let bestKind: PeriodKind | null = null;
    let bestDelta = 0n;
    for (const kind of [0, 1, 2] as const) {
      const delta = current[kind] - seen[kind];
      if (delta > 0n) {
        next[kind] = current[kind];
        if (delta > bestDelta) {
          bestDelta = delta;
          bestKind = kind;
        }
      }
    }
    if (bestKind === null) return;

    // Persist before firing so a re-render or reload never re-announces it.
    writeSeen(storage, key, next);
    notify(`You won ${formatSolBalanceLamports(bestDelta)} SOL`, {
      body: `${PERIOD_LABELS[bestKind]} prize settled to your wallet.`,
      // OS-level dedupe key, independent of our storage baseline.
      tag: `zkube-prize-${bestKind}-${current[bestKind].toString()}`,
      data: { url: "/" },
    });
  }, [
    address,
    loading,
    error,
    dailyRewards,
    weeklyRewards,
    seasonRewards,
    notify,
  ]);

  // ── Observer 2: the Daily transitioning to open → "A new Daily is open" ────
  // Guarded by a persisted last-announced dayId (survives reloads/re-renders)
  // plus an in-session previous-status ref, so it fires on a genuine transition
  // — a within-session flip into "open", or a returning app on a new day — but
  // never on the very first observation of an already-open day, and never twice
  // for the same day.
  const { daily } = useDaily();
  const dailyStatus = daily?.status ?? null;
  const dailyDayId = daily?.dayId ?? null;
  const prevDailyStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (dailyStatus === null || dailyDayId === null) return;
    const storage = browserLocalStorage();
    if (!storage) return;

    const prevStatus = prevDailyStatusRef.current;
    prevDailyStatusRef.current = dailyStatus;

    if (dailyStatus !== "open") return;

    const lastRaw = storage.getItem(DAILY_OPEN_KEY);
    const last = lastRaw === null ? null : Number(lastRaw);

    // Already announced this exact day (survives reloads / StrictMode remounts).
    if (last === dailyDayId) return;

    // Persist the day id up front so a re-render never re-announces it.
    storage.setItem(DAILY_OPEN_KEY, String(dailyDayId));

    // First observation ever (no session history, no stored day): the day was
    // already open when the app loaded — baseline silently, do not announce.
    if (prevStatus === null && last === null) return;

    notify("A new Daily is open", {
      body: "Today's ranked Arena challenge is live.",
      tag: `zkube-daily-open-${dailyDayId}`,
      data: { url: "/" },
    });
  }, [dailyStatus, dailyDayId, notify]);

  return {
    supported,
    permission,
    enabled,
    preferenceEnabled,
    requestAndEnable,
    disable,
  };
}
