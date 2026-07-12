// @vitest-environment node

import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  DELEGATION_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "./constants";
import {
  deploymentManifestFromEnv,
  deploymentManifestMismatches,
  formatDeploymentManifestValidation,
  validateDeploymentBinding,
  validateDeploymentManifest,
  type ZkubeDeploymentManifest,
} from "./deploymentManifest";
import { VRF_QUEUE } from "./runPlan";

describe("zKube deployment manifest", () => {
  it("validates a sanitized Router-based devnet candidate", () => {
    const manifest = candidate();
    const validation = validateDeploymentManifest(manifest);
    expect(validation.valid).toBe(true);
    expect(formatDeploymentManifestValidation(validation)).toContain("Valid: yes");
    expect(JSON.stringify(manifest)).not.toMatch(/secret|private|seed|keypair/i);
  });

  it("generates the same manifest from an explicit deployment environment", () => {
    const expected = candidate();
    const env = environment(expected);
    const generated = deploymentManifestFromEnv(
      env,
      new Date("2026-07-11T00:00:00.000Z"),
    );
    expect(generated).toEqual(expected);
    expect(deploymentManifestMismatches(generated, env)).toEqual([]);
    expect(deploymentManifestMismatches(generated, {
      VITE_PUBLIC_SOLANA_RPC_ENDPOINT: "https://wrong.example",
    })).toEqual([
      "VITE_PUBLIC_SOLANA_RPC_ENDPOINT=https://wrong.example expected https://api.devnet.solana.com",
    ]);
  });

  it("requires complete approval and deployment evidence for approved devnet", () => {
    const incomplete = candidate();
    incomplete.approval.status = "approved";
    let validation = validateDeploymentManifest(incomplete);
    expect(validation.valid).toBe(false);
    expect(validation.checks.find(({ id }) => id === "approval")?.status).toBe("fail");
    expect(validation.checks.find(({ id }) => id === "deployed-approval")?.status).toBe("fail");

    const approved: ZkubeDeploymentManifest = {
      ...incomplete,
      approval: {
        status: "approved",
        fingerprint: "0123456789abcdef",
        approvedAt: "2026-07-11T01:00:00.000Z",
        evidenceSha256: "b".repeat(64),
      },
      program: {
        ...incomplete.program,
        deploymentSignature: "devnet-deployment-signature",
        deployedAt: "2026-07-11T01:05:00.000Z",
      },
    };
    validation = validateDeploymentManifest(approved);
    expect(validation.valid).toBe(true);
  });

  it("rejects mainnet, substituted infrastructure, Token-2022, and aliased custody", () => {
    const base = candidate();
    const cases: unknown[] = [
      { ...base, cluster: "mainnet-beta" },
      { ...base, magic: { ...base.magic, program: Keypair.generate().publicKey.toBase58() } },
      {
        ...base,
        payment: { ...base.payment, tokenProgram: TOKEN_2022_PROGRAM_ID.toBase58() },
      },
      {
        ...base,
        vaults: { ...base.vaults, reward: base.vaults.treasury },
      },
      {
        ...base,
        paymaster: { ...base.paymaster, secretKey: Array(64).fill(1) },
      },
    ];
    for (const invalid of cases) expect(validateDeploymentManifest(invalid).valid).toBe(false);
  });

  it("permits explicit localhost RPCs only for localnet candidates", () => {
    const local: ZkubeDeploymentManifest = {
      ...candidate(),
      cluster: "localnet",
      rpc: {
        base: "http://127.0.0.1:8899",
        expectedGenesisHash: Keypair.generate().publicKey.toBase58(),
        magicRouter: "http://127.0.0.1:6699",
      },
    };
    expect(validateDeploymentManifest(local).valid).toBe(true);
    expect(validateDeploymentManifest({
      ...local,
      cluster: "devnet",
    }).valid).toBe(false);
  });

  it("binds the manifest to the exact artifact, environment, and approval gate", () => {
    const manifest = candidate();
    expect(validateDeploymentBinding({
      manifest,
      artifactSha256: manifest.program.artifactSha256,
      env: environment(manifest),
    }).valid).toBe(true);
    expect(validateDeploymentBinding({
      manifest,
      artifactSha256: "f".repeat(64),
      env: environment(manifest),
    }).artifactMatches).toBe(false);
    expect(validateDeploymentBinding({
      manifest,
      artifactSha256: manifest.program.artifactSha256,
      env: { VITE_PUBLIC_SOLANA_RPC_ENDPOINT: "https://wrong.example" },
    }).environmentMismatches).toHaveLength(1);
    expect(validateDeploymentBinding({
      manifest,
      artifactSha256: manifest.program.artifactSha256,
      requireApproved: true,
    }).approvalSatisfied).toBe(false);
  });
});

