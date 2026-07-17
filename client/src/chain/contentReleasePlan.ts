import { createHash } from "node:crypto";

import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  buildActivateContentReleasePlan,
  buildPublishCanonicalMapsPlan,
  buildSetProtocolPausePlan,
} from "./adminClient.js";
import {
  CAMPAIGN_CONTENT_VERSION,
  CANONICAL_CAMPAIGN_MAP_COUNT,
} from "./campaignCatalog.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants.js";
import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  CANONICAL_DAILY_SEASON_SEED,
  DAILY_SCORING_RULE_COUNT,
} from "./dailyRules.js";
import { inspectUpgradeableProgram } from "./deploymentRunner.js";
import { buildPublishDailyRulesPlan } from "./economyAdminClient.js";
import {
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveMapCatalogPda,
  deriveProtocolConfigPda,
} from "./pdas.js";
import { createReadOnlyWallet } from "./readOnlyWallet.js";
import { zkubeProgram } from "./runPlan.js";

const DEFAULT_DEVNET_RPC = "https://rpc.magicblock.app/devnet";
const RELEASE_DAILY_RULES_VERSION = 2;
const RELEASE_FUNDER = new PublicKey(
  "7WFy4QkiUx9GZHkVz3wdWJbdMgMf6gtK8JnbWDYqZDRA",
);
const MAX_FEE_PER_OPERATION_LAMPORTS = 10_000;
const MAX_TRANSACTION_BYTES = 1_232;

interface PublicInstruction {
  programId: string;
  dataSha256: string;
  accounts: Array<{
    pubkey: string;
    signer: boolean;
    writable: boolean;
  }>;
}

export interface ContentReleaseOperation {
  id: string;
  label: string;
  feePayer: string;
  requiredSigners: string[];
  fundingLamports: number;
  maximumFeeLamports: number;
  transactionBytes: number;
  creates: string[];
  instructions: PublicInstruction[];
}

export interface ContentReleaseApprovalPlan {
  schema: "zkube-content-release-plan";
  schemaVersion: 1;
  cluster: "devnet";
  rpc: string;
  genesisHash: string;
  program: string;
  programData: string;
  deployedSbfSha256: string;
  authority: string;
  funder: string;
  current: {
    contentVersion: number;
    dailyRulesVersion: number;
    campaignMapCount: number;
    economyRevision: string;
    paused: boolean;
  };
  target: {
    contentVersion: 2;
    dailyRulesVersion: 2;
    campaignMapCount: 10;
  };
  totalFundingLamports: number;
  maximumFeeLamports: number;
  maximumFunderSpendLamports: number;
  operations: ContentReleaseOperation[];
}

export interface ContentReleasePreview {
  plan: ContentReleaseApprovalPlan;
  fingerprint: string;
}

interface ProtocolReleaseAccount {
  version: number;
  authority: PublicKey;
  contentVersion: number;
  campaignMapCount: number;
  paused: boolean;
}

interface EconomyReleaseAccount {
  version: number;
  protocol: PublicKey;
  contentVersion: number;
  dailyRulesVersion: number;
  revision: { toString(): string };
}

interface DailyRulesReleaseAccount {
  version: number;
  rulesVersion: number;
  economyConfig: PublicKey;
  contentVersion: number;
}

interface MapReleaseAccount {
  version: number;
  contentVersion: number;
  mapId: number;
  enabled: boolean;
  levels: unknown[];
}

