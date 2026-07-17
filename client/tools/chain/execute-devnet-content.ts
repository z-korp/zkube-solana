import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  buildActivateContentReleasePlan,
  buildPublishCanonicalMapsPlan,
  buildSetProtocolPausePlan,
} from "../../src/chain/adminClient";
import {
  CAMPAIGN_CONTENT_VERSION,
  CANONICAL_CAMPAIGN_MAP_COUNT,
} from "../../src/chain/campaignCatalog";
import {
  buildContentReleasePreview,
  type ContentReleaseOperation,
} from "../../src/chain/contentReleasePlan";
import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  CANONICAL_DAILY_SEASON_SEED,
  DAILY_SCORING_RULE_COUNT,
} from "../../src/chain/dailyRules";
import { inspectUpgradeableProgram } from "../../src/chain/deploymentRunner";
import { buildPublishDailyRulesPlan } from "../../src/chain/economyAdminClient";
import {
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveMapCatalogPda,
  deriveProtocolConfigPda,
} from "../../src/chain/pdas";
import { zkubeProgram } from "../../src/chain/runPlan";
import { SessionWallet } from "../../src/chain/sessionWallet";

const DEFAULT_RPC = "https://rpc.magicblock.app/devnet";
const APPROVED_FINGERPRINT = "7f72e4a188d6513e";
const APPROVED_SBF_SHA256 =
  "f24b7c44e336cdfb67ca7ec5903ee4eb3b63a907f2fa0a851031efbf302c8354";
const APPROVED_FUNDER = new PublicKey(
  "7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA",
);
const APPROVED_AUTHORITY = new PublicKey(
  "HmCGfPTW2ahuNySTddvbQpJxutDUhjMbR9j8ekFzHQ5b",
);
const DAILY_RULES_VERSION = 2;

interface ExecutionCandidate {
  operation: ContentReleaseOperation;
  instructions: TransactionInstruction[];
  expectedAccount?: {
    address: PublicKey;
    kind: "map" | "daily";
    mapId?: number;
  };
}

interface ExecutionResult {
  id: string;
  signature: string;
  feeLamports: number;
  unitsConsumed: number | null;
}

async function main(): Promise<void> {
  if (process.env.ZKUBE_CONTENT_SEND !== "1") {
    throw new Error("content execution requires ZKUBE_CONTENT_SEND=1");
  }
  if (process.env.ZKUBE_CONTENT_APPROVAL !== APPROVED_FINGERPRINT) {
    throw new Error(
      `content execution requires ZKUBE_CONTENT_APPROVAL=${APPROVED_FINGERPRINT}`,
    );
  }
  const rpc = process.env.ZKUBE_BASE_RPC ?? DEFAULT_RPC;
  const preview = await buildContentReleasePreview(rpc);
  if (preview.fingerprint !== APPROVED_FINGERPRINT) {
    throw new Error(
      `approved fingerprint drifted: ${preview.fingerprint} != ${APPROVED_FINGERPRINT}`,
    );
  }
  const funder = loadKeypair(
    process.env.ZKUBE_CONTENT_FUNDER_KEYPAIR ??
      "../../cycling-sim/.devnet/deployer.json",
    "content funder",
  );
  const authority = loadKeypair(
    process.env.ZKUBE_CONTENT_AUTHORITY_KEYPAIR ??
      "../.devnet/zkube-governance-authority.json",
    "content authority",
  );
  if (
    !funder.publicKey.equals(APPROVED_FUNDER) ||
    !authority.publicKey.equals(APPROVED_AUTHORITY) ||
    preview.plan.funder !== funder.publicKey.toBase58() ||
    preview.plan.authority !== authority.publicKey.toBase58()
  ) {
    throw new Error("content signer identity does not match the approval");
  }

  const connection = new Connection(rpc, "confirmed");
  const candidates = await buildCandidates(
    connection,
    authority,
    preview.plan.operations,
  );
  const balanceBefore = await connection.getBalance(
    funder.publicKey,
    "confirmed",
  );
  if (balanceBefore < preview.plan.maximumFunderSpendLamports) {
    throw new Error("content funder is below the approved spend ceiling");
  }

  const results: ExecutionResult[] = [];
  for (const candidate of candidates) {
    assertCandidateMatches(candidate);
    await assertProgramUnchanged(connection);
    if (candidate.expectedAccount) {
      const existing = await connection.getAccountInfo(
        candidate.expectedAccount.address,
        "confirmed",
      );
      if (existing) {
        throw new Error(
          `${candidate.operation.id} target already exists before execution`,
        );
      }
    }
    results.push(
      await executeCandidate(connection, funder, authority, candidate),
    );
    await verifyCandidatePostcondition(connection, candidate);
    const balanceNow = await connection.getBalance(
      funder.publicKey,
      "confirmed",
    );
    const maximumSpendSoFar = candidates
      .slice(0, results.length)
      .reduce(
        (sum, completed) =>
          sum +
          completed.operation.fundingLamports +
          completed.operation.maximumFeeLamports,
        0,
      );
    if (balanceBefore - balanceNow > maximumSpendSoFar) {
      throw new Error(
        "content funder spend exceeded the approved running ceiling",
      );
    }
    process.stdout.write(
      `${candidate.operation.id}: ${results.at(-1)!.signature}\n`,
    );
  }

  await verifyFinalState(connection);
  const balanceAfter = await connection.getBalance(
    funder.publicKey,
    "confirmed",
  );
  const actualSpend = balanceBefore - balanceAfter;
  if (actualSpend > preview.plan.maximumFunderSpendLamports) {
    throw new Error(
      "content release exceeded the approved total spend ceiling",
    );
  }
  process.stdout.write(
    [
      `Content release ${APPROVED_FINGERPRINT} activated`,
      `Transactions: ${results.length}`,
      `Actual funder spend: ${actualSpend} lamports`,
      ...results.map(
        (result) =>
          `${result.id}: fee=${result.feeLamports}, units=${result.unitsConsumed ?? "unknown"}, signature=${result.signature}`,
      ),
    ].join("\n") + "\n",
  );
}

