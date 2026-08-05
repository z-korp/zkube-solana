/** Normalize an unknown thrown value into its human-readable message. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export type WalletErrorKind =
  | "user-rejection"
  | "wallet-not-found"
  | "association-failure"
  | "local-network-access"
  | "unsupported-sign-only-v0"
  | "account-mismatch"
  | "session-expired"
  | "insufficient-funds"
  | "unknown";

export interface WalletErrorClassification {
  kind: WalletErrorKind;
  message: string;
  sourceCode?: string | number;
}

interface ErrorShape {
  cause?: unknown;
  code?: unknown;
  message?: unknown;
}

// These codes have concrete throw sites in the browser bundle pinned through
// wallet-standard-mobile@0.5.3 / mobile-wallet-adapter-protocol@2.2.9.
const PINNED_MWA_ASSOCIATION_CODES = new Set([
  "ERROR_ASSOCIATION_PORT_OUT_OF_RANGE",
  "ERROR_FORBIDDEN_WALLET_BASE_URL",
  "ERROR_INVALID_PROTOCOL_VERSION",
  "ERROR_SECURE_CONTEXT_REQUIRED",
  "ERROR_SESSION_CLOSED",
  "ERROR_SESSION_TIMEOUT",
  "ERROR_ASSOCIATION_CANCELLED",
]);

// Enum members retained for forward compatibility. They are not emitted by
// the pinned browser bundle and must not be described as pinned evidence.
const FORWARD_COMPATIBILITY_ASSOCIATION_CODES = new Set([
  "ERROR_BROWSER_NOT_SUPPORTED",
  "ERROR_REFLECTOR_ID_OUT_OF_RANGE",
]);

/**
 * True when a thrown value looks like the user rejecting a wallet prompt.
 *
 * The pinned Mobile Wallet Adapter package wraps its typed error more than
 * once with `Error.cause`, so inspect that chain while retaining the original
 * message-based API and behavior.
 */
export function isWalletRejection(cause: unknown): boolean {
  return errorChain(cause).some((candidate) =>
    /reject|declin|cancel/i.test(shapeMessage(candidate)),
  );
}

/**
 * Classifies wallet failures using grounded pinned-package evidence, explicit
 * forward-compatibility mappings, and errors emitted at zKube's Wallet
 * Standard boundary. Unknown browser/network failures stay unknown; absence
 * of a wallet response is not evidence that Local Network Access was denied.
 */
export function classifyWalletError(cause: unknown): WalletErrorClassification {
  const chain = errorChain(cause);
  const message = shapeMessage(chain[0] ?? cause);
  const messages = chain.map(shapeMessage);
  const combinedMessage = messages.join("\n");
  const coded = chain
    .map((candidate) => errorShape(candidate))
    .find(
      (candidate) =>
        typeof candidate?.code === "string" ||
        typeof candidate?.code === "number",
    );
  const sourceCode =
    typeof coded?.code === "string" || typeof coded?.code === "number"
      ? coded.code
      : undefined;
  const codes = new Set(
    chain
      .map((candidate) => errorShape(candidate)?.code)
      .filter(
        (code): code is string | number =>
          typeof code === "string" || typeof code === "number",
      ),
  );

  const pinnedLocalNetworkDenial = chain.some((candidate) => {
    const shape = errorShape(candidate);
    return (
      shape?.code === "ERROR_LOOPBACK_ACCESS_BLOCKED" &&
      shapeMessage(candidate) === "Local Network Access permission denied"
    );
  });
  if (pinnedLocalNetworkDenial) {
    return classification("local-network-access", message, sourceCode);
  }

  if (
    codes.has("wallet-not-found") ||
    codes.has("ERROR_WALLET_NOT_FOUND") ||
    /Found no installed wallet that supports the mobile wallet protocol|No compatible Android wallet was found|No installed wallet answered/i.test(
      combinedMessage,
    )
  ) {
    return classification("wallet-not-found", message, sourceCode);
  }

  // wallet-standard-mobile@0.5.3 uses ERROR_ASSOCIATION_CANCELLED for both a
  // user-cancelled handoff and its own 30-second association timeout.
  if (
    /Wallet connection timed out/i.test(combinedMessage) ||
    codes.has("ERROR_SESSION_TIMEOUT")
  ) {
    return classification("association-failure", message, sourceCode);
  }

  if (
    /cannot sign versioned transactions without submitting them|does not support unsigned v0 transaction signing|does not allow transaction signing|versioned transactions unsupported/i.test(
      combinedMessage,
    )
  ) {
    return classification("unsupported-sign-only-v0", message, sourceCode);
  }

  if (
    /wallet account (?:address )?(?:changed|does not match)|connected wallet account changed|wallet did not sign with the connected account|belongs to a different wallet|does not match the connected wallet|created by a different owner payer/i.test(
      combinedMessage,
    )
  ) {
    return classification("account-mismatch", message, sourceCode);
  }

  if (
    codes.has("session-expired") ||
    /(?:zKube device session|scoped player session|session token).*(?:expired|has expired)|expired.*(?:zKube device session|scoped player session|session token)/i.test(
      combinedMessage,
    )
  ) {
    return classification("session-expired", message, sourceCode);
  }

  // An owner who cannot cover account rent, the device fee allowance, and the
  // network fee is not a wallet or transport failure. The Devnet RPC credits an
  // unfunded fee payer with 1 SOL inside `simulateTransaction`, so this
  // normally survives the client's own simulation and only fails at
  // `sendTransaction` preflight. Match the agave `TransactionError` display
  // forms plus the System program's short-debit log, both of which web3.js
  // embeds in `SendTransactionError.message`. Checked before rejection matching
  // so an embedded program log cannot be mistaken for a decline.
  if (
    /Attempt to debit an account but found no record of a prior credit|insufficient funds for (?:fee|rent)|insufficient lamports/i.test(
      combinedMessage,
    )
  ) {
    return classification("insufficient-funds", message, sourceCode);
  }

  if (isWalletRejection(cause)) {
    return classification("user-rejection", message, sourceCode);
  }

  if (
    [...codes].some(
      (code) =>
        typeof code === "string" &&
        (PINNED_MWA_ASSOCIATION_CODES.has(code) ||
          FORWARD_COMPATIBILITY_ASSOCIATION_CODES.has(code) ||
          code === "ERROR_LOOPBACK_ACCESS_BLOCKED"),
    ) ||
    /wallet session (?:dropped|was closed before connection)|Failed to connect to the wallet websocket|wallet association|intent (?:failed|failure)/i.test(
      combinedMessage,
    )
  ) {
    return classification("association-failure", message, sourceCode);
  }

  return classification("unknown", message, sourceCode);
}

function classification(
  kind: WalletErrorKind,
  message: string,
  sourceCode: string | number | undefined,
): WalletErrorClassification {
  return sourceCode === undefined
    ? { kind, message }
    : { kind, message, sourceCode };
}

function errorChain(cause: unknown): unknown[] {
  const result: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = cause;

  while (current !== undefined && current !== null && result.length < 8) {
    if (seen.has(current)) break;
    seen.add(current);
    result.push(current);
    current = errorShape(current)?.cause;
  }
  return result;
}

function errorShape(value: unknown): ErrorShape | undefined {
  return typeof value === "object" && value !== null
    ? (value as ErrorShape)
    : undefined;
}

function shapeMessage(value: unknown): string {
  const message = errorShape(value)?.message;
  return typeof message === "string" ? message : errorMessage(value);
}