export async function buildContentReleasePreview(
  rpc = DEFAULT_DEVNET_RPC,
): Promise<ContentReleasePreview> {
  const connection = new Connection(rpc, "confirmed");
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const deployment = await inspectUpgradeableProgram(
    connection,
    ZKUBE_PROGRAM_ID,
  );
  const protocolAddress = deriveProtocolConfigPda();
  const economyAddress = deriveEconomyConfigPda();
  const initialWallet = createReadOnlyWallet();
  const initialProgram = zkubeProgram(connection, initialWallet);
  const [protocolInfo, economyInfo] = await connection.getMultipleAccountsInfo(
    [protocolAddress, economyAddress],
    "confirmed",
  );
  const protocol = decodeVerifiedAccount<ProtocolReleaseAccount>(
    initialProgram,
    protocolInfo,
    protocolAddress,
    initialProgram.account.protocolConfig.size,
    "protocolConfig",
  );
  const economy = decodeVerifiedAccount<EconomyReleaseAccount>(
    initialProgram,
    economyInfo,
    economyAddress,
    initialProgram.account.economyConfig.size,
    "economyConfig",
  );
  const authority = protocol.authority;
  if (
    Number(protocol.version) !== 1 ||
    Number(protocol.contentVersion) !== 1 ||
    Number(protocol.campaignMapCount) !== CANONICAL_CAMPAIGN_MAP_COUNT ||
    Boolean(protocol.paused) ||
    Number(economy.version) !== 1 ||
    !economy.protocol.equals(protocolAddress) ||
    Number(economy.contentVersion) !== 1 ||
    Number(economy.dailyRulesVersion) !== 1
  ) {
    throw new Error(
      "live protocol/economy state is not the reviewed v1 release",
    );
  }

  const v1Addresses = [
    deriveDailyRulesCatalogPda(1),
    ...Array.from({ length: CANONICAL_CAMPAIGN_MAP_COUNT }, (_, index) =>
      deriveMapCatalogPda(1, index + 1),
    ),
  ];
  const v2Addresses = [
    deriveDailyRulesCatalogPda(RELEASE_DAILY_RULES_VERSION),
    ...Array.from({ length: CANONICAL_CAMPAIGN_MAP_COUNT }, (_, index) =>
      deriveMapCatalogPda(CAMPAIGN_CONTENT_VERSION, index + 1),
    ),
  ];
  const catalogInfos = await connection.getMultipleAccountsInfo(
    [...v1Addresses, ...v2Addresses],
    "confirmed",
  );
  const dailyV1 = decodeVerifiedAccount<DailyRulesReleaseAccount>(
    initialProgram,
    catalogInfos[0] ?? null,
    v1Addresses[0]!,
    initialProgram.account.dailyRulesCatalog.size,
    "dailyRulesCatalog",
  );
  if (
    Number(dailyV1.version) !== 1 ||
    Number(dailyV1.rulesVersion) !== 1 ||
    Number(dailyV1.contentVersion) !== 1 ||
    !dailyV1.economyConfig.equals(economyAddress)
  ) {
    throw new Error("live v1 Daily rules catalog relationships are invalid");
  }
  for (let mapId = 1; mapId <= CANONICAL_CAMPAIGN_MAP_COUNT; mapId += 1) {
    const mapV1 = decodeVerifiedAccount<MapReleaseAccount>(
      initialProgram,
      catalogInfos[mapId] ?? null,
      v1Addresses[mapId]!,
      initialProgram.account.mapCatalog.size,
      "mapCatalog",
    );
    if (
      Number(mapV1.version) !== 1 ||
      Number(mapV1.contentVersion) !== 1 ||
      Number(mapV1.mapId) !== mapId ||
      !mapV1.enabled ||
      mapV1.levels.length !== 10
    ) {
      throw new Error(`live v1 Campaign map ${mapId} is invalid`);
    }
  }
  if (catalogInfos.slice(v1Addresses.length).some(Boolean)) {
    throw new Error("one or more immutable v2 release accounts already exist");
  }

  const wallet = createReadOnlyWallet(authority);
  const program = zkubeProgram(connection, wallet);
  const [mapRent, dailyRent] = await Promise.all([
    connection.getMinimumBalanceForRentExemption(
      program.account.mapCatalog.size,
      "confirmed",
    ),
    connection.getMinimumBalanceForRentExemption(
      program.account.dailyRulesCatalog.size,
      "confirmed",
    ),
  ]);
  const operations: ContentReleaseOperation[] = [];
  for (let mapId = 1; mapId <= CANONICAL_CAMPAIGN_MAP_COUNT; mapId += 1) {
    const publication = await buildPublishCanonicalMapsPlan({
      connection,
      authority: wallet,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      mapIds: [mapId],
    });
    operations.push(
      releaseOperation({
        id: `publish-campaign-v2-map-${mapId}`,
        label: `Publish immutable Campaign v2 map ${mapId}`,
        authority,
        fundingLamports: mapRent,
        creates: [deriveMapCatalogPda(CAMPAIGN_CONTENT_VERSION, mapId)],
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          SystemProgram.transfer({
            fromPubkey: RELEASE_FUNDER,
            toPubkey: authority,
            lamports: mapRent,
          }),
          ...publication.transaction.instructions,
        ],
      }),
    );
  }

  const daily = await buildPublishDailyRulesPlan({
    connection,
    authority: wallet,
    publication: {
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      rulesVersion: RELEASE_DAILY_RULES_VERSION,
      seasonId: 1,
      startsDay: 0,
      seasonSeed: CANONICAL_DAILY_SEASON_SEED,
      scoringRuleCount: DAILY_SCORING_RULE_COUNT,
      scoringRules: CANONICAL_DAILY_SCORING_RULES,
      pressure: CANONICAL_DAILY_PRESSURE,
    },
  });
  operations.push(
    releaseOperation({
      id: "publish-daily-rules-v2",
      label: "Publish unchanged immutable Daily rules v2",
      authority,
      fundingLamports: dailyRent,
      creates: [deriveDailyRulesCatalogPda(RELEASE_DAILY_RULES_VERSION)],
      instructions: [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
        SystemProgram.transfer({
          fromPubkey: RELEASE_FUNDER,
          toPubkey: authority,
          lamports: dailyRent,
        }),
        ...daily.transaction.instructions,
      ],
    }),
  );

  const [pause, activate, unpause] = await Promise.all([
    buildSetProtocolPausePlan({ connection, authority: wallet, paused: true }),
    buildActivateContentReleasePlan({
      connection,
      authority: wallet,
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      dailyRulesVersion: RELEASE_DAILY_RULES_VERSION,
      campaignMapCount: CANONICAL_CAMPAIGN_MAP_COUNT,
    }),
    buildSetProtocolPausePlan({ connection, authority: wallet, paused: false }),
  ]);
  operations.push(
    releaseOperation({
      id: "activate-content-v2",
      label: "Atomically pause, activate Campaign/Daily v2, and unpause",
      authority,
      fundingLamports: 0,
      creates: [],
      instructions: [
        ...pause.transaction.instructions,
        ...activate.transaction.instructions,
        ...unpause.transaction.instructions,
      ],
    }),
  );

  const totalFundingLamports = operations.reduce(
    (sum, operation) => sum + operation.fundingLamports,
    0,
  );
  const maximumFeeLamports = operations.reduce(
    (sum, operation) => sum + operation.maximumFeeLamports,
    0,
  );
  const plan: ContentReleaseApprovalPlan = {
    schema: "zkube-content-release-plan",
    schemaVersion: 1,
    cluster: "devnet",
    rpc,
    genesisHash,
    program: ZKUBE_PROGRAM_ID.toBase58(),
    programData: deployment.programDataAddress.toBase58(),
    deployedSbfSha256: deployment.deployedSbfSha256,
    authority: authority.toBase58(),
    funder: RELEASE_FUNDER.toBase58(),
    current: {
      contentVersion: Number(protocol.contentVersion),
      dailyRulesVersion: Number(economy.dailyRulesVersion),
      campaignMapCount: Number(protocol.campaignMapCount),
      economyRevision: economy.revision.toString(),
      paused: Boolean(protocol.paused),
    },
    target: {
      contentVersion: CAMPAIGN_CONTENT_VERSION,
      dailyRulesVersion: RELEASE_DAILY_RULES_VERSION,
      campaignMapCount: CANONICAL_CAMPAIGN_MAP_COUNT,
    },
    totalFundingLamports,
    maximumFeeLamports,
    maximumFunderSpendLamports: totalFundingLamports + maximumFeeLamports,
    operations,
  };
  return { plan, fingerprint: contentReleaseFingerprint(plan) };
}