async function buildCandidates(
  connection: Connection,
  authority: Keypair,
  approved: ContentReleaseOperation[],
): Promise<ExecutionCandidate[]> {
  if (approved.length !== 12) {
    throw new Error("approved content release must contain 12 operations");
  }
  const wallet = new SessionWallet(authority);
  const candidates: ExecutionCandidate[] = [];
  for (let mapId = 1; mapId <= CANONICAL_CAMPAIGN_MAP_COUNT; mapId += 1) {
    const operation = approved[mapId - 1]!;
    const publication = await buildPublishCanonicalMapsPlan({
      connection,
      authority: wallet,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      mapIds: [mapId],
    });
    candidates.push({
      operation,
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        SystemProgram.transfer({
          fromPubkey: APPROVED_FUNDER,
          toPubkey: APPROVED_AUTHORITY,
          lamports: operation.fundingLamports,
        }),
        ...publication.transaction.instructions,
      ],
      expectedAccount: {
        address: deriveMapCatalogPda(CAMPAIGN_CONTENT_VERSION, mapId),
        kind: "map",
        mapId,
      },
    });
  }

  const dailyOperation = approved[10]!;
  const daily = await buildPublishDailyRulesPlan({
    connection,
    authority: wallet,
    publication: {
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      rulesVersion: DAILY_RULES_VERSION,
      seasonId: 1,
      startsDay: 0,
      seasonSeed: CANONICAL_DAILY_SEASON_SEED,
      scoringRuleCount: DAILY_SCORING_RULE_COUNT,
      scoringRules: CANONICAL_DAILY_SCORING_RULES,
      pressure: CANONICAL_DAILY_PRESSURE,
    },
  });
  candidates.push({
    operation: dailyOperation,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
      SystemProgram.transfer({
        fromPubkey: APPROVED_FUNDER,
        toPubkey: APPROVED_AUTHORITY,
        lamports: dailyOperation.fundingLamports,
      }),
      ...daily.transaction.instructions,
    ],
    expectedAccount: {
      address: deriveDailyRulesCatalogPda(DAILY_RULES_VERSION),
      kind: "daily",
    },
  });

  const [pause, activate, unpause] = await Promise.all([
    buildSetProtocolPausePlan({ connection, authority: wallet, paused: true }),
    buildActivateContentReleasePlan({
      connection,
      authority: wallet,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      dailyRulesVersion: DAILY_RULES_VERSION,
      campaignMapCount: CANONICAL_CAMPAIGN_MAP_COUNT,
    }),
    buildSetProtocolPausePlan({ connection, authority: wallet, paused: false }),
  ]);
  candidates.push({
    operation: approved[11]!,
    instructions: [
      ...pause.transaction.instructions,
      ...activate.transaction.instructions,
      ...unpause.transaction.instructions,
    ],
  });
  return candidates;
}

