import type { Connection, PublicKey } from "@solana/web3.js";
import { errorMessage } from "@/utils/errors";
import type { ResumedRun } from "./resumeRun";

export type RunWatchPhase = "resolving" | "subscribed" | "reconnecting" | "stopped";

export interface RunWatchStatus {
  phase: RunWatchPhase;
  attempt: number;
  error?: string;
}

export interface RunWatchBindTarget {
  connection: Connection;
  address: PublicKey;
}

interface RunWatcherOptions<T> {
  resolve: () => Promise<T>;
  onState: (state: T) => void;
  onStatus?: (status: RunWatchStatus) => void;
  pollMs?: number;
  maxBackoffMs?: number;
  /** Where to attach the account subscription; defaults to the persisted-run
   *  marker binding. Return null to keep polling without a subscription. */
  bindTarget?: (state: T) => RunWatchBindTarget | null;
}

function defaultResumedRunTarget(state: ResumedRun): RunWatchBindTarget | null {
  if (
    state.phase !== "delegated" &&
    state.phase !== "base" &&
    state.phase !== "settleable"
  ) {
    return null;
  }
  return {
    connection: state.connection,
    address: state.marker.addresses.activeRun,
  };
}

/**
 * Keeps a live run attached across websocket and ER-route changes. Account
 * notifications trigger a fresh authoritative decode; a low-frequency router
 * re-resolution replaces stale subscriptions after ER migration or socket loss.
 */
export class PersistedRunWatcher<T = ResumedRun> {
  private stopped = true;
  private refreshing = false;
  private refreshQueued = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private subscription: { connection: Connection; id: number } | null = null;
  private readonly bindTarget: (state: T) => RunWatchBindTarget | null;

  constructor(private readonly options: RunWatcherOptions<T>) {
    this.bindTarget =
      options.bindTarget ??
      (defaultResumedRunTarget as unknown as (
        state: T,
      ) => RunWatchBindTarget | null);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.emit("resolving", 0);
    void this.refresh();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.clearSubscription();
    this.emit("stopped", 0);
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.refreshing) {
      this.refreshQueued = true;
      return;
    }
    this.refreshing = true;
    try {
      const state = await this.options.resolve();
      if (this.stopped) return;
      this.options.onState(state);
      await this.bind(state);
      this.attempt = 0;
      this.emit("subscribed", 0);
      this.schedule(this.options.pollMs ?? 5_000);
    } catch (error) {
      if (this.stopped) return;
      this.attempt += 1;
      this.emit(
        "reconnecting",
        this.attempt,
        errorMessage(error),
      );
      const backoff = Math.min(
        (this.options.pollMs ?? 5_000) * 2 ** Math.min(this.attempt - 1, 4),
        this.options.maxBackoffMs ?? 30_000,
      );
      this.schedule(backoff);
    } finally {
      this.refreshing = false;
      if (this.refreshQueued && !this.stopped) {
        this.refreshQueued = false;
        void this.refresh();
      }
    }
  }

  private async bind(state: T): Promise<void> {
    const target = this.bindTarget(state);
    if (!target) {
      await this.clearSubscription();
      return;
    }
    if (this.subscription?.connection === target.connection) return;
    await this.clearSubscription();
    const id = target.connection.onAccountChange(
      target.address,
      () => void this.refresh(),
      "confirmed",
    );
    this.subscription = { connection: target.connection, id };
  }

  private async clearSubscription(): Promise<void> {
    const subscription = this.subscription;
    this.subscription = null;
    if (!subscription) return;
    try {
      await subscription.connection.removeAccountChangeListener(subscription.id);
    } catch {
      // A dead websocket is exactly why the router reconciliation loop exists.
    }
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }

  private emit(phase: RunWatchPhase, attempt: number, error?: string): void {
    this.options.onStatus?.({ phase, attempt, ...(error ? { error } : {}) });
  }
}
