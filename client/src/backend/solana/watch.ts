import { Effect, Stream } from "effect";
import type {
  AccountInfo,
  Connection,
  Context,
  PublicKey,
} from "@solana/web3.js";

export type AccountUpdateSource = "initial" | "websocket" | "fallback";

export interface WatchedAccount<A> {
  readonly value: A | null;
  readonly slot: number;
  readonly source: AccountUpdateSource;
}

export interface WatchAccountOptions<A> {
  readonly connection: Connection;
  readonly address: PublicKey;
  readonly decode: (info: AccountInfo<Buffer> | null) => A | null;
  readonly fallbackPollMs?: number;
}

/**
 * One hot-stream source for a Solana account: subscribe first, read the
 * initial value, re-read slowly if the socket goes quiet, and release every
 * timer/subscription with the stream scope.
 */
export function watchAccount<A>(
  options: WatchAccountOptions<A>,
): Stream.Stream<WatchedAccount<A>> {
  return Stream.asyncScoped<WatchedAccount<A>>((emit) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let stopped = false;
        let reading = false;
        let subscriptionId: number | null = null;

        const publish = (
          info: AccountInfo<Buffer> | null,
          context: Context,
          source: AccountUpdateSource,
        ) => {
          if (!stopped) {
            void emit.single({
              value: options.decode(info),
              slot: context.slot,
              source,
            });
          }
        };
        const read = async (source: "initial" | "fallback") => {
          if (stopped || reading) return;
          reading = true;
          try {
            const response = await options.connection.getAccountInfoAndContext(
              options.address,
              "confirmed",
            );
            publish(response.value, response.context, source);
          } catch {
            // A later socket notification or fallback read can recover. The
            // stream remains alive because transient RPC loss is not account
            // state.
          } finally {
            reading = false;
          }
        };

        try {
          subscriptionId = options.connection.onAccountChange(
            options.address,
            (info, context) => publish(info, context, "websocket"),
            "confirmed",
          );
        } catch {
          // The fallback remains the safety net for a failed subscription.
        }
        const interval = globalThis.setInterval(
          () => void read("fallback"),
          options.fallbackPollMs ?? 5_000,
        );
        // Subscription is already installed, closing the initial-read race.
        void read("initial");
        return {
          stop: async () => {
            stopped = true;
            globalThis.clearInterval(interval);
            if (subscriptionId !== null) {
              await options.connection
                .removeAccountChangeListener(subscriptionId)
                .catch(() => undefined);
            }
          },
        };
      }),
      (resource) => Effect.promise(() => resource.stop()),
    ),
  );
}
