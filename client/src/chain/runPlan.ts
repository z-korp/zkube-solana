/**
 * Transaction orchestration boundary.
 *
 * Solana base plans use the device session signer for transaction fees while
 * narrow on-chain wrappers use the owner's System-owned, zero-data funding PDA
 * for account rent. Router-selected ER plans use that same device signer. Durable run
 * markers are saved only after base confirmation.
 */
import {
  AnchorProvider,
  BorshAccountsCoder,
  Program as AnchorProgram,
  type Program,
} from "@anchor-lang/core";
import BN from "bn.js";
import { Buffer } from "buffer";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Commitment,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import { IDL, type ZkubeProgram } from "./idl/index.js";
import {
  INITIAL_RUN_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  SOLANA_ENDPOINT,
  ZKUBE_PROGRAM_ID,
  getDelegationRecord,
} from "./constants.js";
import { saveRunSession } from "./runSessionStore.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  deriveCampaignProgressPda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveMapCatalogPda,
  derivePlayerFundingPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveWeeklyStipendPda,
  type RunAddresses,
} from "./pdas.js";
import { getClosestValidator, waitForDelegation } from "./router.js";
import {
  mapDailyPressureProfile,
  mapDailyScoringRule,
  type DailyPressureProfileView,
  type DailyScoringRuleView,
} from "./dailyRules.js";

export type RunLayer = "solana-base" | "magicblock-er";

export interface TransactionPlan {
  layer: RunLayer;
  label: string;
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
  signers: Signer[];
}

export interface PreparedRunPlan {
  runId: bigint;
  addresses: RunAddresses;
  sessionToken: PublicKey;
  sessionValidUntil: number;
  transactionPlan: TransactionPlan;
}

export type EndlessThresholdsView = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export type EndlessScoreMultipliersX100View = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface EndlessRulesView {
  endlessThresholds: EndlessThresholdsView;
  endlessScoreMultipliersX100: EndlessScoreMultipliersX100View;
  endlessRampMultiplierX100: number;
}

export interface ActiveRunView extends EndlessRulesView {
  owner: PublicKey;
  runId: bigint;
  mode: string;
  dailyChallenge: PublicKey;
  mapId: number;
  level: number;
  rules: ActiveRunRulesView;
  lifecycle: string;
  score: number;
  dailyScore: number;
  pressureScore: number;
  dailyScoringRule: DailyScoringRuleView;
  dailyPressure: DailyPressureProfileView;
  actionCounter: number;
  moves: number;
  comboCounter: number;
  maxCombo: number;
  primaryProgress: number;
  secondaryProgress: number;
  levelLinesCleared: number;
  totalLinesCleared: number;
  bonusUses: number;
  currentDifficulty: number;
  bonusType: number;
  bonusCharges: number;
  grid: number[];
  nextRow: number[] | null;
  pendingVrfCounter: number;
  vrfRequestCounter: number;
}

export interface ActiveRunConstraintView {
  kind: number;
  value: number;
  requiredCount: number;
}

interface RawConstraintSnapshot {
  kind: unknown;
  value: unknown;
  requiredCount: unknown;
}

export interface RawLevelRuleSnapshot {
  pointsRequired: unknown;
  maxMoves: unknown;
  difficulty: unknown;
  primary: RawConstraintSnapshot;
  secondary: RawConstraintSnapshot;
  activeMutatorId: unknown;
  passiveMutatorId: unknown;
  bossId: unknown;
  starThresholdModifier: unknown;
  bonusType: unknown;
  bonusTriggerType: unknown;
  bonusThreshold: unknown;
  startingCharges: unknown;
}

