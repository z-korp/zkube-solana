import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";

import { buildUpdateStarPacksPlan } from "./economyAdminClient.js";
import { SOLANA_DEVNET_GENESIS_HASH, ZKUBE_PROGRAM_ID } from "./constants.js";
import { inspectUpgradeableProgram } from "./deploymentRunner.js";
import {
  deriveEconomyConfigPda,
  deriveProtocolConfigPda,
  deriveRewardVaultPda,
} from "./pdas.js";
import { zkubeProgram } from "./runPlan.js";
import { SessionWallet } from "./sessionWallet.js";

const DEFAULT_BASE_RPC = "https://rpc.magicblock.app/devnet";
const MAXIMUM_PRICING_FEE_LAMPORTS = 5_000_000;
const ZERO_ADDRESS = PublicKey.default.toBase58();

export const LEGACY_STAR_PACK_STARS = [10n, 50n, 100n, 500n, 1_000n] as const;
export const LEGACY_STAR_PACK_PRICES = [
  10_000_000n,
  47_500_000n,
  90_000_000n,
  425_000_000n,
  800_000_000n,
] as const;
export const RELEASE_STAR_PACK_STARS = [10n, 50n, 200n, 500n, 1_000n] as const;
export const RELEASE_STAR_PACK_PRICES = [
  20_000_000n,
  90_000_000n,
  300_000_000n,
  700_000_000n,
  1_250_000_000n,
] as const;
const ALL_PACKS_ENABLED = [true, true, true, true, true] as const;

interface ProtocolSnapshot {
  version: number;
  authority: string;
  pendingAuthority: string;
  pricingOperator: string;
  teamDestination: string;
  treasuryDestination: string;
  rewardVault: string;
  contentVersion: number;
  playerFundingTargetLamports: string;
  campaignMapCount: number;
  paused: boolean;
  bump: number;
}

interface EconomySnapshot {
  version: number;
  protocol: string;
  contentVersion: number;
  dailyRulesVersion: number;
  revision: string;
  dailyEntryStars: string;
  zoneUnlockStars: string;
  starPackStars: string[];
  starPackPrices: string[];
  starPackEnabled: boolean[];
  saleEnabled: boolean;
  saleStartsAt: string;
  saleEndsAt: string;
  salePrices: string[];
  weeklyMinSolPool: string;
  weeklyMaxSolPool: string;
  bump: number;
}

interface PricingAccountSnapshot<T> {
  address: string;
  owner: string;
  dataLength: number;
  dataSha256: string;
  state: T;
}

interface PublicInstruction {
  programId: string;
  dataHex: string;
  dataSha256: string;
  accounts: Array<{
    publicKey: string;
    signer: boolean;
    writable: boolean;
  }>;
}

export interface PublicEconomyPricingPlan {
  schema: "zkube-devnet-economy-pricing-release";
  schemaVersion: 1;
  cluster: "devnet";
  rpc: string;
  genesisHash: string;
  program: {
    address: string;
    programDataAddress: string;
    planningSbfSha256: string;
    requiredExecutionSbfSha256: string;
  };
  identities: {
    feePayer: string;
    pricingOperator: string;
  };
  accounts: {
    protocol: PricingAccountSnapshot<ProtocolSnapshot>;
    economy: PricingAccountSnapshot<EconomySnapshot>;
  };
  instruction: PublicInstruction;
  expectedPostState: EconomySnapshot;
  policy: {
    expectedPreRevision: "1";
    expectedPostRevision: "2";
    exactFeePayerSpendCeilingLamports: number;
    pricingOperatorSpendLamports: 0;
    nativeSolTransfersLamports: 0;
    createsAccounts: false;
    mainnetDisabled: true;
    skipPreflight: false;
    signatureVerifiedSimulationBeforeSend: true;
  };
}

export interface EconomyPricingReleaseInput {
  connection: Connection;
  rpc: string;
  feePayer: Keypair;
  pricingOperator: Keypair;
  plan: PublicEconomyPricingPlan;
  approvalFingerprint: string;
  sendEnabled: boolean;
  suppliedApproval?: string;
}

