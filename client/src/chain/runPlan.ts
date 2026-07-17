/**
 * Transaction orchestration boundary.
 *
 * Solana base plans use the device session signer for transaction fees while
 * narrow on-chain wrappers use the owner's System-owned, zero-data funding PDA
 * for account rent. Router-selected ER plans use that same device signer. Durable run
 * markers are saved only after base confirmation.
 */
import {
  delegateBufferPdaFromDelegatedAccountAndOwnerProgram,
  delegationMetadataPdaFromDelegatedAccount,
  delegationRecordPdaFromDelegatedAccount,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  AnchorProvider,
  BorshAccountsCoder,
  Program as AnchorProgram,
  convertIdlToCamelCase,
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
  DELEGATION_PROGRAM_ID,
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
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveMapCatalogPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  type RunAddresses,
} from "./pdas.js";
import { getClosestValidator, waitForDelegation } from "./router.js";
import {
  mapDailyPressureProfile,
  mapDailyScoringRule,
  type DailyPressureProfileView,
  type DailyScoringRuleView,
} from "./dailyRules.js";
import {
  assertDeviceSignerCanPay,
  DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS,
} from "./deviceSessionFunding.js";

type RunLayer = "solana-base" | "magicblock-er";

export interface TransactionPlan {
  layer: RunLayer;
  label: string;
  connection: Connection;
  transaction: Transaction;
  feePayer: PublicKey;
  signers: Signer[];
  /** When set, preflight the exact base fee while retaining this much
   * spendable balance above the zero-data System-account rent floor. */
  postFeeRentReserveLamports?: number;
}

export interface PreparedRunPlan {
  runId: bigint;
  addresses: RunAddresses;
  sessionToken: PublicKey;
  sessionValidUntil: number;
  transactionPlan: TransactionPlan;
}

type EndlessThresholdsView = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

type EndlessScoreMultipliersX100View = [
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
  dailyBonusTriggers: number;
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
  const profileAddress = derivePlayerStatePda(owner);
  const profile =
    await program.account.playerState.fetchNullable(profileAddress);
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
        playerState: profileAddress,
        mapCatalog,
        activeRun: addresses.activeRun,
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
  const labels = ["active run"] as const;
  const infos = await connection.getMultipleAccountsInfo(
    [addresses.activeRun],
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
  sessionToken: PublicKey;
  addresses: RunAddresses;
  connection?: Connection;
}): Promise<TransactionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const validator = await getClosestValidator();
  const payer = args.wallet.publicKey;
  const activeRun = args.addresses.activeRun;
  const instruction = await program.methods
    .fundedDelegateActiveRun()
    .accountsPartial({
      bufferPda: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        activeRun,
        ZKUBE_PROGRAM_ID,
      ),
      delegationRecordPda: delegationRecordPdaFromDelegatedAccount(activeRun),
      delegationMetadataPda:
        delegationMetadataPdaFromDelegatedAccount(activeRun),
      pda: activeRun,
      playerFunding: derivePlayerFundingPda(args.ownerAuthority),
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
      ownerProgram: ZKUBE_PROGRAM_ID,
      delegationProgram: DELEGATION_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts([
      { pubkey: validator.identity, isSigner: false, isWritable: false },
    ])
    .instruction();
  return plan(
    "solana-base",
    "Delegate active run",
    connection,
    payer,
    [instruction],
    [],
    {
      postFeeRentReserveLamports: DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS,
    },
  );
}

/**
 * Fresh-run fast path: prepare and delegate in one atomic v0 transaction.
 *
 * The delegate instruction may consume accounts created by the immediately
 * preceding prepare instruction. If either instruction fails, Solana rolls
 * the entire transaction back, so the player cannot be left with a prepared
 * run solely because the second base-layer submission failed.
 */
