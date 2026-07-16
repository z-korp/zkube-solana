import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";

import {
  buildActivateCampaignMapPlan,
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
} from "../../src/chain/adminClient";
import { ZKUBE_PROGRAM_ID } from "../../src/chain/constants";
import {
  derivePlayerFundingPda,
  derivePlayerStatePda,
} from "../../src/chain/pdas";
import {
  buildPrepareCampaignRunPlan,
  zkubeProgram,
  type TransactionPlan,
} from "../../src/chain/runPlan";
import {
  deriveSessionTokenV2Pda,
  SESSION_KEYS_PROGRAM_ID,
  SESSION_TOKEN_V2_ACCOUNT_BYTES,
  SESSION_TOKEN_V2_DISCRIMINATOR,
} from "../../src/chain/sessionV2";
import { SessionWallet } from "../../src/chain/sessionWallet";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const validatorBinary = resolve(root, "client/node_modules/.bin/mb-test-validator");
const programArtifact = resolve(root, "target/deploy/solana.so");
const rpcPort = 18_999;
const rpcEndpoint = `http://127.0.0.1:${rpcPort}`;
const LEGACY_PLAYER_FUNDING_DISCRIMINATOR = Buffer.from([
  61, 237, 220, 223, 77, 198, 8, 22,
]);