export function mapLevelRuleSnapshot(
  rules: RawLevelRuleSnapshot,
): ActiveRunRulesView {
  return {
    pointsRequired: Number(rules.pointsRequired),
    maxMoves: Number(rules.maxMoves),
    difficulty: Number(rules.difficulty),
    primary: {
      kind: Number(rules.primary.kind),
      value: Number(rules.primary.value),
      requiredCount: Number(rules.primary.requiredCount),
    },
    secondary: {
      kind: Number(rules.secondary.kind),
      value: Number(rules.secondary.value),
      requiredCount: Number(rules.secondary.requiredCount),
    },
    activeMutatorId: Number(rules.activeMutatorId),
    passiveMutatorId: Number(rules.passiveMutatorId),
    bossId: Number(rules.bossId),
    starThresholdModifier: Number(rules.starThresholdModifier),
    bonusType: Number(rules.bonusType),
    bonusTriggerType: Number(rules.bonusTriggerType),
    bonusThreshold: Number(rules.bonusThreshold),
    startingCharges: Number(rules.startingCharges),
  };
}

export interface ActiveRunRulesView {
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  primary: ActiveRunConstraintView;
  secondary: ActiveRunConstraintView;
  activeMutatorId: number;
  passiveMutatorId: number;
  bossId: number;
  starThresholdModifier: number;
  bonusType: number;
  bonusTriggerType: number;
  bonusThreshold: number;
  startingCharges: number;
}

export const VRF_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);

export function zkubeProgram(
  connection: Connection,
  wallet: WalletLike,
): Program<ZkubeProgram> {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new AnchorProgram<ZkubeProgram>(IDL, provider);
}

export async function buildPrepareCampaignRunPlan(args: {
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  mapId: number;
  level: number;
  connection?: Connection;
  sessionValidUntil: number;
}): Promise<PreparedRunPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const owner = args.ownerAuthority;
  const actor = args.wallet.publicKey;
  const profileAddress = derivePlayerProfilePda(owner);
  const campaignAddress = deriveCampaignProgressPda(owner);
  const profile =
    await program.account.playerProfile.fetchNullable(profileAddress);
  const protocolAddress = deriveProtocolConfigPda();
  const protocol = await program.account.protocolConfig.fetch(protocolAddress);
  const { runId, addresses } = resolvePreparedRunAddresses(owner, profile);
  await assertPreparedRunAddressesAvailable(
    connection,
    owner,
    runId,
    addresses,
  );
  const mapCatalog = deriveMapCatalogPda(
    Number(protocol.contentVersion),
    args.mapId,
  );
  if (!profile) {
    throw new Error("Enable zKube before starting a Campaign run");
  }
  const instructions = [
    await program.methods
      .fundedPrepareCampaignRun(
        new BN(runId.toString()),
        args.mapId,
        args.level,
      )
      .accountsPartial({
        protocol: protocolAddress,
        playerProfile: profileAddress,
        campaignProgress: campaignAddress,
        mapCatalog,
        runShell: addresses.runShell,
        activeRun: addresses.activeRun,
        runReceipt: addresses.runReceipt,
        playerFunding: derivePlayerFundingPda(owner),
        ownerAuthority: owner,
        sessionToken: args.sessionToken,
        actor,
        systemProgram: SystemProgram.programId,
        zkubeProgram: ZKUBE_PROGRAM_ID,
      })
      .instruction(),
  ];

  return {
    runId,
    addresses,
    sessionToken: args.sessionToken,
    sessionValidUntil: args.sessionValidUntil,
    transactionPlan: plan(
      "solana-base",
      "Prepare campaign run",
      connection,
      actor,
      instructions,
      [],
    ),
  };
}

export function resolvePreparedRunAddresses(
  owner: PublicKey,
  profile: {
    nextRunId: { toString(): string };
    activeRunId?: { toString(): string };
  } | null,
): { runId: bigint; addresses: RunAddresses } {
  const activeRunId = profile?.activeRunId
    ? BigInt(profile.activeRunId.toString())
    : 0n;
  if (activeRunId > 0n) {
    throw new Error(
      `Run ${activeRunId.toString()} is already active. Resume or abandon it before starting another.`,
    );
  }
  const runId = profile ? BigInt(profile.nextRunId.toString()) : INITIAL_RUN_ID;
  return { runId, addresses: deriveRunAddresses(owner, runId) };
}

