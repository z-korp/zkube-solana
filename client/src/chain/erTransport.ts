import type {
  BlockhashWithExpiryBlockHeight,
  Connection,
} from "@solana/web3.js";
import { Transaction } from "@solana/web3.js";
import { errorMessage } from "@/utils/errors";
import type { TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";

const BLOCKHASH_CACHE_MS = 10_000;

interface CachedBlockhash extends BlockhashWithExpiryBlockHeight {
  fetchedAt: number;
}

const blockhashByEndpoint = new Map<string, CachedBlockhash>();

interface ErSubmissionTiming {
  totalMs: number;
  blockhashMs: number;
  signMs: number;
  sendMs: number;
  confirmMs: number;
  blockhashCacheHit: boolean;
  blockhashRefreshes: number;
}

export interface ErSubmissionResult {
  signature: string;
  timing: ErSubmissionTiming;
}

/**
 * Warm the short-lived blockhash cache as soon as Router resolution reveals
 * the ER. The cache is endpoint-scoped: blockhashes must never cross between
 * Solana base, Router, or different ER validators.
 */
export async function prewarmErTransport(connection: Connection): Promise<{
  durationMs: number;
  cacheHit: boolean;
}> {
  const startedAt = performance.now();
  const { cacheHit } = await getErBlockhash(connection, false);
  return { durationMs: performance.now() - startedAt, cacheHit };
}

/**
 * Fast path for session-signed transactions on a Router-resolved ER.
 *
 * MagicBlock recommends skipping preflight on ER transactions. Program
 * constraints remain authoritative, and confirmation errors are inspected
 * before success is returned. Base-layer transactions deliberately continue
 * to use the simulation-first submitters in runPlan.ts.
 */
export async function submitErTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
}): Promise<ErSubmissionResult> {
  const { transactionPlan } = args;
  if (transactionPlan.layer !== "magicblock-er") {
    throw new Error("Fast ER submission cannot send a base-layer transaction");
  }
  if (!transactionPlan.feePayer.equals(args.wallet.publicKey)) {
    throw new Error("The ER transaction fee payer must be the session wallet");
  }

  const totalStartedAt = performance.now();
  let blockhashMs = 0;
  let signMs = 0;
  let sendMs = 0;
  let confirmMs = 0;
  let blockhashCacheHit = false;
  let blockhashRefreshes = 0;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const blockhashStartedAt = performance.now();
    const blockhash = await getErBlockhash(
      transactionPlan.connection,
      attempt > 0,
    );
    blockhashMs += performance.now() - blockhashStartedAt;
    blockhashCacheHit ||= blockhash.cacheHit;
    if (attempt > 0) blockhashRefreshes += 1;

    const transaction = clonePlanTransaction(
      transactionPlan,
      blockhash.value.blockhash,
    );
    const signStartedAt = performance.now();
    if (transactionPlan.signers.length > 0) {
      transaction.partialSign(...transactionPlan.signers);
    }
    const signed = await args.wallet.signTransaction(transaction);
    signMs += performance.now() - signStartedAt;

    let signature: string | null = null;
    try {
      const sendStartedAt = performance.now();
      signature = await transactionPlan.connection.sendRawTransaction(
        signed.serialize(),
        { maxRetries: 0, skipPreflight: true },
      );
      sendMs += performance.now() - sendStartedAt;

      const confirmStartedAt = performance.now();
      const confirmation = await transactionPlan.connection.confirmTransaction(
        {
          signature,
          blockhash: blockhash.value.blockhash,
          lastValidBlockHeight: blockhash.value.lastValidBlockHeight,
        },
        "confirmed",
      );
      confirmMs += performance.now() - confirmStartedAt;
      if (confirmation.value.err) {
        throw new Error(
          `ER transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`,
        );
      }

      return {
        signature,
        timing: {
          totalMs: performance.now() - totalStartedAt,
          blockhashMs,
          signMs,
          sendMs,
          confirmMs,
          blockhashCacheHit,
          blockhashRefreshes,
        },
      };
    } catch (error) {
      if (
        signature === null &&
        attempt === 0 &&
        isDefiniteBlockhashError(error)
      ) {
        invalidateErBlockhash(transactionPlan.connection);
        continue;
      }
      if (signature !== null && isConfirmationUncertain(error)) {
        const [status] = (
          await transactionPlan.connection.getSignatureStatuses([signature])
        ).value;
        if (status?.err) {
          throw new Error(
            `ER transaction ${signature} failed: ${JSON.stringify(status.err)}`,
          );
        }
        if (
          status?.confirmationStatus === "confirmed" ||
          status?.confirmationStatus === "finalized"
        ) {
          return {
            signature,
            timing: {
              totalMs: performance.now() - totalStartedAt,
              blockhashMs,
              signMs,
              sendMs,
              confirmMs,
              blockhashCacheHit,
              blockhashRefreshes,
            },
          };
        }
        throw new Error(
          `ER transaction ${signature} was submitted but its outcome is not yet known; state will be reconciled before retry`,
        );
      }
      throw error;
    }
  }

  throw new Error("ER transaction could not obtain a valid blockhash");
}

function clonePlanTransaction(
  transactionPlan: TransactionPlan,
  recentBlockhash: string,
): Transaction {
  const transaction = new Transaction({
    feePayer: transactionPlan.feePayer,
    recentBlockhash,
  });
  transaction.add(...transactionPlan.transaction.instructions);
  return transaction;
}

async function getErBlockhash(
  connection: Connection,
  forceRefresh: boolean,
): Promise<{ value: CachedBlockhash; cacheHit: boolean }> {
  const endpoint = connection.rpcEndpoint;
  const cached = blockhashByEndpoint.get(endpoint);
  if (
    !forceRefresh &&
    cached &&
    Date.now() - cached.fetchedAt < BLOCKHASH_CACHE_MS
  ) {
    return { value: cached, cacheHit: true };
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  const value = { ...latest, fetchedAt: Date.now() };
  blockhashByEndpoint.set(endpoint, value);
  return { value, cacheHit: false };
}

function invalidateErBlockhash(connection: Connection): void {
  blockhashByEndpoint.delete(connection.rpcEndpoint);
}

function isDefiniteBlockhashError(error: unknown): boolean {
  const message = errorMessage(error);
  return /blockhash not found|block height exceeded|expired blockhash/i.test(
    message,
  );
}

function isConfirmationUncertain(error: unknown): boolean {
  const message = errorMessage(error);
  return /timeout|timed out|not confirmed|unable to confirm|ws error|websocket|block height exceeded|expired blockhash|blockhash.*expired/i.test(
    message,
  );
}

/** Test-only cache reset; no signer or transaction state is retained here. */
export function clearErBlockhashCacheForTests(): void {
  blockhashByEndpoint.clear();
}