export interface EconomyPricingReleaseResult {
  mode: "dry-run" | "updated";
  input: EconomyPricingReleaseInput;
  estimatedFeeLamports: number;
  unsignedSimulationUnits: number | null;
  unsignedSimulationSkippedReason?: string;
  signature?: string;
  feePayerSpendLamports?: number;
}

interface VerifiedLiveState {
  genesisHash: string;
  deployedSbfSha256: string;
  programDataAddress: string;
  protocol: PricingAccountSnapshot<ProtocolSnapshot>;
  economy: PricingAccountSnapshot<EconomySnapshot>;
}

export async function economyPricingReleaseInputFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): Promise<EconomyPricingReleaseInput> {
  const rpc = devnetEndpoint(
    env.ZKUBE_BASE_RPC ??
      env.VITE_PUBLIC_SOLANA_RPC_ENDPOINT ??
      DEFAULT_BASE_RPC,
  );
  const requiredExecutionSbfSha256 = requiredSha256(
    env.ZKUBE_PRICING_EXPECTED_SBF_SHA256,
    "ZKUBE_PRICING_EXPECTED_SBF_SHA256",
  );
  const permittedPlanningSbfSha256 = optionalSha256(
    env.ZKUBE_PRICING_PLANNING_SBF_SHA256,
    "ZKUBE_PRICING_PLANNING_SBF_SHA256",
  );
  const feePayer = loadKeypair(
    resolvePath(
      cwd,
      env.ZKUBE_PRICING_FEE_PAYER_KEYPAIR ??
        "../../cycling-sim/.devnet/deployer.json",
    ),
    "pricing fee payer",
  );
  const pricingOperator = loadKeypair(
    resolvePath(
      cwd,
      env.ZKUBE_PRICING_OPERATOR_KEYPAIR ??
        "../.devnet/zkube-governance-authority.json",
    ),
    "pricing operator",
  );
  if (feePayer.publicKey.equals(pricingOperator.publicKey)) {
    throw new Error("pricing fee payer and pricing operator must be distinct");
  }
  const connection = new Connection(rpc, "confirmed");
  const live = await verifiedLiveState(
    connection,
    pricingOperator,
    requiredExecutionSbfSha256,
    permittedPlanningSbfSha256,
  );
  const instruction = await pricingInstruction(connection, pricingOperator);
  const plan = publicPlan({
    rpc,
    feePayer: feePayer.publicKey,
    pricingOperator: pricingOperator.publicKey,
    requiredExecutionSbfSha256,
    live,
    instruction,
  });
  return {
    connection,
    rpc,
    feePayer,
    pricingOperator,
    plan,
    approvalFingerprint: economyPricingReleaseFingerprint(plan),
    sendEnabled: env.ZKUBE_PRICING_SEND === "1",
    suppliedApproval: env.ZKUBE_PRICING_APPROVAL?.trim() || undefined,
  };
}

