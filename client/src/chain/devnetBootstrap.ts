import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeAccount3Instruction,
  getAccount,
  getMint,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  buildActivateCampaignMapPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
} from "./adminClient";
import { CANONICAL_CAMPAIGN_MAP_COUNT } from "./campaignCatalog";
import {
  buildInitializeEconomyPlan,
  buildPublishDailyRulesPlan,
} from "./economyAdminClient";
import {
  deriveDailyRulesCatalogPda,
  deriveEconomyConfigPda,
  deriveMapCatalogPda,
  deriveProtocolConfigPda,
  deriveStarSalesLedgerPda,
} from "./pdas";
import { SessionWallet } from "./sessionWallet";
import { zkubeProgram } from "./runPlan";
import {
  CANONICAL_DEVNET_USDC_MINT,
  SOLANA_DEVNET_GENESIS_HASH,
  ZKUBE_PROGRAM_ID,
} from "./constants";
import {
  CANONICAL_DAILY_PRESSURE,
  CANONICAL_DAILY_SCORING_RULES,
  CANONICAL_DAILY_SEASON_SEED,
  DAILY_SCORING_RULE_COUNT,
} from "./dailyRules";

export const DEVNET_USDC_MINT = CANONICAL_DEVNET_USDC_MINT;
export const DEFAULT_BOOTSTRAP_RPC = "https://rpc.magicblock.app/devnet";
export const DEFAULT_PAYMASTER_FUNDING_LAMPORTS = 100_000_000;
export const DEPLOYED_ZKUBE_SBF_SHA256 =
  "dd187f69f8c0c3cfb3fcdb9366c5af88a948a27e41ac26e6db3a1d4fc6268be5";

export type DevnetBootstrapStage =
  | "custody"
  | "protocol"
  | "economy"
  | "daily-rules"
  | "maps"
  | "activation";

type VaultName = "team" | "treasury" | "reward";

interface BootstrapIdentities {
  funder: Keypair;
  authority: Keypair;
  paymaster: Keypair;
  vaults: Record<VaultName, Keypair>;
}

interface ProtocolConfigView {
  version: number;
  authority: PublicKey;
  pricingOperator: PublicKey;
  paymaster: PublicKey;
  teamDestination: PublicKey;
  treasuryDestination: PublicKey;
  rewardVault: PublicKey;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  contentVersion: number;
  campaignMapCount: number;
}

interface BootstrapBatch {
  id: string;
  label: string;
  transaction: Transaction;
  signers: Keypair[];
  fundingLamports: number;
  creates: string[];
}

export interface PublicBootstrapBatch {
  id: string;
  label: string;
  feePayer: string;
  requiredSigners: string[];
  fundingLamports: number;
  creates: string[];
  instructions: Array<{
    programId: string;
    dataSha256: string;
    accounts: Array<{
      pubkey: string;
      signer: boolean;
      writable: boolean;
    }>;
  }>;
}

export interface PublicBootstrapPlan {
  schema: "zkube-devnet-bootstrap-plan";
  schemaVersion: 1;
  cluster: "devnet";
  stage: DevnetBootstrapStage;
  rpc: string;
  genesisHash: string;
  program: string;
  deployment: {
    programData: string;
    deployedSlot: string;
    upgradeAuthority: string | null;
    sbfSha256: string;
  };
  payment: { mint: string; tokenProgram: string; decimals: 6 };
  identities: {
    funder: string;
    authority: string;
    paymaster: string;
  };
  vaults: Record<VaultName, string>;
  pdas: {
    protocol: string;
    economy: string;
    starSalesLedger: string;
    dailyRulesCatalog: string;
  };
  policy: {
    paymasterFundingLamports: number;
    contentVersion: number;
    dailyRulesVersion: number;
  };
  batches: PublicBootstrapBatch[];
}

export interface DevnetBootstrapInput {
  stage: DevnetBootstrapStage;
  connection: Connection;
  rpc: string;
  identities: BootstrapIdentities;
  paymasterFundingLamports: number;
  sendEnabled: boolean;
  suppliedApproval?: string;
  proofOut?: string;
  candidateOut?: string;
}

export interface DevnetBootstrapPreview {
  input: DevnetBootstrapInput;
  plan: PublicBootstrapPlan;
  fingerprint: string;
  batches: BootstrapBatch[];
  simulations: Array<{
    id: string;
    unitsConsumed: number | null;
    feeLamports: number;
    logs: string[];
  }>;
  signatures: string[];
}

interface LiveProgramDeployment {
  programData: string;
  deployedSlot: string;
  upgradeAuthority: string | null;
  sbfSha256: string;
}

const POLICY = {
  contentVersion: 1,
  dailyRulesVersion: 1,
} as const;