export async function assertPreparedRunAddressesAvailable(
  connection: Pick<Connection, "getMultipleAccountsInfo">,
  owner: PublicKey,
  runId: bigint,
  addresses: RunAddresses,
): Promise<void> {
  const labels = ["run shell", "active run", "run receipt"] as const;
  const infos = await connection.getMultipleAccountsInfo(
    [addresses.runShell, addresses.activeRun, addresses.runReceipt],
    "confirmed",
  );
  const occupied = infos.flatMap((info, index) =>
    info ? [labels[index]] : [],
  );

  if (occupied.length > 0) {
    throw new Error(
      `Run ID ${runId.toString()} is already occupied for ${owner.toBase58()} (${occupied.join(
        ", ",
      )}). Recover or clean up that owner-scoped run before starting another.`,
    );
  }
}

export async function buildDelegateRunPlan(args: {
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey | null;
  addresses: RunAddresses;
  connection?: Connection;
}): Promise<TransactionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const validator = await getClosestValidator();
  const payer = args.wallet.publicKey;
  const instruction = await program.methods
    .delegateActiveRun()
    .accountsPartial({
      payer,
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
      runShell: args.addresses.runShell,
      pda: args.addresses.activeRun,
    })
    .remainingAccounts([
      { pubkey: validator.identity, isSigner: false, isWritable: false },
    ])
    .instruction();
  return plan("solana-base", "Delegate active run", connection, payer, [
    instruction,
  ]);
}

export async function resolveRunErConnection(
  activeRun: PublicKey,
  commitment: Commitment = "confirmed",
): Promise<Connection> {
  // The delegate tx has confirmed on base; the ER validator still has to clone
  // the account. Give the cloner a generous budget (~30s) so a fresh run's
  // launch rarely surfaces the "did not delegate" timeout to the player.
  const status = await waitForDelegation(activeRun, {
    expectedOwnerProgram: ZKUBE_PROGRAM_ID,
    commitment,
    attempts: 60,
    delayMs: 500,
  });
  return new Connection(status.fqdn, commitment);
}

export async function buildRequestRowPlan(args: {
  owner: PublicKey;
  sessionWallet: WalletLike;
  sessionToken: PublicKey;
  activeRun: PublicKey;
  erConnection: Connection;
  clientSeed?: Uint8Array;
}): Promise<TransactionPlan> {
  const actor = args.sessionWallet.publicKey;
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const clientSeed =
    args.clientSeed ?? crypto.getRandomValues(new Uint8Array(32));
  if (clientSeed.length !== 32)
    throw new Error("clientSeed must contain 32 bytes");
  const instruction = await program.methods
    .requestRowVrf([...clientSeed])
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor,
      oracleQueue: VRF_QUEUE,
      delegationRecordActive: getDelegationRecord(args.activeRun),
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Request fresh row VRF",
    args.erConnection,
    actor,
    [instruction],
  );
}

export async function buildPlayMovePlan(args: {
  owner: PublicKey;
  sessionWallet: WalletLike;
  sessionToken: PublicKey;
  activeRun: PublicKey;
  erConnection: Connection;
  expectedMove: number;
  expectedAction: number;
  row: number;
  start: number;
  destination: number;
  clientSeed?: Uint8Array;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const clientSeed =
    args.clientSeed ?? crypto.getRandomValues(new Uint8Array(32));
  if (clientSeed.length !== 32)
    throw new Error("clientSeed must contain 32 bytes");
  const instruction = await program.methods
    .playMove(
      args.expectedAction,
      args.expectedMove,
      args.row,
      args.start,
      args.destination,
      [...clientSeed],
    )
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor: args.sessionWallet.publicKey,
      oracleQueue: VRF_QUEUE,
      delegationRecordActive: getDelegationRecord(args.activeRun),
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Play move",
    args.erConnection,
    args.sessionWallet.publicKey,
    [instruction],
  );
}