export async function runEconomyPricingRelease(
  input: EconomyPricingReleaseInput,
): Promise<EconomyPricingReleaseResult> {
  if (
    economyPricingReleaseFingerprint(input.plan) !== input.approvalFingerprint
  ) {
    throw new Error("pricing approval plan changed after fingerprinting");
  }
  if (
    input.feePayer.publicKey.toBase58() !== input.plan.identities.feePayer ||
    input.pricingOperator.publicKey.toBase58() !==
      input.plan.identities.pricingOperator
  ) {
    throw new Error("pricing signer identity changed after fingerprinting");
  }
  const instruction = await pricingInstruction(
    input.connection,
    input.pricingOperator,
  );
  assertInstructionMatches(instruction, input.plan.instruction);
  const { message } = await pricingMessage(
    input.connection,
    input.feePayer.publicKey,
    instruction,
  );
  assertSignerLayout(
    message,
    input.feePayer.publicKey,
    input.pricingOperator.publicKey,
  );
  const fee = await input.connection.getFeeForMessage(message, "confirmed");
  if (fee.value === null) throw new Error("unable to estimate pricing fee");
  if (fee.value > input.plan.policy.exactFeePayerSpendCeilingLamports) {
    throw new Error(
      `pricing fee ${fee.value} exceeds approved ceiling ${input.plan.policy.exactFeePayerSpendCeilingLamports}`,
    );
  }

  let unsignedSimulationUnits: number | null = null;
  let unsignedSimulationSkippedReason: string | undefined;
  if (
    input.plan.program.planningSbfSha256 ===
    input.plan.program.requiredExecutionSbfSha256
  ) {
    const unsigned = new VersionedTransaction(message);
    const simulation = await input.connection.simulateTransaction(unsigned, {
      commitment: "confirmed",
      replaceRecentBlockhash: false,
      sigVerify: false,
    });
    if (simulation.value.err) {
      throw new Error(
        `unsigned pricing simulation failed: ${JSON.stringify(simulation.value.err)}`,
      );
    }
    unsignedSimulationUnits = simulation.value.unitsConsumed ?? null;
  } else {
    unsignedSimulationSkippedReason =
      "execution program is a later fingerprinted operation in the same release bundle";
  }

  if (!input.sendEnabled) {
    return {
      mode: "dry-run",
      input,
      estimatedFeeLamports: fee.value,
      unsignedSimulationUnits,
      ...(unsignedSimulationSkippedReason
        ? { unsignedSimulationSkippedReason }
        : {}),
    };
  }
  if (input.suppliedApproval !== input.approvalFingerprint) {
    throw new Error(
      `pricing update blocked: set ZKUBE_PRICING_APPROVAL=${input.approvalFingerprint} only after explicit approval`,
    );
  }

  const before = await verifiedLiveState(
    input.connection,
    input.pricingOperator,
    input.plan.program.requiredExecutionSbfSha256,
  );
  assertExecutionPreconditions(input.plan, before);
  const [feePayerBalanceBefore, operatorBalanceBefore] = await Promise.all([
    input.connection.getBalance(input.feePayer.publicKey, "confirmed"),
    input.connection.getBalance(input.pricingOperator.publicKey, "confirmed"),
  ]);
  if (
    feePayerBalanceBefore < input.plan.policy.exactFeePayerSpendCeilingLamports
  ) {
    throw new Error("pricing fee payer is below the approved fee ceiling");
  }

  const { message: executionMessage, lastValidBlockHeight } =
    await pricingMessage(
      input.connection,
      input.feePayer.publicKey,
      instruction,
    );
  assertSignerLayout(
    executionMessage,
    input.feePayer.publicKey,
    input.pricingOperator.publicKey,
  );
  const executionFee = await input.connection.getFeeForMessage(
    executionMessage,
    "confirmed",
  );
  if (
    executionFee.value === null ||
    executionFee.value > input.plan.policy.exactFeePayerSpendCeilingLamports
  ) {
    throw new Error("pricing execution fee exceeds the approved ceiling");
  }
  const transaction = new VersionedTransaction(executionMessage);
  transaction.sign([input.feePayer, input.pricingOperator]);
  const simulation = await input.connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    replaceRecentBlockhash: false,
    sigVerify: true,
  });
  if (simulation.value.err) {
    throw new Error(
      `signature-verified pricing simulation failed: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  const signature = await input.connection.sendRawTransaction(
    transaction.serialize(),
    {
      maxRetries: 5,
      preflightCommitment: "confirmed",
      skipPreflight: false,
    },
  );
  const confirmation = await input.connection.confirmTransaction(
    {
      signature,
      blockhash: executionMessage.recentBlockhash,
      lastValidBlockHeight,
    },
    "confirmed",
  );
  if (confirmation.value.err) {
    throw new Error(
      `pricing update failed: ${JSON.stringify(confirmation.value.err)}`,
    );
  }

  const after = await verifiedPostState(
    input.connection,
    input.pricingOperator,
    input.plan.program.requiredExecutionSbfSha256,
  );
  if (after.protocol.dataSha256 !== input.plan.accounts.protocol.dataSha256) {
    throw new Error("pricing update unexpectedly changed ProtocolConfig");
  }
  if (!equal(after.economy.state, input.plan.expectedPostState)) {
    throw new Error("pricing postcondition does not match the approved ladder");
  }
  const [feePayerBalanceAfter, operatorBalanceAfter] = await Promise.all([
    input.connection.getBalance(input.feePayer.publicKey, "confirmed"),
    input.connection.getBalance(input.pricingOperator.publicKey, "confirmed"),
  ]);
  const feePayerSpendLamports = Math.max(
    0,
    feePayerBalanceBefore - feePayerBalanceAfter,
  );
  if (
    feePayerSpendLamports > input.plan.policy.exactFeePayerSpendCeilingLamports
  ) {
    throw new Error("pricing fee payer spend exceeded the approved ceiling");
  }
  if (operatorBalanceAfter !== operatorBalanceBefore) {
    throw new Error("pricing operator balance changed unexpectedly");
  }
  return {
    mode: "updated",
    input,
    estimatedFeeLamports: executionFee.value,
    unsignedSimulationUnits: simulation.value.unitsConsumed ?? null,
    signature,
    feePayerSpendLamports,
  };
}

export function economyPricingReleaseFingerprint(
  plan: PublicEconomyPricingPlan,
): string {
  return createHash("sha256")
    .update(JSON.stringify(plan))
    .digest("hex")
    .slice(0, 16);
}

export function formatEconomyPricingRelease(
  result: EconomyPricingReleaseResult,
): string {
  const input = result.input;
  const { plan } = input;
  return [
    "zKube Devnet economy pricing release",
    `Mode: ${result.mode}`,
    `RPC: ${plan.rpc}`,
    `Program: ${plan.program.address}`,
    `Planning SBF SHA-256: ${plan.program.planningSbfSha256}`,
    `Required execution SBF SHA-256: ${plan.program.requiredExecutionSbfSha256}`,
    `Fee payer: ${plan.identities.feePayer}`,
    `Pricing operator: ${plan.identities.pricingOperator}`,
    `Protocol account: ${plan.accounts.protocol.address} (read-only)`,
    `Economy account: ${plan.accounts.economy.address} (writable)`,
    `Instruction data SHA-256: ${plan.instruction.dataSha256}`,
    `Economy revision: ${plan.accounts.economy.state.revision} -> ${plan.expectedPostState.revision}`,
    `Star packs: ${plan.expectedPostState.starPackStars.join("/")}`,
    `Prices (lamports): ${plan.expectedPostState.starPackPrices.join("/")}`,
    `Enabled: ${plan.expectedPostState.starPackEnabled.join("/")}`,
    `Native SOL transfers: ${plan.policy.nativeSolTransfersLamports} lamports`,
    `Maximum fee-payer spend: ${plan.policy.exactFeePayerSpendCeilingLamports} lamports`,
    `Estimated fee: ${result.estimatedFeeLamports} lamports`,
    `Simulation units: ${result.unsignedSimulationUnits ?? "not available"}`,
    ...(result.unsignedSimulationSkippedReason
      ? [`Simulation note: ${result.unsignedSimulationSkippedReason}`]
      : []),
    `Approval fingerprint: ${input.approvalFingerprint}`,
    ...(result.signature ? [`Signature: ${result.signature}`] : []),
    ...(result.feePayerSpendLamports === undefined
      ? []
      : [`Fee-payer spend: ${result.feePayerSpendLamports} lamports`]),
    ...(result.mode === "dry-run"
      ? [
          "No transaction was signed or sent.",
          `To execute only after approval: ZKUBE_PRICING_SEND=1 ZKUBE_PRICING_APPROVAL=${input.approvalFingerprint}`,
        ]
      : []),
  ].join("\n");
}

async function verifiedLiveState(
  connection: Connection,
  pricingOperator: Keypair,
  requiredExecutionSbfSha256: string,
  permittedPlanningSbfSha256?: string,
): Promise<VerifiedLiveState> {
  const base = await inspectLiveState(connection, pricingOperator);
  const acceptedPlanningHash =
    base.deployedSbfSha256 === requiredExecutionSbfSha256 ||
    base.deployedSbfSha256 === permittedPlanningSbfSha256;
  if (!acceptedPlanningHash) {
    throw new Error(
      `deployed SBF hash ${base.deployedSbfSha256} is neither the execution release nor its approved planning preimage`,
    );
  }
  assertLegacyPreState(base, pricingOperator.publicKey);
  return base;
}

async function verifiedPostState(
  connection: Connection,
  pricingOperator: Keypair,
  requiredExecutionSbfSha256: string,
): Promise<VerifiedLiveState> {
  const base = await inspectLiveState(connection, pricingOperator);
  if (base.deployedSbfSha256 !== requiredExecutionSbfSha256) {
    throw new Error("deployed program changed during pricing execution");
  }
  assertProtocol(base, pricingOperator.publicKey);
  return base;
}

async function inspectLiveState(
  connection: Connection,
  pricingOperator: Keypair,
): Promise<VerifiedLiveState> {
  const genesisHash = await connection.getGenesisHash();
  if (genesisHash !== SOLANA_DEVNET_GENESIS_HASH) {
    throw new Error(`Devnet genesis mismatch: received ${genesisHash}`);
  }
  const deployment = await inspectUpgradeableProgram(
    connection,
    ZKUBE_PROGRAM_ID,
  );
  const wallet = new SessionWallet(pricingOperator);
  const program = zkubeProgram(connection, wallet);
  const protocolAddress = deriveProtocolConfigPda();
  const economyAddress = deriveEconomyConfigPda();
  const [protocolInfo, economyInfo] = await connection.getMultipleAccountsInfo(
    [protocolAddress, economyAddress],
    "confirmed",
  );
  if (!protocolInfo || !economyInfo) {
    throw new Error("ProtocolConfig and EconomyConfig must both exist");
  }
  assertAccount(
    protocolInfo,
    program.account.protocolConfig.size,
    "ProtocolConfig",
  );
  assertAccount(
    economyInfo,
    program.account.economyConfig.size,
    "EconomyConfig",
  );
  type ProtocolAccount = Awaited<
    ReturnType<typeof program.account.protocolConfig.fetch>
  >;
  type EconomyAccount = Awaited<
    ReturnType<typeof program.account.economyConfig.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  const economy = program.coder.accounts.decode(
    "economyConfig",
    economyInfo.data,
  ) as unknown as EconomyAccount;
  return {
    genesisHash,
    deployedSbfSha256: deployment.deployedSbfSha256,
    programDataAddress: deployment.programDataAddress.toBase58(),
    protocol: {
      address: protocolAddress.toBase58(),
      owner: protocolInfo.owner.toBase58(),
      dataLength: protocolInfo.data.length,
      dataSha256: sha256(protocolInfo.data),
      state: protocolSnapshot(protocol),
    },
    economy: {
      address: economyAddress.toBase58(),
      owner: economyInfo.owner.toBase58(),
      dataLength: economyInfo.data.length,
      dataSha256: sha256(economyInfo.data),
      state: economySnapshot(economy),
    },
  };
}

function assertLegacyPreState(
  live: VerifiedLiveState,
  pricingOperator: PublicKey,
): void {
  assertProtocol(live, pricingOperator);
  const economy = live.economy.state;
  const protocol = live.protocol.state;
  const valid =
    economy.version === 1 &&
    economy.protocol === live.protocol.address &&
    economy.contentVersion === protocol.contentVersion &&
    economy.dailyRulesVersion > 0 &&
    economy.revision === "1" &&
    economy.dailyEntryStars === "10" &&
    economy.zoneUnlockStars === "20" &&
    equal(economy.starPackStars, strings(LEGACY_STAR_PACK_STARS)) &&
    equal(economy.starPackPrices, strings(LEGACY_STAR_PACK_PRICES)) &&
    equal(economy.starPackEnabled, ALL_PACKS_ENABLED) &&
    !economy.saleEnabled &&
    economy.saleStartsAt === "0" &&
    economy.saleEndsAt === "0" &&
    equal(economy.salePrices, ["0", "0", "0", "0", "0"]) &&
    BigInt(economy.weeklyMinSolPool) <= BigInt(economy.weeklyMaxSolPool);
  if (!valid) {
    throw new Error(
      "live EconomyConfig is not the exact legacy revision 1 prestate",
    );
  }
  const [, expectedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("economy")],
    ZKUBE_PROGRAM_ID,
  );
  if (economy.bump !== expectedBump) {
    throw new Error("EconomyConfig bump does not match its canonical PDA");
  }
}

function assertProtocol(
  live: VerifiedLiveState,
  pricingOperator: PublicKey,
): void {
  const protocol = live.protocol.state;
  const [, expectedBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("protocol")],
    ZKUBE_PROGRAM_ID,
  );
  const destinations = [
    protocol.teamDestination,
    protocol.treasuryDestination,
    protocol.rewardVault,
  ];
  const valid =
    protocol.version === 1 &&
    protocol.pricingOperator === pricingOperator.toBase58() &&
    protocol.rewardVault === deriveRewardVaultPda().toBase58() &&
    protocol.contentVersion > 0 &&
    protocol.playerFundingTargetLamports === "25000000" &&
    !protocol.paused &&
    protocol.bump === expectedBump &&
    destinations.every((address) => address !== ZERO_ADDRESS) &&
    new Set(destinations).size === destinations.length;
  if (!valid) {
    throw new Error("live ProtocolConfig failed pricing authority validation");
  }
}

function publicPlan(args: {
  rpc: string;
  feePayer: PublicKey;
  pricingOperator: PublicKey;
  requiredExecutionSbfSha256: string;
  live: VerifiedLiveState;
  instruction: TransactionInstruction;
}): PublicEconomyPricingPlan {
  const expectedPostState: EconomySnapshot = {
    ...args.live.economy.state,
    revision: "2",
    starPackStars: strings(RELEASE_STAR_PACK_STARS),
    starPackPrices: strings(RELEASE_STAR_PACK_PRICES),
    starPackEnabled: [...ALL_PACKS_ENABLED],
  };
  return {
    schema: "zkube-devnet-economy-pricing-release",
    schemaVersion: 1,
    cluster: "devnet",
    rpc: args.rpc,
    genesisHash: args.live.genesisHash,
    program: {
      address: ZKUBE_PROGRAM_ID.toBase58(),
      programDataAddress: args.live.programDataAddress,
      planningSbfSha256: args.live.deployedSbfSha256,
      requiredExecutionSbfSha256: args.requiredExecutionSbfSha256,
    },
    identities: {
      feePayer: args.feePayer.toBase58(),
      pricingOperator: args.pricingOperator.toBase58(),
    },
    accounts: {
      protocol: args.live.protocol,
      economy: args.live.economy,
    },
    instruction: publicInstruction(args.instruction),
    expectedPostState,
    policy: {
      expectedPreRevision: "1",
      expectedPostRevision: "2",
      exactFeePayerSpendCeilingLamports: MAXIMUM_PRICING_FEE_LAMPORTS,
      pricingOperatorSpendLamports: 0,
      nativeSolTransfersLamports: 0,
      createsAccounts: false,
      mainnetDisabled: true,
      skipPreflight: false,
      signatureVerifiedSimulationBeforeSend: true,
    },
  };
}

async function pricingInstruction(
  connection: Connection,
  pricingOperator: Keypair,
): Promise<TransactionInstruction> {
  const release = await buildUpdateStarPacksPlan({
    connection,
    pricingOperator: new SessionWallet(pricingOperator),
    stars: RELEASE_STAR_PACK_STARS,
    prices: RELEASE_STAR_PACK_PRICES,
    enabled: ALL_PACKS_ENABLED,
  });
  const instruction = release.transaction.instructions[0];
  if (!instruction || release.transaction.instructions.length !== 1) {
    throw new Error("pricing release must contain exactly one instruction");
  }
  const keys = instruction.keys;
  const valid =
    instruction.programId.equals(ZKUBE_PROGRAM_ID) &&
    keys.length === 3 &&
    keys[0]?.pubkey.equals(deriveProtocolConfigPda()) &&
    !keys[0].isSigner &&
    !keys[0].isWritable &&
    keys[1]?.pubkey.equals(deriveEconomyConfigPda()) &&
    !keys[1].isSigner &&
    keys[1].isWritable &&
    keys[2]?.pubkey.equals(pricingOperator.publicKey) &&
    keys[2].isSigner &&
    !keys[2].isWritable;
  if (!valid) throw new Error("pricing instruction account contract changed");
  return instruction;
}

async function pricingMessage(
  connection: Connection,
  feePayer: PublicKey,
  instruction: TransactionInstruction,
) {
  const latest = await connection.getLatestBlockhash("confirmed");
  return {
    message: new TransactionMessage({
      payerKey: feePayer,
      recentBlockhash: latest.blockhash,
      instructions: [instruction],
    }).compileToV0Message(),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

function assertSignerLayout(
  message: ReturnType<TransactionMessage["compileToV0Message"]>,
  feePayer: PublicKey,
  pricingOperator: PublicKey,
): void {
  const required = message.staticAccountKeys.slice(
    0,
    message.header.numRequiredSignatures,
  );
  if (
    required.length !== 2 ||
    !required[0]?.equals(feePayer) ||
    !required[1]?.equals(pricingOperator)
  ) {
    throw new Error("pricing signer layout must be fee payer then operator");
  }
}

function assertExecutionPreconditions(
  plan: PublicEconomyPricingPlan,
  live: VerifiedLiveState,
): void {
  if (
    live.genesisHash !== plan.genesisHash ||
    live.programDataAddress !== plan.program.programDataAddress ||
    live.deployedSbfSha256 !== plan.program.requiredExecutionSbfSha256 ||
    live.protocol.dataSha256 !== plan.accounts.protocol.dataSha256 ||
    live.economy.dataSha256 !== plan.accounts.economy.dataSha256 ||
    !equal(live.protocol.state, plan.accounts.protocol.state) ||
    !equal(live.economy.state, plan.accounts.economy.state)
  ) {
    throw new Error("live pricing prestate drifted after approval");
  }
}

function assertInstructionMatches(
  instruction: TransactionInstruction,
  expected: PublicInstruction,
): void {
  if (!equal(publicInstruction(instruction), expected)) {
    throw new Error("pricing instruction changed after approval");
  }
}

function publicInstruction(
  instruction: TransactionInstruction,
): PublicInstruction {
  return {
    programId: instruction.programId.toBase58(),
    dataHex: Buffer.from(instruction.data).toString("hex"),
    dataSha256: sha256(instruction.data),
    accounts: instruction.keys.map((account) => ({
      publicKey: account.pubkey.toBase58(),
      signer: account.isSigner,
      writable: account.isWritable,
    })),
  };
}

function assertAccount(
  account: AccountInfo<Buffer>,
  expectedLength: number,
  accountName: "ProtocolConfig" | "EconomyConfig",
): void {
  if (!account.owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error(`${accountName} has the wrong owner`);
  }
  if (account.executable) {
    throw new Error(`${accountName} must not be executable`);
  }
  if (account.data.length !== expectedLength) {
    throw new Error(
      `${accountName} has data length ${account.data.length}; expected ${expectedLength}`,
    );
  }
  const discriminator = createHash("sha256")
    .update(`account:${accountName}`)
    .digest()
    .subarray(0, 8);
  if (!account.data.subarray(0, 8).equals(discriminator)) {
    throw new Error(`${accountName} discriminator mismatch`);
  }
}

function protocolSnapshot(account: {
  version: number;
  authority: PublicKey;
  pendingAuthority: PublicKey;
  pricingOperator: PublicKey;
  teamDestination: PublicKey;
  treasuryDestination: PublicKey;
  rewardVault: PublicKey;
  contentVersion: number;
  playerFundingTargetLamports: { toString(): string };
  campaignMapCount: number;
  paused: boolean;
  bump: number;
}): ProtocolSnapshot {
  return {
    version: Number(account.version),
    authority: account.authority.toBase58(),
    pendingAuthority: account.pendingAuthority.toBase58(),
    pricingOperator: account.pricingOperator.toBase58(),
    teamDestination: account.teamDestination.toBase58(),
    treasuryDestination: account.treasuryDestination.toBase58(),
    rewardVault: account.rewardVault.toBase58(),
    contentVersion: Number(account.contentVersion),
    playerFundingTargetLamports: account.playerFundingTargetLamports.toString(),
    campaignMapCount: Number(account.campaignMapCount),
    paused: Boolean(account.paused),
    bump: Number(account.bump),
  };
}

function economySnapshot(account: {
  version: number;
  protocol: PublicKey;
  contentVersion: number;
  dailyRulesVersion: number;
  revision: { toString(): string };
  dailyEntryStars: { toString(): string };
  zoneUnlockStars: { toString(): string };
  starPackStars: Array<{ toString(): string }>;
  starPackPrices: Array<{ toString(): string }>;
  starPackEnabled: boolean[];
  saleEnabled: boolean;
  saleStartsAt: { toString(): string };
  saleEndsAt: { toString(): string };
  salePrices: Array<{ toString(): string }>;
  weeklyMinSolPool: { toString(): string };
  weeklyMaxSolPool: { toString(): string };
  bump: number;
}): EconomySnapshot {
  return {
    version: Number(account.version),
    protocol: account.protocol.toBase58(),
    contentVersion: Number(account.contentVersion),
    dailyRulesVersion: Number(account.dailyRulesVersion),
    revision: account.revision.toString(),
    dailyEntryStars: account.dailyEntryStars.toString(),
    zoneUnlockStars: account.zoneUnlockStars.toString(),
    starPackStars: account.starPackStars.map(String),
    starPackPrices: account.starPackPrices.map(String),
    starPackEnabled: account.starPackEnabled.map(Boolean),
    saleEnabled: Boolean(account.saleEnabled),
    saleStartsAt: account.saleStartsAt.toString(),
    saleEndsAt: account.saleEndsAt.toString(),
    salePrices: account.salePrices.map(String),
    weeklyMinSolPool: account.weeklyMinSolPool.toString(),
    weeklyMaxSolPool: account.weeklyMaxSolPool.toString(),
    bump: Number(account.bump),
  };
}

function strings(values: readonly bigint[]): string[] {
  return values.map(String);
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function loadKeypair(path: string, label: string): Keypair {
  let source: unknown;
  try {
    source = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${(error as Error).message}`);
  }
  if (
    !Array.isArray(source) ||
    source.length !== 64 ||
    !source.every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 255,
    )
  ) {
    throw new Error(`${label} must be a Solana 64-byte keypair JSON array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(source as number[]));
}

function requiredSha256(value: string | undefined, label: string): string {
  const parsed = optionalSha256(value, label);
  if (!parsed) throw new Error(`${label} is required`);
  return parsed;
}

function optionalSha256(
  value: string | undefined,
  label: string,
): string | undefined {
  const parsed = value?.trim().toLowerCase();
  if (!parsed) return undefined;
  if (!/^[0-9a-f]{64}$/.test(parsed)) {
    throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return parsed;
}

function devnetEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.protocol !== "https:") {
    throw new Error("Devnet pricing RPC must use HTTPS");
  }
  if (/mainnet|localhost|127\.0\.0\.1|localnet/i.test(value)) {
    throw new Error("Devnet pricing RPC cannot target mainnet or localhost");
  }
  return endpoint.toString().replace(/\/$/, "");
}

function resolvePath(cwd: string, path: string): string {
  return isAbsolute(path) ? path : resolve(cwd, path);
}