const VAULT_PATHS: Record<VaultName, string> = {
  team: "../.devnet/zkube-team-vault.json",
  treasury: "../.devnet/zkube-treasury-vault.json",
  reward: "../.devnet/zkube-reward-vault.json",
};

function canonicalDailyRulesPublication() {
  return {
    rulesVersion: POLICY.dailyRulesVersion,
    seasonId: 1,
    startsDay: 0,
    seasonSeed: CANONICAL_DAILY_SEASON_SEED,
    scoringRuleCount: DAILY_SCORING_RULE_COUNT,
    scoringRules: CANONICAL_DAILY_SCORING_RULES,
    pressure: CANONICAL_DAILY_PRESSURE,
  };
}

export function devnetBootstrapInputFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): DevnetBootstrapInput {
  const stage = bootstrapStage(env.ZKUBE_BOOTSTRAP_STAGE);
  const rpc = devnetRpc(env.ZKUBE_BASE_RPC ?? DEFAULT_BOOTSTRAP_RPC);
  const paymasterFundingLamports = positiveSafeInteger(
    env.ZKUBE_PAYMASTER_FUNDING_LAMPORTS ??
      String(DEFAULT_PAYMASTER_FUNDING_LAMPORTS),
    "ZKUBE_PAYMASTER_FUNDING_LAMPORTS",
  );
  const vaults = Object.fromEntries(
    Object.entries(VAULT_PATHS).map(([name, defaultPath]) => [
      name,
      loadKeypair(
        resolve(
          cwd,
          env[`ZKUBE_${name.toUpperCase()}_VAULT_KEYPAIR`] ?? defaultPath,
        ),
        `${name} vault`,
      ),
    ]),
  ) as Record<VaultName, Keypair>;
  return {
    stage,
    rpc,
    connection: new Connection(rpc, "confirmed"),
    identities: {
      funder: loadKeypair(
        resolve(
          cwd,
          env.ZKUBE_BOOTSTRAP_FUNDER_KEYPAIR ??
            "../../cycling-sim/.devnet/deployer.json",
        ),
        "bootstrap funder",
      ),
      authority: loadKeypair(
        resolve(
          cwd,
          env.ZKUBE_PROTOCOL_AUTHORITY_KEYPAIR ??
            "../.devnet/zkube-protocol-authority.json",
        ),
        "protocol authority",
      ),
      paymaster: loadKeypair(
        resolve(
          cwd,
          env.ZKUBE_PAYMASTER_KEYPAIR ?? "../.devnet/zkube-paymaster.json",
        ),
        "paymaster",
      ),
      vaults,
    },
    paymasterFundingLamports,
    sendEnabled: env.ZKUBE_BOOTSTRAP_SEND === "1",
    suppliedApproval: env.ZKUBE_BOOTSTRAP_APPROVAL?.trim() || undefined,
    proofOut: env.ZKUBE_BOOTSTRAP_PROOF_OUT?.trim() || undefined,
    candidateOut:
      env.ZKUBE_BOOTSTRAP_CANDIDATE_OUT?.trim() ||
      resolve(cwd, `../artifacts/devnet-bootstrap.${stage}.candidate.json`),
  };
}

export async function runDevnetBootstrap(
  input: DevnetBootstrapInput,
): Promise<DevnetBootstrapPreview> {
  const deployment = await verifyDevnetIdentity(input);
  const batches = await buildStageBatches(input);
  const plan = publicPlan(input, batches, deployment);
  const fingerprint = bootstrapFingerprint(plan);
  const simulations = await simulateBatches(input.connection, batches);
  const signatures: string[] = [];

  if (input.sendEnabled) {
    if (input.suppliedApproval !== fingerprint) {
      throw new Error(
        `bootstrap blocked: set ZKUBE_BOOTSTRAP_APPROVAL=${fingerprint} only after explicit approval`,
      );
    }
    for (const batch of batches) {
      signatures.push(await executeBatch(input.connection, batch));
    }
    await verifyStagePostconditions(input);
  }

  const result = {
    input,
    plan,
    fingerprint,
    batches,
    simulations,
    signatures,
  };
  if (input.candidateOut) writeCandidate(input.candidateOut, result);
  if (input.proofOut && signatures.length > 0) {
    writeProof(input.proofOut, result);
  }
  return result;
}

export function bootstrapFingerprint(plan: PublicBootstrapPlan): string {
  return createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")
    .slice(0, 16);
}

