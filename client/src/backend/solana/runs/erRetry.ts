import { Duration, Effect, Schedule } from "effect";

import { errorMessage } from "../../../utils/errors";

export interface ErRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/** Retry only transient pre-execution ER failures on the bounded legacy schedule. */
export function withTransientErRetry<T>(
  action: () => Promise<T>,
  options: ErRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 3_000;
  const schedule = Schedule.exponential(Duration.millis(baseDelayMs)).pipe(
    Schedule.modifyDelay((_, delay) =>
      Duration.min(delay, Duration.millis(maxDelayMs)),
    ),
  );
  return Effect.runPromise(
    Effect.tryPromise({
      try: action,
      catch: (cause) => cause,
    }).pipe(
      Effect.retry({
        times: Math.max(0, attempts - 1),
        schedule,
        while: isTransientErError,
      }),
    ),
  );
}

export function isTransientErError(error: unknown): boolean {
  const message = errorMessage(error);
  return /cloner|pending request owner|account.*not found|blockhash not found/i.test(
    message,
  );
}
