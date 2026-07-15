// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  bootstrapFingerprint,
  devnetBootstrapInputFromEnv,
  type PublicBootstrapPlan,
} from "./devnetBootstrap";

describe("Devnet bootstrap approval contract", () => {
  it("rejects localhost and mainnet before loading signer files", () => {
    expect(() =>
      devnetBootstrapInputFromEnv({
        ZKUBE_BASE_RPC: "http://127.0.0.1:8899",
      }),
    ).toThrow("HTTPS");
    expect(() =>
      devnetBootstrapInputFromEnv({
        ZKUBE_BASE_RPC: "https://api.mainnet-beta.solana.com",
      }),
    ).toThrow("cannot target mainnet");
  });

  it("fingerprints every public instruction and funding decision", () => {
    const plan = fixture();
    const first = bootstrapFingerprint(plan);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    const changed = structuredClone(plan);
    changed.batches[0]!.fundingLamports += 1;
    expect(bootstrapFingerprint(changed)).not.toBe(first);
    const changedProgram = structuredClone(plan);
    changedProgram.deployment.sbfSha256 = "22".repeat(32);
    expect(bootstrapFingerprint(changedProgram)).not.toBe(first);
    expect(JSON.stringify(plan)).not.toMatch(/keypair|secret|\.devnet/i);
  });
});

function fixture(): PublicBootstrapPlan {
  const key = "11111111111111111111111111111111";
  return {
    schema: "zkube-devnet-bootstrap-plan",
    schemaVersion: 1,
    cluster: "devnet",
    stage: "custody",
    rpc: "https://rpc.magicblock.app/devnet",
    genesisHash: key,
    program: key,
    deployment: {
      programData: key,
      deployedSlot: "1",
      upgradeAuthority: key,
      sbfSha256: "11".repeat(32),
    },
    identities: { funder: key, authority: key },
    vaults: {
      team: key,
      treasury: key,
    },
    pdas: {
      protocol: key,
      economy: key,
      starSalesLedger: key,
      dailyRulesCatalog: key,
    },
    policy: {
      contentVersion: 1,
      dailyRulesVersion: 1,
    },
    batches: [
      {
        id: "fund",
        label: "Fund",
        feePayer: key,
        requiredSigners: [key],
        fundingLamports: 1,
        creates: [],
        instructions: [
          {
            programId: key,
            dataSha256: "33".repeat(32),
            accounts: [{ pubkey: key, signer: true, writable: true }],
          },
        ],
      },
    ],
  };
}
