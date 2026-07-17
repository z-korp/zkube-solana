// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  devnetDeploymentInputFromEnv,
  formatDevnetDeployment,
  inspectUpgradeableProgram,
  runZkubeDevnetDeployment,
} from "./deploymentRunner";

const directories: string[] = [];
const CURRENT_SBF = "00".repeat(32);

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Devnet deployment runner", () => {
  it("plans MagicBlock Devnet by default without enabling a send", () => {
    const fixture = files();
    const input = devnetDeploymentInputFromEnv(
      {
        ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
        ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
        ZKUBE_EXPECTED_CURRENT_SBF_SHA256: CURRENT_SBF,
      },
      fixture.directory,
    );

    expect(input.baseRpc).toBe("https://rpc.magicblock.app/devnet");
    expect(input.deploymentMode).toBe("upgrade");
    expect(input.sendEnabled).toBe(false);
    expect(input.artifactSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input.approvalFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(input.approvalEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(input.approvalEvidenceSha256.startsWith(input.approvalFingerprint)).toBe(true);
    expect(input.commands.map(({ label }) => label)).toEqual([
      "Build Anchor program",
      "Upgrade existing program",
      "Verify deployed program",
    ]);
    expect(input.commands[1]?.args).toContain("--no-auto-extend");
    expect(
      formatDevnetDeployment({
        mode: "dry-run",
        input,
        executions: [],
      }),
    ).toContain("Candidate only: required signer identity is missing");
  });

  it("rejects localhost, mainnet, and a substituted genesis", () => {
    const fixture = files();
    const base = {
      ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
      ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
      ZKUBE_EXPECTED_CURRENT_SBF_SHA256: CURRENT_SBF,
    };
    expect(() =>
      devnetDeploymentInputFromEnv(
        {
          ...base,
          ZKUBE_BASE_RPC: "http://127.0.0.1:8899",
        },
        fixture.directory,
      ),
    ).toThrow("HTTPS");
    expect(() =>
      devnetDeploymentInputFromEnv(
        {
          ...base,
          ZKUBE_BASE_RPC: "https://api.mainnet-beta.solana.com",
        },
        fixture.directory,
      ),
    ).toThrow("cannot target mainnet");
    expect(() =>
      devnetDeploymentInputFromEnv(
        {
          ...base,
          ZKUBE_EXPECTED_GENESIS_HASH: Keypair.generate().publicKey.toBase58(),
        },
        fixture.directory,
      ),
    ).toThrow("devnet genesis hash");
  });

  it("requires the exact fingerprint before any executable deployment path", async () => {
    const fixture = files();
    const input = devnetDeploymentInputFromEnv(
      {
        ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
        ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
        ZKUBE_PROGRAM_KEYPAIR: fixture.program,
        ZKUBE_PROGRAM_BUFFER_KEYPAIR: fixture.buffer,
        ZKUBE_DEPLOYER_KEYPAIR: fixture.deployer,
        ZKUBE_UPGRADE_AUTHORITY_KEYPAIR: fixture.program,
        ZKUBE_DEPLOY_MODE: "initial",
        ZKUBE_DEPLOY: "1",
        ZKUBE_DEPLOY_APPROVAL: "wrong",
      },
      fixture.directory,
    );

    const deploy = input.commands.find(
      ({ label }) => label === "Deploy Solana program",
    );
    expect(deploy?.args).toEqual(
      expect.arrayContaining([
        "--program-id",
        fixture.program,
        "--buffer",
        fixture.buffer,
        "--upgrade-authority",
        fixture.program,
        "--keypair",
        fixture.deployer,
        "--fee-payer",
        fixture.deployer,
      ]),
    );
    expect(
      formatDevnetDeployment({ mode: "dry-run", input, executions: [] }),
    ).not.toContain(fixture.directory);

    await expect(runZkubeDevnetDeployment(input)).rejects.toThrow(
      "deployment blocked",
    );
  });

  it("rejects a deployment key that does not match the declared program id", async () => {
    const fixture = files();
    const input = devnetDeploymentInputFromEnv(
      {
        ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
        ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
        ZKUBE_PROGRAM_KEYPAIR: fixture.program,
        ZKUBE_PROGRAM_BUFFER_KEYPAIR: fixture.buffer,
        ZKUBE_DEPLOYER_KEYPAIR: fixture.deployer,
        ZKUBE_DEPLOY_MODE: "initial",
        ZKUBE_DEPLOY: "1",
      },
      fixture.directory,
    );
    input.suppliedApproval = input.approvalFingerprint;

    await expect(runZkubeDevnetDeployment(input)).rejects.toThrow(
      "does not match declared program",
    );
  });

  it("decodes and validates the live ProgramData allocation", async () => {
    const programId = Keypair.generate().publicKey;
    const programDataAddress = Keypair.generate().publicKey;
    const authority = Keypair.generate().publicKey;
    const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
    const programData = Buffer.alloc(36);
    programData.writeUInt32LE(2, 0);
    programDataAddress.toBuffer().copy(programData, 4);
    const deployedData = Buffer.alloc(45 + 1_096);
    deployedData.writeUInt32LE(3, 0);
    deployedData[12] = 1;
    authority.toBuffer().copy(deployedData, 13);
    const connection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(programId)
          ? {
              data: programData,
              executable: true,
              lamports: 1,
              owner: loader,
              rentEpoch: 0,
            }
          : address.equals(programDataAddress)
            ? {
                data: deployedData,
                executable: false,
                lamports: 2,
                owner: loader,
                rentEpoch: 0,
              }
            : null,
    } as Connection;

    await expect(inspectUpgradeableProgram(connection, programId)).resolves.toEqual({
      programDataAddress,
      programCapacityBytes: 1_096,
      programDataLamports: 2,
      upgradeAuthority: authority.toBase58(),
      deployedSbfSha256: expect.any(String),
    });
  });
});

function files(): {
  directory: string;
  artifact: string;
  program: string;
  buffer: string;
  deployer: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "zkube-deploy-"));
  directories.push(directory);
  const artifact = join(directory, "solana.so");
  const program = join(directory, "program.json");
  const buffer = join(directory, "buffer.json");
  const deployer = join(directory, "deployer.json");
  writeFileSync(artifact, Uint8Array.from([1, 2, 3, 4]));
  writeKeypair(program, Keypair.generate());
  writeKeypair(buffer, Keypair.generate());
  writeKeypair(deployer, Keypair.generate());
  return { directory, artifact, program, buffer, deployer };
}

function writeKeypair(path: string, keypair: Keypair): void {
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
}
