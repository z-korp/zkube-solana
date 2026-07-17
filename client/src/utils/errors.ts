/** Normalize an unknown thrown value into its human-readable message. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** True when a thrown value looks like the user rejecting a wallet prompt. */
export function isWalletRejection(cause: unknown): boolean {
  return /reject|declin|cancel/i.test(errorMessage(cause));
}