function assertCandidateMatches(candidate: ExecutionCandidate): void {
  const operation = candidate.operation;
  if (
    operation.feePayer !== APPROVED_FUNDER.toBase58() ||
    operation.requiredSigners.length !== 2 ||
    !operation.requiredSigners.includes(APPROVED_FUNDER.toBase58()) ||
    !operation.requiredSigners.includes(APPROVED_AUTHORITY.toBase58()) ||
    operation.instructions.length !== candidate.instructions.length
  ) {
    throw new Error(`${operation.id} signer or instruction layout drifted`);
  }
  candidate.instructions.forEach((instruction, index) => {
    const expected = operation.instructions[index]!;
    const actual = {
      programId: instruction.programId.toBase58(),
      dataSha256: createHash("sha256").update(instruction.data).digest("hex"),
      accounts: instruction.keys.map((account) => ({
        pubkey: account.pubkey.toBase58(),
        signer: account.isSigner,
        writable: account.isWritable,
      })),
    };
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${operation.id} instruction ${index + 1} drifted`);
    }
  });
  const transaction = new Transaction({
    feePayer: APPROVED_FUNDER,
    recentBlockhash: PublicKey.default.toBase58(),
  }).add(...candidate.instructions);
  const size = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  if (size !== operation.transactionBytes) {
    throw new Error(`${operation.id} packet size drifted`);
  }
}

async function executeCandidate(
  connection: Connection,
  funder: Keypair,
  authority: Keypair,
  candidate: ExecutionCandidate,
): Promise<ExecutionResult> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: funder.publicKey,
    recentBlockhash: latest.blockhash,
  }).add(...candidate.instructions);
  const fee = await connection.getFeeForMessage(
    transaction.compileMessage(),
    "confirmed",
  );
  if (
    fee.value === null ||
    fee.value > candidate.operation.maximumFeeLamports
  ) {
    throw new Error(`${candidate.operation.id} fee exceeds its approved cap`);
  }
  transaction.partialSign(funder, authority);
  const serialized = transaction.serialize();
  if (serialized.length !== candidate.operation.transactionBytes) {
    throw new Error(`${candidate.operation.id} signed packet size drifted`);
  }
  const simulation = await connection.simulateTransaction(
    VersionedTransaction.deserialize(serialized),
    {
      commitment: "confirmed",
      sigVerify: true,
      replaceRecentBlockhash: false,
    },
  );
  if (simulation.value.err) {
    throw new Error(
      `${candidate.operation.id} simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
    );
  }
  const signature = await connection.sendRawTransaction(serialized, {
    maxRetries: 5,
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `${candidate.operation.id} failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  return {
    id: candidate.operation.id,
    signature,
    feeLamports: fee.value,
    unitsConsumed: simulation.value.unitsConsumed ?? null,
  };
}

async function assertProgramUnchanged(connection: Connection): Promise<void> {
  const deployment = await inspectUpgradeableProgram(
    connection,
    new PublicKey("Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR"),
  );
  if (deployment.deployedSbfSha256 !== APPROVED_SBF_SHA256) {
    throw new Error("deployed SBF changed after content approval");
  }
}

async function verifyCandidatePostcondition(
  connection: Connection,
  candidate: ExecutionCandidate,
): Promise<void> {
  if (!candidate.expectedAccount) return;
  const program = zkubeProgram(
    connection,
    new SessionWallet(Keypair.generate()),
  );
  const info = await connection.getAccountInfo(
    candidate.expectedAccount.address,
    "confirmed",
  );
  const expectedSize =
    candidate.expectedAccount.kind === "map"
      ? program.account.mapCatalog.size
      : program.account.dailyRulesCatalog.size;
  if (
    !info ||
    info.executable ||
    !info.owner.equals(program.programId) ||
    info.data.length !== expectedSize
  ) {
    throw new Error(`${candidate.operation.id} account postcondition failed`);
  }
  if (candidate.expectedAccount.kind === "map") {
    const account = program.coder.accounts.decode("mapCatalog", info.data);
    if (
      Number(account.version) !== 1 ||
      Number(account.contentVersion) !== CAMPAIGN_CONTENT_VERSION ||
      Number(account.mapId) !== candidate.expectedAccount.mapId ||
      !account.enabled ||
      account.levels.length !== 10
    ) {
      throw new Error(
        `${candidate.operation.id} map decode postcondition failed`,
      );
    }
  } else {
    const account = program.coder.accounts.decode(
      "dailyRulesCatalog",
      info.data,
    );
    if (
      Number(account.version) !== 1 ||
      Number(account.contentVersion) !== CAMPAIGN_CONTENT_VERSION ||
      Number(account.rulesVersion) !== DAILY_RULES_VERSION ||
      !account.economyConfig.equals(deriveEconomyConfigPda())
    ) {
      throw new Error(
        `${candidate.operation.id} Daily decode postcondition failed`,
      );
    }
  }
}

async function verifyFinalState(connection: Connection): Promise<void> {
  await assertProgramUnchanged(connection);
  const program = zkubeProgram(
    connection,
    new SessionWallet(Keypair.generate()),
  );
  const [protocol, economy] = await Promise.all([
    program.account.protocolConfig.fetch(deriveProtocolConfigPda()),
    program.account.economyConfig.fetch(deriveEconomyConfigPda()),
  ]);
  if (
    Number(protocol.version) !== 1 ||
    !protocol.authority.equals(APPROVED_AUTHORITY) ||
    Number(protocol.contentVersion) !== CAMPAIGN_CONTENT_VERSION ||
    Number(protocol.campaignMapCount) !== CANONICAL_CAMPAIGN_MAP_COUNT ||
    protocol.paused ||
    Number(economy.version) !== 1 ||
    !economy.protocol.equals(deriveProtocolConfigPda()) ||
    Number(economy.contentVersion) !== CAMPAIGN_CONTENT_VERSION ||
    Number(economy.dailyRulesVersion) !== DAILY_RULES_VERSION ||
    economy.revision.toString() !== "3"
  ) {
    throw new Error("activated Campaign/Daily v2 postcondition failed");
  }
}

function loadKeypair(path: string, label: string): Keypair {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(resolve(path), "utf8"));
  } catch (error) {
    throw new Error(`unable to read ${label}: ${(error as Error).message}`);
  }
  if (
    !Array.isArray(value) ||
    value.length !== 64 ||
    !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new Error(`${label} must be a 64-byte JSON keypair`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(value as number[]));
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
