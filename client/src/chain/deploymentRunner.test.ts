// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  type Connection,
} from "@solana/web3.js";
import { afterEach, describe, expect, it } from "vitest";
import {
  deploymentSignatureFromExecutions,
  devnetDeploymentInputFromEnv,
  formatDevnetDeployment,
  inspectUpgradeableProgram,
  prepareZkubeDevnetDeployment,
} from "./deploymentRunner";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants";

const directories: string[] = [];
const LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Devnet deployment runner", () => {
  it("requires an explicit initial or upgrade operation", () => {
    const fixture = files();
    expect(() =>
      devnetDeploymentInputFromEnv(
        {
          ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
          ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
        },
        fixture.directory,
      ),
    ).toThrow("ZKUBE_DEPLOY_MODE is required");
  });

  it("plans only deployment and verification from a frozen artifact", () => {
    const fixture = files();
    const input = initialInput(fixture);

    expect(input.baseRpc).toBe("https://rpc.magicblock.app/devnet");
    expect(input.sendEnabled).toBe(false);
    expect(input.approvalFingerprint).toBe("unprepared");
    expect(input.commands.map(({ label }) => label)).toEqual([
      "Deploy frozen Solana program",
      "Verify deployed program",
    ]);
    expect(input.commands[0]?.args).toEqual(
      expect.arrayContaining([
        "--max-len",
        String(input.artifactBytes + 10_240),
        "--no-auto-extend",
        "--max-sign-attempts",
        "1",
      ]),
    );
    expect(input.commands.some(({ command }) => command === "anchor")).toBe(
      false,
    );
  });

  it("accepts a public-only fresh buffer identity for read-only planning", () => {
    const fixture = files();
    const bufferPublicKey = Keypair.generate().publicKey.toBase58();
    const input = devnetDeploymentInputFromEnv(
      {
        ZKUBE_DEPLOY_MODE: "initial",
        ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
        ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
        ZKUBE_PROGRAM_KEYPAIR: fixture.program,
        ZKUBE_PROGRAM_BUFFER_PUBLIC_KEY: bufferPublicKey,
        ZKUBE_DEPLOYER_PUBLIC_KEY: Keypair.generate().publicKey.toBase58(),
        ZKUBE_UPGRADE_AUTHORITY_PUBLIC_KEY:
          Keypair.generate().publicKey.toBase58(),
      },
      fixture.directory,
    );

    expect(input.programBufferKeypairPath).toBeUndefined();
    expect(input.programBufferPublicKey).toBe(bufferPublicKey);
  });

  it("extracts a deployment signature from JSON or bounded text output", () => {
    const encoded = "1".repeat(64);
    expect(
      deploymentSignatureFromExecutions([
        { stdout: JSON.stringify({ signature: encoded }), stderr: "" },
      ]),
    ).toBe(encoded);
    expect(
      deploymentSignatureFromExecutions([
        { stdout: "", stderr: `Signature: ${encoded}` },
      ]),
    ).toBe(encoded);
  });

  it("binds live rent, fees, reserve, allocation and ProgramData into approval", async () => {
    const fixture = files();
    const input = initialInput(fixture);
    // Unit tests cannot create the repository's fixed program keypair. The
    // planner separately re-reads it before an executable send.
    input.programKeypairPublicKey = input.programId;
    const prepared = await prepareZkubeDevnetDeployment(
      input,
      initialConnection(),
    );

    expect(prepared.preflight).toMatchObject({
      artifactBytes: 4,
      allocationBytes: 10_244,
      headroomBytes: 10_240,
      programAccountRentLamports: 360,
      programDataRentLamports: 102_890,
      programBufferRentLamports: 410,
      feePerSignatureLamports: 5_000,
      maximumSignatures: 8,
      maximumFeeLamports: 40_000,
      maximumPayerSpendLamports: 143_660,
      deployerReserveLamports: 100_000_000,
      requiredDeployerBalanceLamports: 100_143_660,
      currentDeployedSbfSha256: null,
    });
    expect(prepared.preflight?.expectedPostDeploymentSbfSha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(prepared.approvalFingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(prepared.approvalEvidenceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(
      prepared.approvalEvidenceSha256.startsWith(prepared.approvalFingerprint),
    ).toBe(true);
    const report = formatDevnetDeployment({
      mode: "dry-run",
      input: prepared,
      executions: [],
    });
    expect(report).toContain("Allocation headroom: 10240 bytes");
    expect(report).toContain("Artifact rebuild after approval: disabled");
    expect(report.match(/^Base RPC:/gm)).toHaveLength(1);
    expect(report).not.toContain(fixture.directory);
  });

  it("aborts an occupied fresh Program or ProgramData before approval", async () => {
    const fixture = files();
    const input = initialInput(fixture);
    input.programKeypairPublicKey = input.programId;
    const occupied = initialConnection({ occupiedProgram: true });
    await expect(prepareZkubeDevnetDeployment(input, occupied)).rejects.toThrow(
      "fresh Program or ProgramData address is occupied",
    );
  });

  it("rejects artifact drift before live deployment planning", async () => {
    const fixture = files();
    const input = initialInput(fixture);
    input.programKeypairPublicKey = input.programId;
    writeFileSync(fixture.artifact, Uint8Array.from([9, 9, 9, 9]));
    await expect(
      prepareZkubeDevnetDeployment(input, initialConnection()),
    ).rejects.toThrow("frozen program artifact changed");
  });

  it("rejects localhost, mainnet, and a substituted genesis", () => {
    const fixture = files();
    const base = {
      ZKUBE_DEPLOY_MODE: "initial",
      ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
      ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
    };
    expect(() =>
      devnetDeploymentInputFromEnv(
        { ...base, ZKUBE_BASE_RPC: "http://127.0.0.1:8899" },
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

  it("decodes canonical ProgramData and hashes the full padded allocation", async () => {
    const programId = Keypair.generate().publicKey;
    const programDataAddress = PublicKey.findProgramAddressSync(
      [programId.toBuffer()],
      LOADER,
    )[0];
    const authority = Keypair.generate().publicKey;
    const programData = Buffer.alloc(36);
    programData.writeUInt32LE(2, 0);
    programDataAddress.toBuffer().copy(programData, 4);
    const deployedData = Buffer.alloc(45 + 1_096);
    deployedData.writeUInt32LE(3, 0);
    deployedData[12] = 1;
    authority.toBuffer().copy(deployedData, 13);
    deployedData.fill(7, 45);
    const connection = {
      getAccountInfo: async (address: PublicKey) =>
        address.equals(programId)
          ? account(programData, true, LOADER, 1)
          : address.equals(programDataAddress)
            ? account(deployedData, false, LOADER, 2)
            : null,
    } as Connection;

    await expect(
      inspectUpgradeableProgram(connection, programId),
    ).resolves.toEqual({
      programDataAddress,
      programCapacityBytes: 1_096,
      programDataLamports: 2,
      upgradeAuthority: authority.toBase58(),
      deployedSbfSha256: expect.any(String),
    });
  });
});

function initialInput(fixture: ReturnType<typeof files>) {
  return devnetDeploymentInputFromEnv(
    {
      ZKUBE_DEPLOY_MODE: "initial",
      ZKUBE_PROGRAM_ARTIFACT: fixture.artifact,
      ZKUBE_ANCHOR_WORKSPACE: fixture.directory,
      ZKUBE_PROGRAM_KEYPAIR: fixture.program,
      ZKUBE_PROGRAM_BUFFER_KEYPAIR: fixture.buffer,
      ZKUBE_DEPLOYER_KEYPAIR: fixture.deployer,
      ZKUBE_UPGRADE_AUTHORITY_KEYPAIR: fixture.authority,
    },
    fixture.directory,
  );
}

function initialConnection(options: { occupiedProgram?: boolean } = {}) {
  const programData = PublicKey.findProgramAddressSync(
    [ZKUBE_PROGRAM_ID.toBuffer()],
    LOADER,
  )[0];
  return {
    getGenesisHash: async () => SOLANA_DEVNET_GENESIS_HASH,
    getAccountInfo: async (address: PublicKey) =>
      options.occupiedProgram &&
      (address.equals(ZKUBE_PROGRAM_ID) || address.equals(programData))
        ? account(Buffer.alloc(0), false, SystemProgram.programId, 1)
        : null,
    getMinimumBalanceForRentExemption: async (space: number) => space * 10,
    getLatestBlockhash: async () => ({
      blockhash: Keypair.generate().publicKey.toBase58(),
      lastValidBlockHeight: 1,
    }),
    getFeeForMessage: async () => ({ context: { slot: 1 }, value: 5_000 }),
    getBalance: async () => 1_000_000_000,
  } as unknown as Connection;
}

function files(): {
  directory: string;
  artifact: string;
  program: string;
  buffer: string;
  deployer: string;
  authority: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "zkube-deploy-"));
  directories.push(directory);
  const artifact = join(directory, "solana.so");
  const program = join(directory, "program.json");
  const buffer = join(directory, "buffer.json");
  const deployer = join(directory, "deployer.json");
  const authority = join(directory, "authority.json");
  writeFileSync(artifact, Uint8Array.from([1, 2, 3, 4]));
  writeKeypair(program, Keypair.generate());
  writeKeypair(buffer, Keypair.generate());
  writeKeypair(deployer, Keypair.generate());
  writeKeypair(authority, Keypair.generate());
  return { directory, artifact, program, buffer, deployer, authority };
}

function writeKeypair(path: string, keypair: Keypair): void {
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)));
}

function account(
  data: Buffer,
  executable: boolean,
  owner: PublicKey,
  lamports: number,
) {
  return { data, executable, lamports, owner, rentEpoch: 0 };
}
