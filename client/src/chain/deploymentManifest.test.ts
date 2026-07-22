// @vitest-environment node

import { Keypair, PublicKey } from "@solana/web3.js";
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
import { deriveOperatorRevenueVaultPda } from "./pdas";

describe("zKube deployment manifest v5", () => {
  it("validates a sanitized, fully bound Devnet candidate", () => {
    const manifest = candidate();
    const validation = validateDeploymentManifest(manifest);
    expect(validation.valid).toBe(true);
    expect(formatDeploymentManifestValidation(validation)).toContain(
      "Valid: yes",
    );
    expect(JSON.stringify(manifest)).not.toMatch(
      /secretKey|privateKey|mnemonic|keypair/i,
    );
  });

  it("generates the same manifest from an exact deployment environment", () => {
    const expected = candidate();
    const env = environment(expected);
    const generated = deploymentManifestFromEnv(
      env,
      new Date("2026-07-11T00:00:00.000Z"),
    );
    expect(generated).toEqual(expected);
    expect(deploymentManifestMismatches(generated, env)).toEqual([]);
    expect(
      deploymentManifestMismatches(generated, {
        ZKUBE_LAUNCH_DAY_ID: "5",
      }),
    ).toEqual(["ZKUBE_LAUNCH_DAY_ID=5 expected 4"]);
  });

  it("requires complete approval and deployment evidence for approved Devnet", () => {
    const incomplete = candidate();
    incomplete.approval.status = "approved";
    let validation = validateDeploymentManifest(incomplete);
    expect(validation.valid).toBe(false);
    expect(validation.checks.find(({ id }) => id === "approval")?.status).toBe(
      "fail",
    );
    expect(
      validation.checks.find(({ id }) => id === "deployed-approval")?.status,
    ).toBe("fail");

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

  it("rejects substituted ProgramData, content, rules, launch, seeds, or keeper", () => {
    const base = candidate();
    const cases: unknown[] = [
      {
        ...base,
        program: {
          ...base.program,
          programDataAddress: Keypair.generate().publicKey.toBase58(),
        },
      },
      { ...base, content: { ...base.content, campaignVersion: 3 } },
      { ...base, rules: { ...base.rules, arenaVersion: 2 } },
      { ...base, launch: { ...base.launch, dayId: 11, weekId: 0 } },
      {
        ...base,
        launch: {
          ...base.launch,
          seeds: { ...base.launch.seeds, dailyLamports: "999" },
        },
      },
      {
        ...base,
        keeper: { ...base.keeper, releaseFingerprint: "f".repeat(16) },
      },
    ];
    for (const invalid of cases) {
      expect(validateDeploymentManifest(invalid).valid).toBe(false);
    }
  });

  it("accepts a mid-week, mid-Season launch with derived cadence IDs", () => {
    const base = candidate();
    const dayId = 9;
    const midSeason = {
      ...base,
      launch: {
        ...base.launch,
        dayId,
        weekId: 0,
        seasonId: 0,
        cutoffUnixTimestamp: dayId * 86_400 + 3_600,
      },
    };
    expect(validateDeploymentManifest(midSeason).valid).toBe(true);
  });

  it("binds artifact, environment, and approval without tolerating drift", () => {
    const manifest = candidate();
    expect(
      validateDeploymentBinding({
        manifest,
        artifactSha256: manifest.program.artifactSha256,
        env: environment(manifest),
      }).valid,
    ).toBe(true);
    expect(
      validateDeploymentBinding({
        manifest,
        artifactSha256: "f".repeat(64),
        env: environment(manifest),
      }).artifactMatches,
    ).toBe(false);
    expect(
      validateDeploymentBinding({
        manifest,
        artifactSha256: manifest.program.artifactSha256,
        requireApproved: true,
      }).approvalSatisfied,
    ).toBe(false);
  });
});

function candidate(): ZkubeDeploymentManifest {
  const authority = Keypair.generate().publicKey.toBase58();
  const teamDestination = Keypair.generate().publicKey.toBase58();
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  const programDataAddress = PublicKey.findProgramAddressSync(
    [ZKUBE_PROGRAM_ID.toBuffer()],
    loader,
  )[0].toBase58();
  return {
    schema: "zkube-solana-deployment",
    schemaVersion: 5,
    cluster: "devnet",
    createdAt: "2026-07-11T00:00:00.000Z",
    approval: { status: "candidate" },
    program: {
      id: ZKUBE_PROGRAM_ID.toBase58(),
      artifactSha256: "a".repeat(64),
      programDataAddress,
      deployedProgramDataSha256: "b".repeat(64),
      allocationBytes: 1_000_000,
      upgradeAuthority: Keypair.generate().publicKey.toBase58(),
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
    payment: { asset: "native-sol", decimals: 9 },
    protocol: {
      authority,
      teamDestination,
      operatorRevenueVault: deriveOperatorRevenueVaultPda().toBase58(),
    },
    content: {
      baseVersion: 1,
      campaignVersion: 2,
      catalogSha256: "c".repeat(64),
    },
    rules: { arenaVersion: 1, catalogSha256: "d".repeat(64) },
    launch: {
      dayId: 4,
      weekId: 0,
      seasonId: 0,
      cutoffUnixTimestamp: 4 * 86_400 + 3_600,
      planFingerprint: "e".repeat(64),
      seeds: {
        dailyLamports: "1000000000",
        weeklyLamports: "2000000000",
        seasonLamports: "3000000000",
      },
    },
    keeper: {
      signer: Keypair.generate().publicKey.toBase58(),
      releaseFingerprint: "f".repeat(64),
      imageDigest: `sha256:${"1".repeat(64)}`,
    },
  };
}

function environment(
  manifest: ZkubeDeploymentManifest,
): Record<string, string> {
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
    ZKUBE_PROGRAM_ARTIFACT_SHA256: manifest.program.artifactSha256,
    ZKUBE_PROGRAM_DATA_ADDRESS: manifest.program.programDataAddress,
    ZKUBE_DEPLOYED_PROGRAM_DATA_SHA256:
      manifest.program.deployedProgramDataSha256,
    ZKUBE_PROGRAM_ALLOCATION_BYTES: String(manifest.program.allocationBytes),
    ZKUBE_PROGRAM_UPGRADE_AUTHORITY: manifest.program.upgradeAuthority,
    ZKUBE_PROTOCOL_AUTHORITY: manifest.protocol.authority,
    ZKUBE_TEAM_DESTINATION: manifest.protocol.teamDestination,
    ZKUBE_OPERATOR_REVENUE_VAULT: manifest.protocol.operatorRevenueVault,
    ZKUBE_BASE_CONTENT_VERSION: String(manifest.content.baseVersion),
    ZKUBE_CAMPAIGN_CONTENT_VERSION: String(manifest.content.campaignVersion),
    ZKUBE_CAMPAIGN_CATALOG_SHA256: manifest.content.catalogSha256,
    ZKUBE_ARENA_RULES_VERSION: String(manifest.rules.arenaVersion),
    ZKUBE_ARENA_RULES_CATALOG_SHA256: manifest.rules.catalogSha256,
    ZKUBE_LAUNCH_DAY_ID: String(manifest.launch.dayId),
    ZKUBE_LAUNCH_WEEK_ID: String(manifest.launch.weekId),
    ZKUBE_LAUNCH_SEASON_ID: String(manifest.launch.seasonId),
    ZKUBE_LAUNCH_CUTOFF_UNIX: String(manifest.launch.cutoffUnixTimestamp),
    ZKUBE_LAUNCH_PLAN_FINGERPRINT: manifest.launch.planFingerprint,
    ZKUBE_KEEPER_PUBLIC_KEY: manifest.keeper.signer,
    ZKUBE_KEEPER_RELEASE_FINGERPRINT: manifest.keeper.releaseFingerprint,
    ZKUBE_KEEPER_IMAGE_DIGEST: manifest.keeper.imageDigest,
  };
}