export function contentReleaseFingerprint(
  plan: ContentReleaseApprovalPlan,
): string {
  return createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")
    .slice(0, 16);
}

export function formatContentReleasePreview(
  preview: ContentReleasePreview,
): string {
  const { plan } = preview;
  return [
    "zKube Devnet content v2 release candidate",
    "Mode: read-only plan; no transaction was signed or sent",
    `Program: ${plan.program}`,
    `ProgramData: ${plan.programData}`,
    `SBF SHA-256: ${plan.deployedSbfSha256}`,
    `Authority: ${plan.authority}`,
    `Funder / fee payer: ${plan.funder}`,
    `Current: content v${plan.current.contentVersion}, Daily v${plan.current.dailyRulesVersion}, revision ${plan.current.economyRevision}, paused=${plan.current.paused}`,
    `Target: content v${plan.target.contentVersion}, Daily v${plan.target.dailyRulesVersion}`,
    `Exact account funding: ${plan.totalFundingLamports} lamports`,
    `Maximum transaction fees: ${plan.maximumFeeLamports} lamports`,
    `Maximum funder spend: ${plan.maximumFunderSpendLamports} lamports`,
    `Approval fingerprint: ${preview.fingerprint}`,
    ...plan.operations.map((operation) =>
      [
        `${operation.id}: ${operation.label}`,
        `  creates: ${operation.creates.join(", ") || "none"}`,
        `  funding: ${operation.fundingLamports} lamports`,
        `  max fee: ${operation.maximumFeeLamports} lamports`,
        `  transaction bytes: ${operation.transactionBytes}/${MAX_TRANSACTION_BYTES}`,
        `  signers: ${operation.requiredSigners.join(", ")}`,
        ...operation.instructions.flatMap((instruction, index) => [
          `  ix ${index + 1}: ${instruction.programId} ${instruction.dataSha256}`,
          `    accounts: ${formatInstructionAccounts(instruction)}`,
        ]),
      ].join("\n"),
    ),
  ].join("\n");
}