export async function combinePreparedAndDelegatePlan(args: {
  prepared: PreparedRunPlan;
  wallet: WalletLike;
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
}): Promise<PreparedRunPlan> {
  const delegate = await buildDelegateRunPlan({
    wallet: args.wallet,
    ownerAuthority: args.ownerAuthority,
    sessionToken: args.sessionToken,
    addresses: args.prepared.addresses,
    connection: args.prepared.transactionPlan.connection,
  });
  if (
    delegate.layer !== "solana-base" ||
    !delegate.feePayer.equals(args.prepared.transactionPlan.feePayer) ||
    delegate.connection.rpcEndpoint !==
      args.prepared.transactionPlan.connection.rpcEndpoint
  ) {
    throw new Error(
      "Prepare and delegate plans do not share one base boundary",
    );
  }
  return {
    ...args.prepared,
    transactionPlan: plan(
      "solana-base",
      "Prepare and delegate active run",
      args.prepared.transactionPlan.connection,
      args.prepared.transactionPlan.feePayer,
      [
        ...args.prepared.transactionPlan.transaction.instructions,
        ...delegate.transaction.instructions,
      ],
      [...args.prepared.transactionPlan.signers, ...delegate.signers],
      {
        postFeeRentReserveLamports: DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS,
      },
    ),
  };
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

/**
 * Canonical base-layer settlement in one atomic transaction: consume the
 * copied-back ActiveRun, update durable state, clear active_run_id, and close
 * the transient account to the owner's funding PDA.
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
  instructions.push(await buildConsumeRunInstruction(program, args));
  return plan(
    "solana-base",
    "Finalize run settlement",
    connection,
    args.wallet.publicKey,
    instructions,
  );
}

export async function buildConsumeRunRecoveryPlan(args: {
  wallet: WalletLike;
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  mode: "campaign" | "daily";
  dailyChallenge?: PublicKey | null;
  connection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.connection, args.wallet);
  const instructions: TransactionInstruction[] = [];
  instructions.push(await buildConsumeRunInstruction(program, args));
  return plan(
    "solana-base",
    `Finalize orphaned ${args.mode} run`,
    args.connection,
    args.wallet.publicKey,
    instructions,
  );
}

async function buildConsumeRunInstruction(
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
      .consumeDailyRun()
      .accountsPartial({
        activeRun: args.addresses.activeRun,
        playerState: derivePlayerStatePda(args.owner),
        dailyChallenge,
        dailyPlayer: deriveDailyPlayerPda(dailyChallenge, args.owner),
        leaderboard: deriveDailyLeaderboardPda(dailyChallenge),
        owner: args.owner,
        rentRecipient: derivePlayerFundingPda(args.owner),
      })
      .instruction();
  }
  return program.methods
    .consumeCampaignRun()
    .accountsPartial({
      activeRun: args.addresses.activeRun,
      playerState: derivePlayerStatePda(args.owner),
      owner: args.owner,
      rentRecipient: derivePlayerFundingPda(args.owner),
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

// Program clients normalize raw Anchor IDL names to camelCase before building
// their coder. This standalone decoder must do the same: constructing directly
// from the raw snake_case JSON produces objects whose fields silently disagree
// with the generated TypeScript account shape.
const activeRunCoder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
const activeRunAccountSize = activeRunCoder.size("activeRun");

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
    "activeRun",
    Buffer.from(data),
  );
  return mapActiveRunAccount(decoded);
}

function mapActiveRunAccount(
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
    dailyBonusTriggers: Number(account.dailyBonusTriggers),
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
    bonusType: Number(account.bonusType),
    bonusCharges: Number(account.bonusCharges),
    grid: [...account.grid].map(Number),
    nextRow: account.hasNextRow ? [...account.nextRow].map(Number) : null,
    pendingVrfCounter: Number(account.pendingVrfCounter),
    vrfRequestCounter: Number(account.vrfRequestCounter),
  };
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
  if (transactionPlan.postFeeRentReserveLamports !== undefined) {
    const [fee, balanceLamports, rentFloorLamports] = await Promise.all([
      transactionPlan.connection.getFeeForMessage(message, "confirmed"),
      transactionPlan.connection.getBalance(
        transactionPlan.feePayer,
        "confirmed",
      ),
      transactionPlan.connection.getMinimumBalanceForRentExemption(
        0,
        "confirmed",
      ),
    ]);
    if (fee.value === null) {
      throw new Error(
        `Unable to estimate the transaction fee for ${transactionPlan.label}`,
      );
    }
    assertDeviceSignerCanPay({
      balanceLamports,
      rentFloorLamports,
      transactionFeeLamports: fee.value,
      postFeeReserveLamports: transactionPlan.postFeeRentReserveLamports,
    });
  }
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
  options: Pick<TransactionPlan, "postFeeRentReserveLamports"> = {},
): TransactionPlan {
  return {
    layer,
    label,
    connection,
    transaction: new Transaction().add(...instructions),
    feePayer,
    signers,
    ...options,
  };
}

if (!ZKUBE_PROGRAM_ID.equals(new PublicKey(IDL.address))) {
  throw new Error(
    "Generated zkube IDL program address does not match runtime configuration",
  );
}
