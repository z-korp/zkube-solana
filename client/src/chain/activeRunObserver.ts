import type { Connection, PublicKey } from "@solana/web3.js";

export type ActiveRunUpdateSource = "initial" | "websocket" | "fallback";

export interface ActiveRunObserverDiagnostic {
  event:
    | "decode-error"
    | "initial-error"
    | "fallback-error"
    | "subscribe-error";
  error: string;
}

interface StateUpdate<T> {
  state: T;
  source: ActiveRunUpdateSource;
}

/**
 * One subscription per delegated ActiveRun. WebSocket account data is decoded
 * directly, avoiding the old notification -> getAccountInfo RPC round trip.
 * A short fallback read exists only while a caller is waiting for a state
 * transition, so healthy gameplay does not poll continuously.
 */
export class ActiveRunObserver<T> {
  private subscriptionId: number | null = null;
  private startPromise: Promise<void> | null = null;
  private current: StateUpdate<T> | null = null;
  private readonly listeners = new Set<(update: StateUpdate<T>) => void>();

  constructor(
    private readonly connection: Connection,
    private readonly address: PublicKey,
    private readonly decode: (data: Buffer, owner: PublicKey) => T,
    private readonly fetch: () => Promise<T | null>,
    private readonly onDiagnostic?: (
      diagnostic: ActiveRunObserverDiagnostic,
    ) => void,
  ) {}

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  latest(): T | null {
    return this.current?.state ?? null;
  }

  async waitFor(
    predicate: (state: T) => boolean,
    options: {
      timeoutMs: number;
      timeoutMessage: string;
      fallbackPollMs?: number;
    },
  ): Promise<StateUpdate<T>> {
    await this.start();
    if (this.current && predicate(this.current.state)) {
      return this.current;
    }

    const fallbackPollMs = options.fallbackPollMs ?? 250;
    return new Promise<StateUpdate<T>>((resolve, reject) => {
      let checkingFallback = false;
      let settled = false;
      let fallback: ReturnType<typeof setInterval> | null = null;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (fallback) clearInterval(fallback);
        this.listeners.delete(onUpdate);
      };
      const finish = (update: StateUpdate<T>) => {
        if (settled || !predicate(update.state)) return;
        settled = true;
        cleanup();
        resolve(update);
      };
      const onUpdate = (update: StateUpdate<T>) => finish(update);
      this.listeners.add(onUpdate);
      // Close the tiny race between the check above and listener insertion.
      if (this.current) finish(this.current);
      if (settled) return;

      fallback = setInterval(() => {
        if (checkingFallback) return;
        checkingFallback = true;
        void this.fetch()
          .then((state) => {
            if (state) this.publish(state, "fallback");
          })
          .catch((error: unknown) => this.diagnostic("fallback-error", error))
          .finally(() => {
            checkingFallback = false;
          });
      }, fallbackPollMs);
      timeout = setTimeout(() => {
        settled = true;
        cleanup();
        reject(new Error(options.timeoutMessage));
      }, options.timeoutMs);
    });
  }

  async close(): Promise<void> {
    const id = this.subscriptionId;
    this.subscriptionId = null;
    this.startPromise = null;
    this.current = null;
    this.listeners.clear();
    if (id !== null) {
      await this.connection
        .removeAccountChangeListener(id)
        .catch(() => undefined);
    }
  }

  private async startInternal(): Promise<void> {
    try {
      this.subscriptionId = this.connection.onAccountChange(
        this.address,
        (info) => {
          try {
            this.publish(this.decode(info.data, info.owner), "websocket");
          } catch (error) {
            this.diagnostic("decode-error", error);
          }
        },
        "confirmed",
      );
    } catch (error) {
      this.diagnostic("subscribe-error", error);
    }

    try {
      const initial = await this.fetch();
      if (initial) this.publish(initial, "initial");
    } catch (error) {
      // A working account subscription or the bounded fallback can still
      // recover from one failed initial read. Do not poison startPromise.
      this.diagnostic("initial-error", error);
    }
  }

  private publish(state: T, source: ActiveRunUpdateSource): void {
    const update = { state, source };
    this.current = update;
    for (const listener of this.listeners) listener(update);
  }

  private diagnostic(
    event: ActiveRunObserverDiagnostic["event"],
    error: unknown,
  ): void {
    this.onDiagnostic?.({
      event,
      error: (error instanceof Error ? error.message : String(error)).slice(
        0,
        200,
      ),
    });
  }
}