function formatInstructionAccounts(instruction: PublicInstruction): string {
  if (instruction.accounts.length === 0) return "none";
  return instruction.accounts
    .map((account) => {
      const access = [
        account.signer ? "signer" : null,
        account.writable ? "writable" : "readonly",
      ]
        .filter(Boolean)
        .join("+");
      return `${account.pubkey}[${access}]`;
    })
    .join(", ");
}

function releaseOperation(args: {
  id: string;
  label: string;
  authority: PublicKey;
  fundingLamports: number;
  creates: PublicKey[];
  instructions: TransactionInstruction[];
}): ContentReleaseOperation {
  const requiredSigners = new Set<string>([
    RELEASE_FUNDER.toBase58(),
    args.authority.toBase58(),
  ]);
  for (const instruction of args.instructions) {
    for (const account of instruction.keys) {
      if (account.isSigner) requiredSigners.add(account.pubkey.toBase58());
    }
  }
  const transaction = new Transaction({
    feePayer: RELEASE_FUNDER,
    recentBlockhash: PublicKey.default.toBase58(),
  }).add(...args.instructions);
  const transactionBytes = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).length;
  if (transactionBytes > MAX_TRANSACTION_BYTES) {
    throw new Error(
      `${args.id} is ${transactionBytes} bytes and exceeds the Solana packet limit`,
    );
  }
  return {
    id: args.id,
    label: args.label,
    feePayer: RELEASE_FUNDER.toBase58(),
    requiredSigners: [...requiredSigners],
    fundingLamports: args.fundingLamports,
    maximumFeeLamports: MAX_FEE_PER_OPERATION_LAMPORTS,
    transactionBytes,
    creates: args.creates.map((address) => address.toBase58()),
    instructions: args.instructions.map(publicInstruction),
  };
}

function publicInstruction(
  instruction: TransactionInstruction,
): PublicInstruction {
  return {
    programId: instruction.programId.toBase58(),
    dataSha256: createHash("sha256").update(instruction.data).digest("hex"),
    accounts: instruction.keys.map((account) => ({
      pubkey: account.pubkey.toBase58(),
      signer: account.isSigner,
      writable: account.isWritable,
    })),
  };
}

function decodeVerifiedAccount<T>(
  program: ReturnType<typeof zkubeProgram>,
  info: AccountInfo<Buffer> | null,
  address: PublicKey,
  expectedSize: number,
  name: "protocolConfig" | "economyConfig" | "dailyRulesCatalog" | "mapCatalog",
): T {
  if (
    !info ||
    info.executable ||
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    info.data.length !== expectedSize
  ) {
    throw new Error(
      `${name} ${address.toBase58()} has an invalid owner or size`,
    );
  }
  return program.coder.accounts.decode(name, info.data) as T;
}