export function formatDevnetBootstrap(result: DevnetBootstrapPreview): string {
  const { plan } = result;
  return [
    "zKube Devnet bootstrap",
    `Mode: ${result.signatures.length > 0 ? "executed" : "dry-run"}`,
    `Stage: ${plan.stage}`,
    `RPC: ${plan.rpc}`,
    `Program: ${plan.program}`,
    `Canonical USDC: ${plan.payment.mint} (${plan.payment.decimals} decimals)`,
    `Funder: ${plan.identities.funder}`,
    `Governance authority: ${plan.identities.authority}`,
    `Paymaster: ${plan.identities.paymaster}`,
    `Approval fingerprint: ${result.fingerprint}`,
    ...result.batches.map((batch, index) => {
      const simulation = result.simulations[index];
      return [
        `[${result.signatures.length > 0 ? "executed" : "simulated"}] ${batch.id}: ${batch.label}`,
        `  funding: ${batch.fundingLamports} lamports`,
        `  creates: ${batch.creates.join(", ") || "none"}`,
        `  required signers: ${plan.batches[index]?.requiredSigners.join(", ") ?? "none"}`,
        `  estimated fee: ${simulation?.feeLamports ?? "unknown"} lamports`,
        `  units consumed: ${simulation?.unitsConsumed ?? "unknown"}`,
        ...(result.signatures[index]
          ? [`  signature: ${result.signatures[index]}`]
          : []),
      ].join("\n");
    }),
    ...(result.batches.length === 0
      ? ["Stage already satisfies its verified on-chain postconditions."]
      : result.signatures.length === 0
        ? [
            "No transaction was signed or sent.",
            `To execute only after approval: ZKUBE_BOOTSTRAP_SEND=1 ZKUBE_BOOTSTRAP_APPROVAL=${result.fingerprint}`,
          ]
        : []),
  ].join("\n");
}

async function verifyDevnetIdentity(
  input: DevnetBootstrapInput,
): Promise<LiveProgramDeployment> {
  const [genesis, programInfo, mint] = await Promise.all([
    input.connection.getGenesisHash(),
    input.connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed"),
    getMint(input.connection, DEVNET_USDC_MINT, "confirmed", TOKEN_PROGRAM_ID),
  ]);
  if (genesis !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(`Devnet genesis mismatch: received ${genesis}`);
  }
  if (!programInfo?.executable) {
    throw new Error("deployed zKube program is missing or not executable");
  }
  if (mint.decimals !== 6) {
    throw new Error("canonical Devnet USDC mint must use six decimals");
  }
  if (programInfo.data.length < 36 || programInfo.data.readUInt32LE(0) !== 2) {
    throw new Error("zKube is not an upgradeable-loader Program account");
  }
  const programDataAddress = new PublicKey(programInfo.data.subarray(4, 36));
  const programData = await input.connection.getAccountInfo(
    programDataAddress,
    "confirmed",
  );
  if (
    !programData ||
    programData.data.length < 45 ||
    programData.data.readUInt32LE(0) !== 3
  ) {
    throw new Error("zKube ProgramData account is missing or malformed");
  }
  const hasAuthority = programData.data[12] === 1;
  const codeOffset = hasAuthority ? 45 : 13;
  const sbfSha256 = createHash("sha256")
    .update(programData.data.subarray(codeOffset))
    .digest("hex");
  if (sbfSha256 !== DEPLOYED_ZKUBE_SBF_SHA256) {
    throw new Error(
      `deployed zKube SBF hash ${sbfSha256} does not match the reviewed release`,
    );
  }
  return {
    programData: programDataAddress.toBase58(),
    deployedSlot: programData.data.readBigUInt64LE(4).toString(),
    upgradeAuthority: hasAuthority
      ? new PublicKey(programData.data.subarray(13, 45)).toBase58()
      : null,
    sbfSha256,
  };
}

async function buildStageBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  switch (input.stage) {
    case "custody":
      return buildCustodyBatches(input);
    case "protocol":
      return buildProtocolBatches(input);
    case "economy":
      return buildEconomyBatches(input);
    case "daily-rules":
      return buildDailyRulesBatches(input);
    case "maps":
      return buildMapBatches(input);
    case "activation":
      return buildActivationBatches(input);
  }
}

