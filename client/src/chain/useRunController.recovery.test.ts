// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { deriveRunAddresses } from "./pdas";
import {
  canSubmitRunMove,
  needsLegacyRowRecovery,
  requireNoAttachedRunSession,
  validateBaseRunRecovery,
} from "./useRunController";

describe("base-run recovery validation", () => {
  const owner = Keypair.generate().publicKey;
  const dailyChallenge = Keypair.generate().publicKey;

  function activeRun(
    overrides: Partial<{
      owner: typeof owner;
      runId: bigint;
      mode: string;
      lifecycle: string;
      dailyChallenge: typeof dailyChallenge;
    }> = {},
  ) {
    return {
      owner,
      runId: 7n,
      mode: "campaign",
      lifecycle: "levelComplete",
      dailyChallenge,
      ...overrides,
    };
  }

  function validate(
    overrides: Partial<Parameters<typeof validateBaseRunRecovery>[0]> = {},
  ) {
    return validateBaseRunRecovery({
      owner,
      runId: 7n,
      isDelegated: false,
      activeRun: activeRun(),
      ...overrides,
    });
  }

  it.each([undefined, null, 0n, -1n])(
    "rejects missing or nonpositive run ID %s",
    (runId) => {
      expect(() => validate({ runId })).toThrow(/positive run ID/i);
    },
  );

  it("rejects a run that is still delegated before accepting base state", () => {
    expect(() => validate({ isDelegated: true, activeRun: null })).toThrow(
      /still delegated/i,
    );
  });

  it("rejects a missing base ActiveRun", () => {
    expect(() => validate({ activeRun: null })).toThrow(
      /ActiveRun.*missing.*Solana base/i,
    );
  });

  it("rejects an ActiveRun owned by another wallet", () => {
    expect(() =>
      validate({
        activeRun: activeRun({ owner: Keypair.generate().publicKey }),
      }),
    ).toThrow(/owner.*connected wallet/i);
  });

  it("rejects an ActiveRun with a different run ID", () => {
    expect(() => validate({ activeRun: activeRun({ runId: 8n }) })).toThrow(
      /belongs to run 8.*requested run 7/i,
    );
  });

  it("rejects non-campaign modes and nonterminal lifecycles", () => {
    expect(() =>
      validate({ activeRun: activeRun({ mode: "endless" }) }),
    ).toThrow(/cannot use campaign base-run recovery/i);
    expect(() => validate({ activeRun: activeRun({ mode: "daily" }) })).toThrow(
      /cannot use campaign base-run recovery/i,
    );
    expect(() =>
      validate({ activeRun: activeRun({ lifecycle: "playing" }) }),
    ).toThrow(/lifecycle playing is not terminal/i);
  });

  it.each(["levelComplete", "finished"])(
    "accepts terminal campaign lifecycle %s and derives owner-scoped PDAs",
    (lifecycle) => {
      const descriptor = validate({ activeRun: activeRun({ lifecycle }) });
      const expected = deriveRunAddresses(owner, 7n);
      expect(descriptor.mode).toBe("campaign");
      expect(descriptor.dailyChallenge).toBeNull();
      expect(descriptor.addresses.activeRun.equals(expected.activeRun)).toBe(
        true,
      );
    },
  );

  it("refuses recovery while any local run session remains attached", () => {
    const inputs = {
      owner,
      requestedRunId: 7n,
      stored: null,
      active: null,
      settleable: null,
    };
    expect(() => requireNoAttachedRunSession(inputs)).not.toThrow();
    expect(() =>
      requireNoAttachedRunSession({
        ...inputs,
        stored: { runId: 7n },
      }),
    ).toThrow(/already has local run 7 attached/i);
    expect(() =>
      requireNoAttachedRunSession({
        ...inputs,
        active: { runId: 99n },
      }),
    ).toThrow(/local run 99.*recovering run 7/i);
    expect(() =>
      requireNoAttachedRunSession({
        ...inputs,
        settleable: { runId: 12n },
      }),
    ).toThrow(/local run 12.*recovering run 7/i);
  });
});

describe("decoded move readiness", () => {
  it("allows moves only from Playing with an owned preview row", () => {
    expect(
      canSubmitRunMove({
        lifecycle: "playing",
        nextRow: [1, 1, 2, 2],
        pendingVrfCounter: 0,
      }),
    ).toBe(true);
    expect(
      canSubmitRunMove({
        lifecycle: "playing",
        nextRow: null,
        pendingVrfCounter: 0,
      }),
    ).toBe(false);
    expect(
      canSubmitRunMove(
        {
          lifecycle: "playing",
          nextRow: [1, 1, 2, 2],
          pendingVrfCounter: 0,
          mode: "practice",
          deadlineAt: 100,
        },
        99,
      ),
    ).toBe(true);
    expect(
      canSubmitRunMove(
        {
          lifecycle: "playing",
          nextRow: [1, 1, 2, 2],
          pendingVrfCounter: 0,
          mode: "practice",
          deadlineAt: 100,
        },
        100,
      ),
    ).toBe(false);
    expect(
      canSubmitRunMove({
        lifecycle: "awaitingVrf",
        nextRow: [1, 1, 2, 2],
        pendingVrfCounter: 0,
      }),
    ).toBe(false);
  });

  it("recovers only legacy AwaitingVrf without an outstanding request", () => {
    expect(
      needsLegacyRowRecovery({
        lifecycle: "awaitingVrf",
        nextRow: null,
        pendingVrfCounter: 0,
      }),
    ).toBe(true);
    expect(
      needsLegacyRowRecovery(
        {
          lifecycle: "awaitingVrf",
          nextRow: null,
          pendingVrfCounter: 0,
          mode: "daily",
          deadlineAt: 100,
        },
        100,
      ),
    ).toBe(false);
    expect(
      needsLegacyRowRecovery({
        lifecycle: "awaitingVrf",
        nextRow: null,
        pendingVrfCounter: 9,
      }),
    ).toBe(false);
  });
});
