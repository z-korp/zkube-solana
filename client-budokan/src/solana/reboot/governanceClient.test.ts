// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildAcceptProtocolAuthorityPlan,
  buildCancelGovernancePlan,
  buildExecuteGovernancePlan,
  buildPauseProtocolPlan,
  buildPauseYieldStrategyPlan,
  buildProposeGovernancePlan,
} from "./governanceClient";
import {
  deriveGovernanceProposalPda,
  deriveProgressCatalogPda,
  deriveProtocolConfigPda,
  deriveTreasuryLedgerPda,
  deriveYieldPolicyPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";

describe("governance client", () => {
  it("builds a PDA-bound timelocked proposal and permissionless execution", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const caller = new SessionWallet(Keypair.generate());
    const connection = {} as Connection;
    const proposalId = 9n;
    const [propose, execute, cancel] = await Promise.all([
      buildProposeGovernancePlan({
        connection,
        authority,
        proposalId,
        action: { kind: "setContentVersion", contentVersion: 2 },
      }),
      buildExecuteGovernancePlan({
        connection,
        caller,
        proposalId,
        action: { kind: "setContentVersion", contentVersion: 2 },
      }),
      buildCancelGovernancePlan({ connection, authority, proposalId }),
    ]);
    const proposal = deriveGovernanceProposalPda(proposalId);

    expect(propose.transaction.instructions[0].keys[0].pubkey.equals(deriveProtocolConfigPda())).toBe(true);
    expect(propose.transaction.instructions[0].keys[1].pubkey.equals(deriveYieldPolicyPda())).toBe(true);
    expect(propose.transaction.instructions[0].keys[2].pubkey.equals(deriveTreasuryLedgerPda())).toBe(true);
    expect(propose.transaction.instructions[0].keys[3].pubkey.equals(proposal)).toBe(true);
    expect(execute.transaction.instructions[0].keys[1].pubkey.equals(proposal)).toBe(true);
    expect(execute.transaction.instructions[0].keys[3].pubkey.equals(deriveTreasuryLedgerPda())).toBe(true);
    expect(execute.feePayer.equals(caller.publicKey)).toBe(true);
    expect(cancel.transaction.instructions[0].keys[1].pubkey.equals(proposal)).toBe(true);
  });

  it("pins a published progress catalog into timelocked activation", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const caller = new SessionWallet(Keypair.generate());
    const connection = {} as Connection;
    const proposalId = 10n;
    const action = { kind: "setProgressVersion", progressVersion: 2 } as const;
    const [propose, execute] = await Promise.all([
      buildProposeGovernancePlan({ connection, authority, proposalId, action }),
      buildExecuteGovernancePlan({ connection, caller, proposalId, action }),
    ]);

    expect(propose.transaction.instructions[0].keys[3].pubkey.equals(
      deriveGovernanceProposalPda(proposalId),
    )).toBe(true);
    expect(execute.transaction.instructions[0].keys.at(-1)?.pubkey.equals(
      deriveProgressCatalogPda(2),
    )).toBe(true);
  });

  it("keeps emergency pause immediate and authority acceptance two-step", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const connection = {} as Connection;
    const [pause, pauseYield, accept] = await Promise.all([
      buildPauseProtocolPlan({ connection, authority }),
      buildPauseYieldStrategyPlan({ connection, authority }),
      buildAcceptProtocolAuthorityPlan({ connection, pendingAuthority: authority }),
    ]);

    expect(pause.label).toBe("Emergency-pause protocol");
    expect(accept.label).toBe("Accept protocol authority");
    expect(pauseYield.label).toBe("Emergency-pause yield strategy");
    expect(pauseYield.transaction.instructions[0].keys[1].pubkey.equals(
      deriveYieldPolicyPda(),
    )).toBe(true);
    expect(pause.feePayer.equals(authority.publicKey)).toBe(true);
    expect(accept.feePayer.equals(authority.publicKey)).toBe(true);
  });

  it("encodes monotonic strategy configuration and independent yield routing", async () => {
    const authority = new SessionWallet(Keypair.generate());
    const connection = {} as Connection;
    const address = () => Keypair.generate().publicKey;
    const [configure, allocation] = await Promise.all([
      buildProposeGovernancePlan({
        connection,
        authority,
        proposalId: 11n,
        action: {
          kind: "configureYieldStrategy",
          strategyVersion: 1,
          adapterProgram: address(),
          market: address(),
          reserve: address(),
          receiptMint: address(),
          maxPrincipal: 1_000_000n,
          maxExposureBps: 2_500,
          minLiquidReserveBps: 7_500,
          maxSlippageBps: 25,
          maxLossBps: 100,
        },
      }),
      buildProposeGovernancePlan({
        connection,
        authority,
        proposalId: 12n,
        action: { kind: "setYieldAllocation", rewardBps: 10_000 },
      }),
    ]);

    expect(configure.label).toBe("Propose timelocked governance action");
    expect(allocation.label).toBe("Propose timelocked governance action");
    expect(configure.transaction.instructions[0].data.equals(
      allocation.transaction.instructions[0].data,
    )).toBe(false);
  });
});