export async function buildApplyBonusPlan(args: {
  owner: PublicKey;
  sessionWallet: WalletLike;
  sessionToken: PublicKey;
  activeRun: PublicKey;
  erConnection: Connection;
  expectedAction: number;
  row: number;
  column: number;
  clientSeed?: Uint8Array;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const clientSeed =
    args.clientSeed ?? crypto.getRandomValues(new Uint8Array(32));
  if (clientSeed.length !== 32)
    throw new Error("clientSeed must contain 32 bytes");
  const instruction = await program.methods
    .applyBonus(args.expectedAction, args.row, args.column, [...clientSeed])
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor: args.sessionWallet.publicKey,
      oracleQueue: VRF_QUEUE,
      delegationRecordActive: getDelegationRecord(args.activeRun),
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Apply bonus",
    args.erConnection,
    args.sessionWallet.publicKey,
    [instruction],
  );
}

export async function buildSealRunPlan(args: {
  owner: PublicKey;
  sessionWallet: WalletLike;
  sessionToken: PublicKey;
  activeRun: PublicKey;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const instruction = await program.methods
    .sealRun()
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor: args.sessionWallet.publicKey,
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Seal run",
    args.erConnection,
    args.sessionWallet.publicKey,
    [instruction],
  );
}

/**
 * Give up a non-terminal run on the ER: forces the delegated ActiveRun into
 * the `finished` lifecycle (kept score, zero stars) so the unchanged
 * commit/consume/close pipeline settles it and reclaims rent. Signed by the
 * owner (sessionToken null) or a fresh session key.
 */
export async function buildAbandonRunPlan(args: {
  owner: PublicKey;
  signerWallet: WalletLike;
  sessionToken: PublicKey | null;
  activeRun: PublicKey;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.signerWallet);
  const instruction = await program.methods
    .abandonRun()
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor: args.signerWallet.publicKey,
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Abandon run",
    args.erConnection,
    args.signerWallet.publicKey,
    [instruction],
  );
}

export async function buildCommitRunPlan(args: {
  owner: PublicKey;
  payerWallet: WalletLike;
  addresses: RunAddresses;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.payerWallet);
  const instruction = await program.methods
    .commitRun()
    .accountsPartial({
      payer: args.payerWallet.publicKey,
      activeRun: args.addresses.activeRun,
      runShell: args.addresses.runShell,
      runReceipt: args.addresses.runReceipt,
      playerProfile: derivePlayerProfilePda(args.owner),
      campaignProgress: deriveCampaignProgressPda(args.owner),
      owner: args.owner,
      magicContext: MAGIC_CONTEXT_ID,
      magicProgram: MAGIC_PROGRAM_ID,
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Commit and undelegate run",
    args.erConnection,
    args.payerWallet.publicKey,
    [instruction],
  );
}

export async function buildCloseSettledRunPlan(args: {
  wallet: WalletLike;
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  connection?: Connection;
}): Promise<TransactionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const instruction = await buildCloseSettledInstruction(program, args);
  return plan(
    "solana-base",
    "Close settled active run",
    connection,
    args.wallet.publicKey,
    [instruction],
  );
}

/**
 * Canonical base-layer settlement in ONE atomic transaction: consume the
 * durable receipt and close the ActiveRun for rent.
 * Neither receipt consumption nor canonical rent recovery needs a program-level
 * signer; every mutable account and the System-owned rent destination are
 * validated PDAs. This is both the tail of
 * the normal settle pipeline and the recovery path for wedged runs.
 */