function candidate(): ZkubeDeploymentManifest {
  const vaults = Array.from({ length: 5 }, () => Keypair.generate().publicKey.toBase58());
  return {
    schema: "zkube-solana-deployment",
    schemaVersion: 1,
    cluster: "devnet",
    createdAt: "2026-07-11T00:00:00.000Z",
    approval: { status: "candidate" },
    program: {
      id: ZKUBE_PROGRAM_ID.toBase58(),
      artifactSha256: "a".repeat(64),
    },
    rpc: {
      base: "https://api.devnet.solana.com",
      expectedGenesisHash: SOLANA_DEVNET_GENESIS_HASH,
      magicRouter: "https://devnet-router.magicblock.app/",
    },
    magic: {
      routerPolicy: "closest",
      context: MAGIC_CONTEXT_ID.toBase58(),
      program: MAGIC_PROGRAM_ID.toBase58(),
      delegationProgram: DELEGATION_PROGRAM_ID.toBase58(),
      vrfQueue: VRF_QUEUE.toBase58(),
    },
    payment: {
      mint: Keypair.generate().publicKey.toBase58(),
      tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      decimals: 6,
    },
    vaults: {
      team: vaults[0]!,
      paymaster: vaults[1]!,
      treasury: vaults[2]!,
      reward: vaults[3]!,
      payment: vaults[4]!,
    },
    paymaster: {
      publicKey: Keypair.generate().publicKey.toBase58(),
      endpoint: "/api/paymaster",
    },
    governance: {
      authority: Keypair.generate().publicKey.toBase58(),
      delaySeconds: 3_600,
      executionWindowSeconds: 86_400,
    },
    versions: { content: 1, progress: 1, strategy: 0 },
  };
}

function environment(manifest: ZkubeDeploymentManifest): Record<string, string> {
  return {
    ZKUBE_CLUSTER: manifest.cluster,
    ZKUBE_APPROVAL_STATUS: manifest.approval.status,
    VITE_PUBLIC_SOLANA_RPC_ENDPOINT: manifest.rpc.base,
    VITE_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH: manifest.rpc.expectedGenesisHash,
    VITE_PUBLIC_SOLANA_ZKUBE_PROGRAM_ID: manifest.program.id,
    VITE_PUBLIC_SOLANA_DELEGATION_PROGRAM_ID: manifest.magic.delegationProgram,
    VITE_PUBLIC_SOLANA_MAGIC_PROGRAM_ID: manifest.magic.program,
    VITE_PUBLIC_SOLANA_MAGIC_CONTEXT_ID: manifest.magic.context,
    VITE_PUBLIC_MAGICBLOCK_ROUTER_RPC: manifest.rpc.magicRouter,
    VITE_PUBLIC_SOLANA_VRF_QUEUE: manifest.magic.vrfQueue,
    VITE_PUBLIC_ZKUBE_PAYMASTER_ENDPOINT: manifest.paymaster.endpoint,
    ZKUBE_PROGRAM_ARTIFACT_SHA256: manifest.program.artifactSha256,
    ZKUBE_PAYMENT_MINT: manifest.payment.mint,
    ZKUBE_PAYMENT_TOKEN_PROGRAM: manifest.payment.tokenProgram,
    ZKUBE_TEAM_VAULT: manifest.vaults.team,
    ZKUBE_PAYMASTER_VAULT: manifest.vaults.paymaster,
    ZKUBE_TREASURY_VAULT: manifest.vaults.treasury,
    ZKUBE_REWARD_VAULT: manifest.vaults.reward,
    ZKUBE_PAYMENT_VAULT: manifest.vaults.payment,
    ZKUBE_PAYMASTER_PUBLIC_KEY: manifest.paymaster.publicKey,
    ZKUBE_GOVERNANCE_AUTHORITY: manifest.governance.authority,
    ZKUBE_GOVERNANCE_DELAY_SECONDS: String(manifest.governance.delaySeconds),
    ZKUBE_GOVERNANCE_EXECUTION_WINDOW_SECONDS: String(
      manifest.governance.executionWindowSeconds,
    ),
    ZKUBE_CONTENT_VERSION: String(manifest.versions.content),
    ZKUBE_PROGRESS_VERSION: String(manifest.versions.progress),
    ZKUBE_STRATEGY_VERSION: String(manifest.versions.strategy),
  };
}