async function buildCustodyBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  const { funder, authority, paymaster, vaults } = input.identities;
  const protocol = deriveProtocolConfigPda();
  const vaultOwners: Record<VaultName, PublicKey> = {
    team: authority.publicKey,
    treasury: authority.publicKey,
    reward: protocol,
  };
  const rent = await input.connection.getMinimumBalanceForRentExemption(
    ACCOUNT_SIZE,
    "confirmed",
  );
  const batches: BootstrapBatch[] = [];
  for (const name of Object.keys(vaults) as VaultName[]) {
    const keypair = vaults[name];
    const existing = await input.connection.getAccountInfo(
      keypair.publicKey,
      "confirmed",
    );
    if (existing) {
      await verifyVault(input.connection, keypair.publicKey, vaultOwners[name]);
      continue;
    }
    const transaction = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: funder.publicKey,
        newAccountPubkey: keypair.publicKey,
        lamports: rent,
        space: ACCOUNT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeAccount3Instruction(
        keypair.publicKey,
        DEVNET_USDC_MINT,
        vaultOwners[name],
        TOKEN_PROGRAM_ID,
      ),
    );
    transaction.feePayer = funder.publicKey;
    batches.push({
      id: `create-${name}-vault`,
      label: `Create segregated ${name} USDC vault`,
      transaction,
      signers: [funder, keypair],
      fundingLamports: rent,
      creates: [keypair.publicKey.toBase58()],
    });
  }
  const paymasterBalance = await input.connection.getBalance(
    paymaster.publicKey,
    "confirmed",
  );
  const topUp = Math.max(0, input.paymasterFundingLamports - paymasterBalance);
  if (topUp > 0) {
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: funder.publicKey,
        toPubkey: paymaster.publicKey,
        lamports: topUp,
      }),
    );
    transaction.feePayer = funder.publicKey;
    batches.push({
      id: "fund-paymaster",
      label: "Fund the capped stateless Devnet paymaster",
      transaction,
      signers: [funder],
      fundingLamports: topUp,
      creates: [],
    });
  }
  await assertFunderHeadroom(input, batches);
  return batches;
}

async function buildProtocolBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  await verifyAllVaults(input);
  const { funder, authority, paymaster, vaults } = input.identities;
  const program = zkubeProgram(input.connection, new SessionWallet(authority));
  const protocol = await program.account.protocolConfig.fetchNullable(
    deriveProtocolConfigPda(),
  );
  if (protocol) {
    verifyProtocolConfig(protocol, input);
    return [];
  }
  const rentFunding = await input.connection.getMinimumBalanceForRentExemption(
    program.account.protocolConfig.size,
    "confirmed",
  );
  const plan = await buildInitializeProtocolPlan({
    connection: input.connection,
    authority: new SessionWallet(authority),
    config: {
      paymaster: paymaster.publicKey,
      pricingOperator: authority.publicKey,
      teamDestination: vaults.team.publicKey,
      treasuryDestination: vaults.treasury.publicKey,
      rewardVault: vaults.reward.publicKey,
      paymentMint: DEVNET_USDC_MINT,
      paymentTokenProgram: TOKEN_PROGRAM_ID,
      contentVersion: POLICY.contentVersion,
    },
  });
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: authority.publicKey,
      lamports: rentFunding,
    }),
    ...plan.transaction.instructions,
  );
  transaction.feePayer = funder.publicKey;
  const batch = {
    id: "initialize-protocol",
    label: "Initialize protocol with external revenue destinations",
    transaction,
    signers: [funder, authority],
    fundingLamports: rentFunding,
    creates: [deriveProtocolConfigPda().toBase58()],
  };
  await assertFunderHeadroom(input, [batch]);
  return [batch];
}

async function fetchVerifiedProtocol(
  input: DevnetBootstrapInput,
): Promise<ProtocolConfigView> {
  await verifyAllVaults(input);
  const { authority } = input.identities;
  const wallet = new SessionWallet(authority);
  const program = zkubeProgram(input.connection, wallet);
  const protocol = await program.account.protocolConfig.fetchNullable(
    deriveProtocolConfigPda(),
  );
  if (!protocol) {
    throw new Error("ProtocolConfig must be initialized before this stage");
  }
  verifyProtocolConfig(protocol, input);
  return protocol;
}

async function buildEconomyBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  await fetchVerifiedProtocol(input);
  const { funder, authority } = input.identities;
  const wallet = new SessionWallet(authority);
  const program = zkubeProgram(input.connection, wallet);
  const economyAddress = deriveEconomyConfigPda();
  const salesAddress = deriveStarSalesLedgerPda();
  const [economyInfo, salesInfo] =
    await input.connection.getMultipleAccountsInfo(
      [economyAddress, salesAddress],
      "confirmed",
    );
  if (Boolean(economyInfo) !== Boolean(salesInfo)) {
    throw new Error(
      "partial economy foundation exists; manual recovery is required",
    );
  }
  if (economyInfo) {
    await verifyEconomyFoundation(input);
    return [];
  }
  const rent = await Promise.all(
    [
      program.account.economyConfig.size,
      program.account.starSalesLedger.size,
    ].map((size) =>
      input.connection.getMinimumBalanceForRentExemption(size, "confirmed"),
    ),
  );
  const economy = await buildInitializeEconomyPlan({
    connection: input.connection,
    authority: wallet,
    config: {
      dailyRulesVersion: POLICY.dailyRulesVersion,
      paymentMint: DEVNET_USDC_MINT,
    },
  });
  const batch = fundedAuthorityBatch({
    id: "initialize-economy",
    label: "Initialize canonical Stars economy",
    funder,
    authority,
    rent: rent[0] + rent[1],
    instructions: economy.transaction.instructions,
    creates: [economyAddress.toBase58(), salesAddress.toBase58()],
  });
  await assertFunderHeadroom(input, [batch]);
  return [batch];
}