export async function buildFinalizeRunPlan(args: {
  wallet: WalletLike;
  owner: PublicKey;
  sessionToken: PublicKey | null;
  runId: bigint;
  addresses: RunAddresses;
  mode: "campaign" | "daily";
  dailyChallenge?: PublicKey | null;
  dailyVersion?: 1 | 2;
  receiptConsumed: boolean;
  /** Owner-signed abandon prepended for a stuck non-terminal base run. */
  abandonFirst?: boolean;
  connection?: Connection;
}): Promise<TransactionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const instructions: TransactionInstruction[] = [];
  if (args.abandonFirst) {
    instructions.push(
      await program.methods
        .abandonRun()
        .accountsPartial({
          activeRun: args.addresses.activeRun,
          ownerAuthority: args.owner,
          sessionToken: args.sessionToken,
          actor: args.wallet.publicKey,
        })
        .instruction(),
    );
  }
  if (!args.receiptConsumed) {
    instructions.push(await buildConsumeReceiptInstruction(program, args));
  }
  instructions.push(
    await buildCloseSettledInstruction(program, args),
  );
  return plan(
    "solana-base",
    "Finalize run settlement",
    connection,
    args.wallet.publicKey,
    instructions,
  );
}

export async function buildConsumeReceiptRecoveryPlan(args: {
  wallet: WalletLike;
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  mode: "campaign" | "daily";
  dailyChallenge?: PublicKey | null;
  receiptConsumed?: boolean;
  connection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.connection, args.wallet);
  const instructions: TransactionInstruction[] = [];
  if (!args.receiptConsumed) {
    instructions.push(await buildConsumeReceiptInstruction(program, args));
  }
  instructions.push(await buildCloseSettledInstruction(program, args));
  return plan(
    "solana-base",
    `Finalize orphaned ${args.mode} run`,
    args.connection,
    args.wallet.publicKey,
    instructions,
  );
}

async function buildCloseSettledInstruction(
  program: Program<ZkubeProgram>,
  args: { owner: PublicKey; runId: bigint; addresses: RunAddresses },
): Promise<TransactionInstruction> {
  return program.methods
    .closeSettledActiveRun(new BN(args.runId.toString()))
    .accountsPartial({
      ownerAuthority: args.owner,
      protocol: deriveProtocolConfigPda(),
      rentRecipient: derivePlayerFundingPda(args.owner),
      runShell: args.addresses.runShell,
      runReceipt: args.addresses.runReceipt,
      activeRun: args.addresses.activeRun,
    })
    .instruction();
}

async function buildConsumeReceiptInstruction(
  program: Program<ZkubeProgram>,
  args: {
    owner: PublicKey;
    addresses: RunAddresses;
    mode: "campaign" | "daily";
    dailyChallenge?: PublicKey | null;
  },
): Promise<TransactionInstruction> {
  if (args.mode === "daily") {
    const dailyChallenge = args.dailyChallenge;
    if (!dailyChallenge) {
      throw new Error("Daily settlement requires the challenge address");
    }
    return program.methods
      .consumeDailyReceipt()
      .accountsPartial({
        activeRun: args.addresses.activeRun,
        runShell: args.addresses.runShell,
        runReceipt: args.addresses.runReceipt,
        playerProfile: derivePlayerProfilePda(args.owner),
        dailyChallenge,
        dailyPlayer: deriveDailyPlayerPda(dailyChallenge, args.owner),
        leaderboard: deriveDailyLeaderboardPda(dailyChallenge),
        weeklyStipend: deriveWeeklyStipendPda(args.owner),
        owner: args.owner,
      })
      .instruction();
  }
  return program.methods
    .consumeRunReceipt()
    .accountsPartial({
      activeRun: args.addresses.activeRun,
      runShell: args.addresses.runShell,
      runReceipt: args.addresses.runReceipt,
      playerProfile: derivePlayerProfilePda(args.owner),
      campaignProgress: deriveCampaignProgressPda(args.owner),
      owner: args.owner,
    })
    .instruction();
}

export async function fetchActiveRun(
  connection: Connection,
  _wallet: WalletLike,
  activeRun: PublicKey,
): Promise<ActiveRunView | null> {
  const info = await connection.getAccountInfo(activeRun, "confirmed");
  if (!info) return null;
  return decodeActiveRunAccount(info.data, info.owner);
}

