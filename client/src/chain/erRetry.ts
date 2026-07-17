import { errorMessage } from "@/utils/errors";

export interface ErRetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * MagicBlock may report a short cloner/owner window immediately after
 * delegation. Retry only those transient pre-execution failures, matching the
 * cycling-sim browser/smoke boundary; deterministic program errors are never
 * retried.
 */
export async function withTransientErRetry<T>(
  action: () => Promise<T>,
  options: ErRetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 6;
  const baseDelayMs = options.baseDelayMs ?? 400;
  const maxDelayMs = options.maxDelayMs ?? 3_000;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (!isTransientErError(error) || attempt === attempts) throw error;
      await sleep(Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs));
    }
  }
  throw lastError;
}

export function isTransientErError(error: unknown): boolean {
  const message = errorMessage(error);
  return /cloner|pending request owner|account.*not found|blockhash not found/i.test(
    message,
  );
}