async function buildDailyRulesBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  await fetchVerifiedProtocol(input);
  await verifyEconomyFoundation(input);
  const { funder, authority } = input.identities;
  const wallet = new SessionWallet(authority);
  const program = zkubeProgram(input.connection, wallet);
  const rulesAddress = deriveDailyRulesCatalogPda(POLICY.dailyRulesVersion);
  const existing = await input.connection.getAccountInfo(
    rulesAddress,
    "confirmed",
  );
  if (existing) {
    requireProgramOwned(existing, rulesAddress, "Daily rules catalog");
    return [];
  }
  const rent = await input.connection.getMinimumBalanceForRentExemption(
    program.account.dailyRulesCatalog.size,
    "confirmed",
  );
  const rules = await buildPublishDailyRulesPlan({
    connection: input.connection,
    authority: wallet,
    publication: canonicalDailyRulesPublication(),
  });
  const batch = fundedAuthorityBatch({
    id: "publish-daily-rules",
    label: "Publish canonical Daily rules",
    funder,
    authority,
    rent,
    instructions: rules.transaction.instructions,
    creates: [rulesAddress.toBase58()],
  });
  await assertFunderHeadroom(input, [batch]);
  return [batch];
}

async function buildMapBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  await fetchVerifiedProtocol(input);
  const { funder, authority } = input.identities;
  const wallet = new SessionWallet(authority);
  const program = zkubeProgram(input.connection, wallet);
  const batches: BootstrapBatch[] = [];
  const mapRent = await input.connection.getMinimumBalanceForRentExemption(
    program.account.mapCatalog.size,
    "confirmed",
  );
  for (let mapId = 1; mapId <= CANONICAL_CAMPAIGN_MAP_COUNT; mapId += 1) {
    const address = deriveMapCatalogPda(POLICY.contentVersion, mapId);
    const existing = await input.connection.getAccountInfo(
      address,
      "confirmed",
    );
    if (existing) {
      requireProgramOwned(existing, address, `campaign map ${mapId}`);
      continue;
    }
    const map = await buildPublishCanonicalMapsPlan({
      connection: input.connection,
      authority: wallet,
      contentVersion: POLICY.contentVersion,
      mapIds: [mapId],
    });
    batches.push(
      fundedAuthorityBatch({
        id: `publish-map-${mapId}`,
        label: `Publish canonical campaign map ${mapId}`,
        funder,
        authority,
        rent: mapRent,
        computeUnitLimit: 400_000,
        instructions: map.transaction.instructions,
        creates: [address.toBase58()],
      }),
    );
  }
  await assertFunderHeadroom(input, batches);
  return batches;
}

async function buildActivationBatches(
  input: DevnetBootstrapInput,
): Promise<BootstrapBatch[]> {
  const protocol = await fetchVerifiedProtocol(input);
  await verifyMapAccounts(input);
  const { funder, authority } = input.identities;
  const wallet = new SessionWallet(authority);
  const activeMapCount = Number(protocol.campaignMapCount);
  if (activeMapCount >= CANONICAL_CAMPAIGN_MAP_COUNT) return [];
  const activations = await Promise.all(
    Array.from(
      { length: CANONICAL_CAMPAIGN_MAP_COUNT - activeMapCount },
      (_, index) => activeMapCount + index + 1,
    ).map((mapId) =>
      buildActivateCampaignMapPlan({
        connection: input.connection,
        authority: wallet,
        contentVersion: POLICY.contentVersion,
        mapId,
      }),
    ),
  );
  const batch = fundedAuthorityBatch({
    id: "activate-campaign-maps",
    label: `Activate campaign maps ${activeMapCount + 1}-${CANONICAL_CAMPAIGN_MAP_COUNT}`,
    funder,
    authority,
    rent: 0,
    instructions: activations.flatMap((plan) => plan.transaction.instructions),
    creates: [],
  });
  await assertFunderHeadroom(input, [batch]);
  return [batch];
}

function fundedAuthorityBatch(args: {
  id: string;
  label: string;
  funder: Keypair;
  authority: Keypair;
  rent: number;
  computeUnitLimit?: number;
  instructions: TransactionInstruction[];
  creates: string[];
}): BootstrapBatch {
  const transaction = new Transaction();
  if (args.computeUnitLimit !== undefined) {
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: args.computeUnitLimit,
      }),
    );
  }
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: args.funder.publicKey,
      toPubkey: args.authority.publicKey,
      lamports: args.rent,
    }),
    ...args.instructions,
  );
  transaction.feePayer = args.funder.publicKey;
  return {
    id: args.id,
    label: args.label,
    transaction,
    signers: [args.funder, args.authority],
    fundingLamports: args.rent,
    creates: args.creates,
  };
}