type DecodedActiveRunAccount = Awaited<
  ReturnType<ReturnType<typeof zkubeProgram>["account"]["activeRun"]["fetch"]>
>;

const activeRunCoder = new BorshAccountsCoder(IDL);
const activeRunAccountSize = activeRunCoder.size("ActiveRun");

/** Validate owner, exact fixed size, and discriminator before ER/base decode. */
export function decodeActiveRunAccount(
  data: Uint8Array,
  owner: PublicKey,
): ActiveRunView {
  if (!owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("ActiveRun account is not owned by the zKube program");
  }
  if (data.length !== activeRunAccountSize) {
    throw new Error(
      `ActiveRun account length is invalid: expected ${activeRunAccountSize}, received ${data.length}`,
    );
  }
  const decoded = activeRunCoder.decode<DecodedActiveRunAccount>(
    "ActiveRun",
    Buffer.from(data),
  );
  return mapActiveRunAccount(decoded);
}

export function mapActiveRunAccount(
  account: DecodedActiveRunAccount,
): ActiveRunView {
  const lifecycle = Object.keys(account.lifecycle)[0] ?? "unknown";
  const dailyPressure = mapDailyPressureProfile(account.dailyPressure);
  return {
    owner: account.owner,
    runId: BigInt(account.runId.toString()),
    mode: Object.keys(account.mode)[0] ?? "unknown",
    dailyChallenge: account.dailyChallenge,
    mapId: Number(account.mapId),
    level: Number(account.level),
    rules: mapLevelRuleSnapshot(account.rules),
    lifecycle,
    score: Number(account.score),
    dailyScore: Number(account.dailyScore),
    pressureScore: Number(account.pressureScore),
    dailyScoringRule: mapDailyScoringRule(account.dailyScoringRule),
    dailyPressure,
    actionCounter: Number(account.actionCounter),
    moves: Number(account.moves),
    comboCounter: Number(account.comboCounter),
    maxCombo: Number(account.maxCombo),
    primaryProgress: Number(account.primaryProgress),
    secondaryProgress: Number(account.secondaryProgress),
    levelLinesCleared: Number(account.levelLinesCleared),
    totalLinesCleared: Number(account.totalLinesCleared),
    bonusUses: Number(account.bonusUses),
    currentDifficulty: Number(account.currentDifficulty),
    // Presentation aliases retained while the HUD terminology migrates from
    // the old Cairo endless mode to Daily pressure tiers.
    endlessThresholds: dailyPressure.thresholds,
    endlessScoreMultipliersX100: dailyPressure.scoreMultipliersX100,
    endlessRampMultiplierX100: 100,
    bonusType: Number(account.bonusType),
    bonusCharges: Number(account.bonusCharges),
    grid: [...account.grid].map(Number),
    nextRow: account.hasNextRow ? [...account.nextRow].map(Number) : null,
    pendingVrfCounter: Number(account.pendingVrfCounter),
    vrfRequestCounter: Number(account.vrfRequestCounter),
  };
}

export async function simulateTransactionPlan(
  transactionPlan: TransactionPlan,
): Promise<void> {
  const transaction = transactionPlan.transaction;
  transaction.feePayer ??= transactionPlan.feePayer;
  if (!transaction.recentBlockhash) {
    transaction.recentBlockhash = (
      await transactionPlan.connection.getLatestBlockhash("confirmed")
    ).blockhash;
  }
  if (transactionPlan.signers.length > 0) {
    transaction.partialSign(...transactionPlan.signers);
  }
  const result =
    await transactionPlan.connection.simulateTransaction(transaction);
  if (result.value.err) {
    throw new Error(
      `Simulation failed for ${transactionPlan.label}: ${JSON.stringify(result.value.err)}`,
    );
  }
}

