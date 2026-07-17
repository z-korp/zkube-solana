/**
 * Shared fake Solana Connection builder for vitest suites.
 *
 * Defaults cover the read paths transaction-plan tests exercise; override the
 * methods whose values or spies the test asserts on. Suites that must prove a
 * connection is never touched should keep passing a bare `{} as Connection`.
 */
import type { Connection } from "@solana/web3.js";
import { vi } from "vitest";

export function makeFakeConnection(
  overrides: Record<string, unknown> = {},
): Connection {
  return {
    rpcEndpoint: "https://base.example",
    getLatestBlockhash: vi.fn().mockResolvedValue({
      blockhash: "11111111111111111111111111111111",
      lastValidBlockHeight: 1,
    }),
    simulateTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    sendRawTransaction: vi.fn().mockResolvedValue("signature"),
    confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }),
    getAccountInfo: vi.fn().mockResolvedValue(null),
    getBalance: vi.fn().mockResolvedValue(0),
    getFeeForMessage: vi.fn().mockResolvedValue({ value: 5_000 }),
    ...overrides,
  } as unknown as Connection;
}