async function main(): Promise<void> {
  const temporary = await mkdtemp(resolve(tmpdir(), "zkube-funded-cpi-"));
  const ledger = resolve(temporary, "ledger");
  const sessionFixture = resolve(temporary, "session-token.json");
  const fundingFixture = resolve(temporary, "legacy-player-funding.json");
  const authority = Keypair.generate();
  const owner = Keypair.generate();
  const actor = Keypair.generate();
  const team = Keypair.generate();
  const treasury = Keypair.generate();
  const validUntil = Math.floor(Date.now() / 1_000) + 86_400;
  const sessionToken = deriveSessionTokenV2Pda({
    authority: owner.publicKey,
    sessionSigner: actor.publicKey,
  }).sessionToken;
  const playerFunding = derivePlayerFundingPda(owner.publicKey);
  const [, playerFundingBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("player_funding"), owner.publicKey.toBuffer()],
    ZKUBE_PROGRAM_ID,
  );
  await writeSessionFixture({
    path: sessionFixture,
    address: sessionToken,
    authority: owner.publicKey,
    sessionSigner: actor.publicKey,
    validUntil,
  });
  await writeLegacyFundingFixture({
    path: fundingFixture,
    address: playerFunding,
    owner: owner.publicKey,
    bump: playerFundingBump,
    lamports: 25_000_000,
  });

  let validator: ChildProcessWithoutNullStreams | null = null;
  try {
    validator = startValidator({
      ledger,
      sessionFixture,
      sessionToken,
      fundingFixture,
      playerFunding,
    });
    const connection = new Connection(rpcEndpoint, "confirmed");
    await waitForValidator(connection, validator);
    await Promise.all(
      [authority, owner, actor, team, treasury].map((keypair) =>
        airdrop(connection, keypair.publicKey, 5 * LAMPORTS_PER_SOL),
      ),
    );

    const authorityWallet = new SessionWallet(authority);
    const ownerWallet = new SessionWallet(owner);
    const actorWallet = new SessionWallet(actor);
    await submit(
      await buildInitializeProtocolPlan({
        connection,
        authority: authorityWallet,
        config: {
          pricingOperator: authority.publicKey,
          teamDestination: team.publicKey,
          treasuryDestination: treasury.publicKey,
          contentVersion: 1,
        },
      }),
      authorityWallet,
    );
    await submit(
      await buildPublishCanonicalMapsPlan({
        connection,
        authority: authorityWallet,
        contentVersion: 1,
        mapIds: [1],
      }),
      authorityWallet,
    );
    await submit(
      await buildActivateCampaignMapPlan({
        connection,
        authority: authorityWallet,
        contentVersion: 1,
        mapId: 1,
      }),
      authorityWallet,
    );
    await submit(
      await buildInitializePlayerPlan({ connection, owner: ownerWallet }),
      ownerWallet,
    );
    const normalizedFunding = await connection.getAccountInfo(playerFunding, "confirmed");
    if (
      !normalizedFunding ||
      normalizedFunding.executable ||
      !normalizedFunding.owner.equals(SystemProgram.programId) ||
      normalizedFunding.data.length !== 0 ||
      normalizedFunding.lamports !== 25_000_000
    ) {
      throw new Error("legacy player funding was not normalized in place");
    }
    await submit(
      {
        layer: "solana-base",
        label: "Fund local player funding PDA",
        connection,
        transaction: new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: owner.publicKey,
            toPubkey: playerFunding,
            lamports: 10_000_000,
          }),
        ),
        feePayer: owner.publicKey,
        signers: [],
      },
      ownerWallet,
    );

    const prepared = await buildPrepareCampaignRunPlan({
      wallet: actorWallet,
      ownerAuthority: owner.publicKey,
      sessionToken,
      mapId: 1,
      level: 1,
      connection,
      sessionValidUntil: validUntil,
    });
    const signature = await submit(prepared.transactionPlan, actorWallet);
    const program = zkubeProgram(connection, actorWallet);
    const profile = await program.account.playerState.fetch(
      derivePlayerStatePda(owner.publicKey),
    );
    if (profile.activeRunId.toString() !== "1" || profile.nextRunId.toString() !== "2") {
      throw new Error(
        `funded prepare did not reserve run 1 exactly once (active=${profile.activeRunId.toString()}, next=${profile.nextRunId.toString()})`,
      );
    }
    const runAccounts = await connection.getMultipleAccountsInfo([
      prepared.addresses.activeRun,
    ]);
    if (
      runAccounts.some(
        (account) =>
          !account || account.executable || !account.owner.equals(ZKUBE_PROGRAM_ID),
      )
    ) {
      throw new Error("funded prepare did not create canonical zKube run accounts");
    }
    const fundingAfterPrepare = await connection.getBalance(playerFunding, "confirmed");
    const runRent = runAccounts.reduce((total, account) => total + account!.lamports, 0);
    if (fundingAfterPrepare <= 0 || fundingAfterPrepare + runRent !== 35_000_000) {
      throw new Error("funded prepare did not conserve the 0.035 SOL rent float");
    }
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        operation: "funded_prepare_campaign_run",
        signature,
        runId: prepared.runId.toString(),
      })}\n`,
    );
  } finally {
    await stopValidator(validator);
    await rm(temporary, { recursive: true, force: true });
  }
}

async function submit(
  transactionPlan: TransactionPlan,
  wallet: SessionWallet,
): Promise<string> {
  const transaction = transactionPlan.transaction;
  transaction.feePayer = transactionPlan.feePayer;
  transaction.recentBlockhash = (
    await transactionPlan.connection.getLatestBlockhash("confirmed")
  ).blockhash;
  if (transactionPlan.signers.length > 0) {
    transaction.partialSign(...transactionPlan.signers);
  }
  const signed = await wallet.signTransaction(transaction);
  const simulation = await transactionPlan.connection.simulateTransaction(signed);
  if (simulation.value.err) {
    throw new Error(
      `Simulation failed for ${transactionPlan.label}: ${JSON.stringify(
        simulation.value.err,
      )}\n${simulation.value.logs?.join("\n") ?? "no program logs"}`,
    );
  }
  const signature = await transactionPlan.connection.sendRawTransaction(
    signed.serialize(),
    { maxRetries: 5, skipPreflight: false },
  );
  const confirmation = await transactionPlan.connection.confirmTransaction(
    signature,
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(`${transactionPlan.label} was not confirmed`);
  }
  return signature;
}

async function airdrop(
  connection: Connection,
  address: PublicKey,
  lamports: number,
): Promise<void> {
  const signature = await connection.requestAirdrop(address, lamports);
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw new Error("local airdrop failed");
}

async function writeSessionFixture(args: {
  path: string;
  address: PublicKey;
  authority: PublicKey;
  sessionSigner: PublicKey;
  validUntil: number;
}): Promise<void> {
  const data = Buffer.alloc(SESSION_TOKEN_V2_ACCOUNT_BYTES);
  Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR).copy(data, 0);
  args.authority.toBuffer().copy(data, 8);
  ZKUBE_PROGRAM_ID.toBuffer().copy(data, 40);
  args.sessionSigner.toBuffer().copy(data, 72);
  args.authority.toBuffer().copy(data, 104);
  data.writeBigInt64LE(BigInt(args.validUntil), 136);
  await writeFile(
    args.path,
    `${JSON.stringify({
      pubkey: args.address.toBase58(),
      account: {
        lamports: 2_000_000,
        data: [data.toString("base64"), "base64"],
        owner: SESSION_KEYS_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: data.byteLength,
      },
    })}\n`,
    { mode: 0o600 },
  );
}

async function writeLegacyFundingFixture(args: {
  path: string;
  address: PublicKey;
  owner: PublicKey;
  bump: number;
  lamports: number;
}): Promise<void> {
  const data = Buffer.alloc(42);
  LEGACY_PLAYER_FUNDING_DISCRIMINATOR.copy(data, 0);
  data[8] = 1;
  args.owner.toBuffer().copy(data, 9);
  data[41] = args.bump;
  await writeFile(
    args.path,
    `${JSON.stringify({
      pubkey: args.address.toBase58(),
      account: {
        lamports: args.lamports,
        data: [data.toString("base64"), "base64"],
        owner: ZKUBE_PROGRAM_ID.toBase58(),
        executable: false,
        rentEpoch: 0,
        space: data.byteLength,
      },
    })}\n`,
    { mode: 0o600 },
  );
}

function startValidator(args: {
  ledger: string;
  sessionFixture: string;
  sessionToken: PublicKey;
  fundingFixture: string;
  playerFunding: PublicKey;
}): ChildProcessWithoutNullStreams {
  return spawn(
    validatorBinary,
    [
      "--reset",
      "--quiet",
      "--ledger",
      args.ledger,
      "--rpc-port",
      String(rpcPort),
      "--faucet-port",
      "19900",
      "--dynamic-port-range",
      "20000-20100",
      "--bpf-program",
      ZKUBE_PROGRAM_ID.toBase58(),
      programArtifact,
      "--account",
      args.sessionToken.toBase58(),
      args.sessionFixture,
      "--account",
      args.playerFunding.toBase58(),
      args.fundingFixture,
    ],
    {
      cwd: root,
      env: { ...process.env, NO_DNA: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

async function waitForValidator(
  connection: Connection,
  validator: ChildProcessWithoutNullStreams,
): Promise<void> {
  let diagnostics = "";
  const capture = (chunk: Buffer) => {
    diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-8_000);
  };
  validator.stdout.on("data", capture);
  validator.stderr.on("data", capture);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (validator.exitCode !== null) {
      throw new Error(`local validator exited early\n${diagnostics}`);
    }
    try {
      await connection.getVersion();
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error(`local validator did not become ready\n${diagnostics}`);
}

async function stopValidator(
  validator: ChildProcessWithoutNullStreams | null,
): Promise<void> {
  if (!validator || validator.exitCode !== null) return;
  validator.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => validator.once("exit", () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5_000)),
  ]);
  if (validator.exitCode === null) validator.kill("SIGKILL");
}

void main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(
      `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
    );
    process.exit(1);
  },
);