async function verifyAllVaults(input: DevnetBootstrapInput): Promise<void> {
  const { authority, vaults } = input.identities;
  const protocol = deriveProtocolConfigPda();
  await Promise.all([
    verifyVault(input.connection, vaults.team.publicKey, authority.publicKey),
    verifyVault(
      input.connection,
      vaults.treasury.publicKey,
      authority.publicKey,
    ),
    verifyVault(input.connection, vaults.reward.publicKey, protocol),
  ]);
}

async function verifyVault(
  connection: Connection,
  address: PublicKey,
  owner: PublicKey,
): Promise<void> {
  const account = await getAccount(
    connection,
    address,
    "confirmed",
    TOKEN_PROGRAM_ID,
  );
  if (!account.mint.equals(DEVNET_USDC_MINT) || !account.owner.equals(owner)) {
    throw new Error(`vault ${address.toBase58()} has the wrong mint or owner`);
  }
}

function verifyProtocolConfig(
  protocol: ProtocolConfigView,
  input: DevnetBootstrapInput,
): void {
  const { authority, paymaster, vaults } = input.identities;
  const checks: Array<[boolean, string]> = [
    [Number(protocol.version) === 1, "version"],
    [protocol.authority.equals(authority.publicKey), "authority"],
    [protocol.pricingOperator.equals(authority.publicKey), "pricing operator"],
    [protocol.paymaster.equals(paymaster.publicKey), "paymaster"],
    [
      protocol.teamDestination.equals(vaults.team.publicKey),
      "team destination",
    ],
    [
      protocol.treasuryDestination.equals(vaults.treasury.publicKey),
      "treasury destination",
    ],
    [protocol.rewardVault.equals(vaults.reward.publicKey), "reward vault"],
    [protocol.paymentMint.equals(DEVNET_USDC_MINT), "payment mint"],
    [protocol.paymentTokenProgram.equals(TOKEN_PROGRAM_ID), "token program"],
    [
      Number(protocol.contentVersion) === POLICY.contentVersion,
      "content version",
    ],
    [
      Number.isInteger(Number(protocol.campaignMapCount)) &&
        Number(protocol.campaignMapCount) >= 0 &&
        Number(protocol.campaignMapCount) <= CANONICAL_CAMPAIGN_MAP_COUNT,
      "campaign map count",
    ],
  ];
  const mismatch = checks.find(([valid]) => !valid);
  if (mismatch)
    throw new Error(`existing ProtocolConfig ${mismatch[1]} mismatch`);
}

async function verifyEconomyFoundation(
  input: DevnetBootstrapInput,
): Promise<void> {
  const program = zkubeProgram(
    input.connection,
    new SessionWallet(input.identities.authority),
  );
  const [economy, sales] = await Promise.all([
    program.account.economyConfig.fetchNullable(deriveEconomyConfigPda()),
    program.account.starSalesLedger.fetchNullable(deriveStarSalesLedgerPda()),
  ]);
  if (!economy || !sales) {
    throw new Error("EconomyConfig and StarSalesLedger must be initialized");
  }
  const validEconomy =
    Number(economy.version) === 1 &&
    economy.protocol.equals(deriveProtocolConfigPda()) &&
    economy.paymentMint.equals(DEVNET_USDC_MINT) &&
    economy.paymentTokenProgram.equals(TOKEN_PROGRAM_ID) &&
    Number(economy.contentVersion) === POLICY.contentVersion &&
    Number(economy.dailyRulesVersion) === POLICY.dailyRulesVersion &&
    BigInt(economy.revision.toString()) >= 1n &&
    economy.active;
  const validSales =
    Number(sales.version) === 1 &&
    sales.economyConfig.equals(deriveEconomyConfigPda()) &&
    sales.paymentMint.equals(DEVNET_USDC_MINT);
  if (!validEconomy || !validSales) {
    throw new Error("existing Stars economy foundation mismatch");
  }
}

async function verifyMapAccounts(input: DevnetBootstrapInput): Promise<void> {
  const addresses = Array.from(
    { length: CANONICAL_CAMPAIGN_MAP_COUNT },
    (_, index) => deriveMapCatalogPda(POLICY.contentVersion, index + 1),
  );
  const accounts = await input.connection.getMultipleAccountsInfo(
    addresses,
    "confirmed",
  );
  accounts.forEach((account, index) => {
    if (!account) {
      throw new Error(`campaign map ${index + 1} is not published`);
    }
    requireProgramOwned(
      account,
      addresses[index]!,
      `campaign map ${index + 1}`,
    );
  });
}

