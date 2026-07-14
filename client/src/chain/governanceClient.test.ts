// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import {
  buildAcceptProtocolAuthorityPlan,
  buildProposeProtocolAuthorityPlan,
  buildSetPricingOperatorPlan,
  buildSetProtocolPausePlan,
} from "./governanceClient";
import { deriveProtocolConfigPda } from "./pdas";
import { SessionWallet } from "./sessionWallet";

describe("protocol control client", () => {
  it("builds explicit pause, pricing, and two-step authority controls", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const pending = new SessionWallet(Keypair.generate());
    const pricingOperator = Keypair.generate().publicKey;
    const connection = {} as Connection;
    const [pause, propose, accept, pricing] = await Promise.all([
      buildSetProtocolPausePlan({ connection, authority, paused: true }),
      buildProposeProtocolAuthorityPlan({
        connection,
        authority,
        pendingAuthority: pending.publicKey,
      }),
      buildAcceptProtocolAuthorityPlan({ connection, pendingAuthority: pending }),
      buildSetPricingOperatorPlan({ connection, authority, pricingOperator }),
    ]);

    for (const candidate of [pause, propose, accept, pricing]) {
      expect(candidate.transaction.instructions[0].keys[0].pubkey.equals(deriveProtocolConfigPda()))
        .toBe(true);
    }
    expect(pause.label).toBe("Pause protocol");
    expect(accept.feePayer.equals(pending.publicKey)).toBe(true);
  });
});