export async function submitWalletTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
}): Promise<string> {
  const transaction = args.transactionPlan.transaction;
  transaction.feePayer = args.transactionPlan.feePayer;
  transaction.recentBlockhash = (
    await args.transactionPlan.connection.getLatestBlockhash("confirmed")
  ).blockhash;
  if (args.transactionPlan.signers.length > 0) {
    transaction.partialSign(...args.transactionPlan.signers);
  }
  const signed = await args.wallet.signTransaction(transaction);
  const simulation =
    await args.transactionPlan.connection.simulateTransaction(signed);
  if (simulation.value.err) {
    throw new Error(
      `Simulation failed for ${args.transactionPlan.label}: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  const signature = await args.transactionPlan.connection.sendRawTransaction(
    signed.serialize(),
    {
      maxRetries: 5,
      skipPreflight: false,
    },
  );
  await args.transactionPlan.connection.confirmTransaction(
    signature,
    "confirmed",
  );
  return signature;
}

export async function compileWalletTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
}): Promise<VersionedTransaction> {
  const { transactionPlan } = args;
  if (!transactionPlan.feePayer.equals(args.wallet.publicKey)) {
    throw new Error("The transaction fee payer must be the signing wallet");
  }
  const { blockhash } =
    await transactionPlan.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: transactionPlan.feePayer,
    recentBlockhash: blockhash,
    instructions: transactionPlan.transaction.instructions,
  }).compileToV0Message();
  let transaction = new VersionedTransaction(message);
  if (transactionPlan.signers.length > 0)
    transaction.sign(transactionPlan.signers);
  transaction = await args.wallet.signTransaction(transaction);
  const simulation = await transactionPlan.connection.simulateTransaction(
    transaction,
    {
      sigVerify: false,
      replaceRecentBlockhash: false,
    },
  );
  if (simulation.value.err) {
    throw new Error(
      `Simulation failed for ${transactionPlan.label}: ${JSON.stringify(simulation.value.err)}`,
    );
  }
  return transaction;
}

export async function submitVersionedTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
}): Promise<string> {
  const transaction = await compileWalletTransactionPlan({
    transactionPlan: args.transactionPlan,
    wallet: args.wallet,
  });
  const signature = await args.transactionPlan.connection.sendRawTransaction(
    transaction.serialize(),
    { maxRetries: 5, skipPreflight: false },
  );
  await args.transactionPlan.connection.confirmTransaction(
    signature,
    "confirmed",
  );
  return signature;
}

export async function submitPreparedRunPlan(args: {
  preparedRun: PreparedRunPlan;
  owner: PublicKey;
  wallet: WalletLike;
  sessionSigner: Keypair;
  mode?: "campaign" | "daily";
  dailyVersion?: 1 | 2;
}): Promise<string> {
  const signature = await submitVersionedTransactionPlan({
    transactionPlan: args.preparedRun.transactionPlan,
    wallet: args.wallet,
  });
  await args.preparedRun.transactionPlan.connection.confirmTransaction(
    signature,
    "confirmed",
  );
  saveRunSession({
    owner: args.owner,
    runId: args.preparedRun.runId,
    mode: args.mode ?? "campaign",
    dailyVersion: args.dailyVersion ?? 1,
    session: args.sessionSigner,
    sessionToken: args.preparedRun.sessionToken,
    addresses: args.preparedRun.addresses,
    validUntil: args.preparedRun.sessionValidUntil,
    createdAt: Math.floor(Date.now() / 1_000),
  });
  return signature;
}

function plan(
  layer: RunLayer,
  label: string,
  connection: Connection,
  feePayer: PublicKey,
  instructions: TransactionInstruction[],
  signers: Signer[] = [],
): TransactionPlan {
  return {
    layer,
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers,
  };
}

if (!ZKUBE_PROGRAM_ID.equals(new PublicKey(IDL.address))) {
  throw new Error(
    "Generated zkube IDL program address does not match runtime configuration",
  );
}