function requireProgramOwned(
  account: AccountInfo<Buffer>,
  address: PublicKey,
  label: string,
): void {
  if (!account.owner.equals(ZKUBE_PROGRAM_ID) || account.data.length < 8) {
    throw new Error(
      `${label} ${address.toBase58()} has an invalid owner or size`,
    );
  }
}

async function assertFunderHeadroom(
  input: DevnetBootstrapInput,
  batches: BootstrapBatch[],
): Promise<void> {
  const funding = batches.reduce(
    (sum, batch) => sum + batch.fundingLamports,
    0,
  );
  const feesAndHeadroom = batches.length * 10_000 + 5_000_000;
  const balance = await input.connection.getBalance(
    input.identities.funder.publicKey,
    "confirmed",
  );
  if (balance < funding + feesAndHeadroom) {
    throw new Error(
      `bootstrap funder balance ${balance} is below required stage floor ${funding + feesAndHeadroom}`,
    );
  }
}

function publicPlan(
  input: DevnetBootstrapInput,
  batches: BootstrapBatch[],
  deployment: LiveProgramDeployment,
): PublicBootstrapPlan {
  const { funder, authority, paymaster, vaults } = input.identities;
  return {
    schema: "zkube-devnet-bootstrap-plan",
    schemaVersion: 1,
    cluster: "devnet",
    stage: input.stage,
    rpc: input.rpc,
    genesisHash: SOLANA_DEVNET_GENESIS_HASH,
    program: ZKUBE_PROGRAM_ID.toBase58(),
    deployment,
    payment: {
      mint: DEVNET_USDC_MINT.toBase58(),
      tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
      decimals: 6,
    },
    identities: {
      funder: funder.publicKey.toBase58(),
      authority: authority.publicKey.toBase58(),
      paymaster: paymaster.publicKey.toBase58(),
    },
    vaults: Object.fromEntries(
      (Object.keys(vaults) as VaultName[]).map((name) => [
        name,
        vaults[name].publicKey.toBase58(),
      ]),
    ) as Record<VaultName, string>,
    pdas: {
      protocol: deriveProtocolConfigPda().toBase58(),
      economy: deriveEconomyConfigPda().toBase58(),
      starSalesLedger: deriveStarSalesLedgerPda().toBase58(),
      dailyRulesCatalog: deriveDailyRulesCatalogPda(
        POLICY.dailyRulesVersion,
      ).toBase58(),
    },
    policy: {
      paymasterFundingLamports: input.paymasterFundingLamports,
      contentVersion: POLICY.contentVersion,
      dailyRulesVersion: POLICY.dailyRulesVersion,
    },
    batches: batches.map(publicBatch),
  };
}

function publicBatch(batch: BootstrapBatch): PublicBootstrapBatch {
  const required = new Set<string>([batch.transaction.feePayer!.toBase58()]);
  for (const instruction of batch.transaction.instructions) {
    for (const key of instruction.keys) {
      if (key.isSigner) required.add(key.pubkey.toBase58());
    }
  }
  return {
    id: batch.id,
    label: batch.label,
    feePayer: batch.transaction.feePayer!.toBase58(),
    requiredSigners: [...required],
    fundingLamports: batch.fundingLamports,
    creates: batch.creates,
    instructions: batch.transaction.instructions.map((instruction) => ({
      programId: instruction.programId.toBase58(),
      dataSha256: createHash("sha256").update(instruction.data).digest("hex"),
      accounts: instruction.keys.map((key) => ({
        pubkey: key.pubkey.toBase58(),
        signer: key.isSigner,
        writable: key.isWritable,
      })),
    })),
  };
}

async function simulateBatches(
  connection: Connection,
  batches: BootstrapBatch[],
): Promise<DevnetBootstrapPreview["simulations"]> {
  const simulations: DevnetBootstrapPreview["simulations"] = [];
  for (const batch of batches) {
    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: batch.transaction.feePayer!,
        recentBlockhash: latest.blockhash,
        instructions: batch.transaction.instructions,
      }).compileToV0Message(),
    );
    const [result, fee] = await Promise.all([
      connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: false,
      }),
      connection.getFeeForMessage(transaction.message, "confirmed"),
    ]);
    if (result.value.err) {
      throw new Error(
        `unsigned Devnet simulation failed for ${batch.id}: ${JSON.stringify(result.value.err)}\n${result.value.logs?.join("\n") ?? ""}`,
      );
    }
    if (fee.value === null) {
      throw new Error(`Unable to estimate the Devnet fee for ${batch.id}`);
    }
    simulations.push({
      id: batch.id,
      unitsConsumed: result.value.unitsConsumed ?? null,
      feeLamports: fee.value,
      logs: result.value.logs ?? [],
    });
  }
  return simulations;
}

