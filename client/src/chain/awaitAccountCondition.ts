import type { Connection, PublicKey } from "@solana/web3.js";

export interface AwaitAccountConditionOptions {
  connection: Connection;
  address: PublicKey;
  /**
   * Re-checked once up front, on every account notification, and on each slow
   * fallback tick. Return true to resolve. Transient throws are swallowed —
   * the next notification / fallback tick retries.
   */
  isSatisfied: () => Promise<boolean>;
  timeoutMs: number;
  timeoutMessage: string;
  /** Dropped-socket safety net only (default 1000ms) — not the primary driver. */
  fallbackPollMs?: number;
}

/**
 * Resolve as soon as `isSatisfied()` becomes true, driven by a websocket account
 * subscription (`connection.onAccountChange`) rather than a tight poll: the
 * account flips, the notification fires, we re-check and resolve immediately.
 *
 * The predicate is checked once synchronously up front (covers an already-
 * satisfied account and the subscribe race), on every notification, and on a
 * slow fallback interval that exists purely as a safety net if the socket
 * drops. Rejects with `timeoutMessage` after `timeoutMs`. Subscription,
 * interval and timer are always torn down — same discipline as
 * PersistedRunWatcher (runWatcher.ts).
 */
export function awaitAccountCondition(
  options: AwaitAccountConditionOptions,
): Promise<void> {
  const { connection, address, isSatisfied, timeoutMs, timeoutMessage } =
    options;
  const fallbackPollMs = options.fallbackPollMs ?? 1_000;

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    let checking = false;
    let subscriptionId: number | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (subscriptionId !== null) {
        const id = subscriptionId;
        subscriptionId = null;
        void connection.removeAccountChangeListener(id).catch(() => {
          // A dead socket is exactly what the timeout/fallback guard against.
        });
      }
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };

    const check = async () => {
      if (settled || checking) return;
      checking = true;
      try {
        if (await isSatisfied()) finish();
      } catch {
        // Transient read failure — a later notification / fallback tick retries.
      } finally {
        checking = false;
      }
    };

    timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
    interval = setInterval(() => void check(), fallbackPollMs);
    try {
      subscriptionId = connection.onAccountChange(
        address,
        () => void check(),
        "confirmed",
      );
    } catch {
      // If subscribe throws, the fallback interval still drives the check.
    }
    void check();
  });
}