async function executeBatch(
  connection: Connection,
  batch: BootstrapBatch,
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(
    new TransactionMessage({
      payerKey: batch.transaction.feePayer!,
      recentBlockhash: latest.blockhash,
      instructions: batch.transaction.instructions,
    }).compileToV0Message(),
  );
  transaction.sign(batch.signers);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: true,
    replaceRecentBlockhash: false,
  });
  if (simulation.value.err) {
    throw new Error(
      `signed Devnet simulation failed for ${batch.id}: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n") ?? ""}`,
    );
  }
  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    { skipPreflight: false, maxRetries: 5 },
  );
  const confirmation = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `Devnet confirmation failed for ${batch.id}: ${JSON.stringify(confirmation.value.err)}`,
    );
  }
  return signature;
}

async function verifyStagePostconditions(
  input: DevnetBootstrapInput,
): Promise<void> {
  if (input.stage === "custody") {
    await verifyAllVaults(input);
    const paymasterBalance = await input.connection.getBalance(
      input.identities.paymaster.publicKey,
      "confirmed",
    );
    if (paymasterBalance < input.paymasterFundingLamports) {
      throw new Error("paymaster funding postcondition failed");
    }
    return;
  }
  const program = zkubeProgram(
    input.connection,
    new SessionWallet(input.identities.authority),
  );
  const protocol = await program.account.protocolConfig.fetchNullable(
    deriveProtocolConfigPda(),
  );
  if (!protocol) throw new Error("ProtocolConfig postcondition failed");
  verifyProtocolConfig(protocol, input);
  if (input.stage === "economy") {
    await verifyEconomyFoundation(input);
  } else if (input.stage === "daily-rules") {
    await verifyEconomyFoundation(input);
    const address = deriveDailyRulesCatalogPda(POLICY.dailyRulesVersion);
    const account = await input.connection.getAccountInfo(address, "confirmed");
    if (!account)
      throw new Error("Daily rules publication postcondition failed");
    requireProgramOwned(account, address, "Daily rules catalog");
  } else if (input.stage === "maps") {
    await verifyMapAccounts(input);
  } else if (input.stage === "activation") {
    await verifyMapAccounts(input);
    if (Number(protocol.campaignMapCount) !== CANONICAL_CAMPAIGN_MAP_COUNT) {
      throw new Error("campaign activation postcondition failed");
    }
  }
}

function writeProof(path: string, result: DevnetBootstrapPreview): void {
  const proof = {
    schema: "zkube-devnet-bootstrap-proof",
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    fingerprint: result.fingerprint,
    plan: result.plan,
    simulations: result.simulations.map(
      ({ id, unitsConsumed, feeLamports }) => ({
        id,
        unitsConsumed,
        feeLamports,
      }),
    ),
    signatures: result.signatures,
  };
  const destination = resolve(path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(proof, null, 2)}\n`, {
    mode: 0o600,
  });
}

function writeCandidate(path: string, result: DevnetBootstrapPreview): void {
  const candidate = {
    schema: "zkube-devnet-bootstrap-candidate",
    schemaVersion: 1,
    fingerprint: result.fingerprint,
    plan: result.plan,
    simulations: result.simulations.map(
      ({ id, unitsConsumed, feeLamports }) => ({
        id,
        unitsConsumed,
        feeLamports,
      }),
    ),
    signed: false,
    sent: false,
  };
  const destination = resolve(path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(candidate, null, 2)}\n`, {
    mode: 0o600,
  });
}

function loadKeypair(path: string, label: string): Keypair {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `Unable to read ${label} keypair: ${(error as Error).message}`,
    );
  }
  if (
    !Array.isArray(value) ||
    value.length !== 64 ||
    !value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new Error(`${label} keypair must be a 64-byte JSON array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(value as number[]));
}

function bootstrapStage(value: string | undefined): DevnetBootstrapStage {
  const stage = value?.trim().toLowerCase() || "custody";
  if (
    stage !== "custody" &&
    stage !== "protocol" &&
    stage !== "economy" &&
    stage !== "daily-rules" &&
    stage !== "maps" &&
    stage !== "activation"
  ) {
    throw new Error(
      "ZKUBE_BOOTSTRAP_STAGE must be custody, protocol, economy, daily-rules, maps, or activation",
    );
  }
  return stage;
}

function devnetRpc(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("Devnet bootstrap RPC must use HTTPS");
  }
  if (/mainnet|testnet/i.test(`${url.hostname}${url.pathname}`)) {
    throw new Error("Devnet bootstrap cannot target mainnet or testnet");
  }
  return url.toString().replace(/\/$/, "");
}

function positiveSafeInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return parsed;
}
