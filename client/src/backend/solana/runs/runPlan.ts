/**
 * Transaction orchestration boundary.
 *
 * Solana base plans use the device session signer for transaction fees while
 * the device signer pays account rent and transaction fees. Router-selected ER
 * plans use that same device signer. Durable run
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
  ComputeBudgetProgram,
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
import { IDL, type ZkubeProgram } from "../idl/index.js";
import {
  INITIAL_RUN_ID,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  SOLANA_ENDPOINT,
  ZKUBE_PROGRAM_ID,
  getDelegationRecord,
} from "../constants.js";
import { saveRunSession, type RunSlot } from "./runSessionStore.js";
import { SessionWallet, type WalletLike } from "../session/sessionWallet.js";
import {
  deriveArenaPlayerPda,
  deriveMapCatalogPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  type RunAddresses,
} from "../pdas.js";
import { getClosestValidator, waitForDelegation } from "./router.js";
import {
  CANONICAL_DAILY_PRESSURE,
  type DailyPressureProfileView,
  type DailyThemeView,
} from "../../../core/dailyRules.js";
import {
  assertDeviceSignerCanPay,
  DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS,
} from "../session/deviceSessionFunding.js";
import { deriveSessionTokenV2Pda } from "../session/sessionV2.js";
import { PLAYER_STATE_ACCOUNT_VERSION } from "../../../core/protocolVersions.generated.js";
import {
  coreBuildRunConfig,
  coreReconcileRunState,
  type CoreRunPhase,
  type CoreRunToken,
} from "../../../core/zkubeCore.js";
import {
  mapLevelRuleSnapshot,
  projectCoreRun,
  type ActiveRunRulesView,
} from "../../../core/runProjection.js";

/** Pin the complete budget before wallet approval so Phantom has no missing
 * priority-fee field to inject into the exact message. */
export const WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT = 400_000;
export const WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 1_000;

export function withPinnedWalletComputeBudget(
  instructions: readonly TransactionInstruction[],
): TransactionInstruction[] {
  const limitInstruction = ComputeBudgetProgram.setComputeUnitLimit({
    units: WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
  });
  const priceInstruction = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  });
  const hasLimit = instructions.some((instruction) =>
    isComputeBudgetVariant(instruction, limitInstruction.data[0]),
  );
  const hasPrice = instructions.some((instruction) =>
    isComputeBudgetVariant(instruction, priceInstruction.data[0]),
  );
  if (hasLimit && hasPrice) return [...instructions];

  const firstNonBudget = instructions.findIndex(
    (instruction) =>
      !instruction.programId.equals(ComputeBudgetProgram.programId),
  );
  const insertionIndex =
    firstNonBudget < 0 ? instructions.length : firstNonBudget;
  return [
    ...instructions.slice(0, insertionIndex),
    ...(hasLimit ? [] : [limitInstruction]),
    ...(hasPrice ? [] : [priceInstruction]),
    ...instructions.slice(insertionIndex),
  ];
}

function isComputeBudgetVariant(
  instruction: TransactionInstruction,
  discriminator: number | undefined,
): boolean {
  return (
    discriminator !== undefined &&
    instruction.programId.equals(ComputeBudgetProgram.programId) &&
    instruction.data[0] === discriminator
  );
}

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

export interface ActiveRunView {
  /** Opaque deterministic state/config pair that drives every local view. */
  runToken?: CoreRunToken;
  version?: number;
  owner: PublicKey;
  rentPayer: PublicKey;
  runId: bigint;
  mode: string;
  dailyChallenge: PublicKey;
  mapId: number;
  level: number;
  rules: ActiveRunRulesView;
  lifecycle: string;
  finishReason?: string | null;
  /** Authoritative chain deadline for Daily; Campaign uses zero. */
  deadlineAt?: number;
  score: number;
  dailyScore: number;
  pressureScore: number;
  dailyTheme: DailyThemeView;
  dailyPressure: DailyPressureProfileView;
  objectiveTotal: bigint;
  actionCounter: number;
  moves: number;
  comboCounter: number;
  maxCombo: number;
  primaryProgress: number;
  secondaryProgress: number;
  latchedStarSources: number;
  streak: number;
  chargesEarned: number;
  levelLinesCleared: number;
  totalLinesCleared: number;
  bonusUses: number;
  currentTier: number;
  currentDifficulty: number;
  bonusType: number;
  bonusCharges: number;
  rerollCharges: number;
  grid: number[];
  nextRow: number[] | null;
  pendingVrfCounter: number;
  vrfRequestCounter: number;
  rulesHash?: number[];
  replayHash?: number[];
  finishedAt?: number;
  bump?: number;
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
  const { runId, addresses } = resolvePreparedRunAddresses(
    owner,
    profile,
    "campaign",
  );
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
      .prepareCampaignRun(new BN(runId.toString()), args.mapId, args.level)
      .accountsPartial({
        protocol: protocolAddress,
        playerState: profileAddress,
        mapCatalog,
        activeRun: addresses.activeRun,
        payer: actor,
        ownerAuthority: owner,
        sessionToken: args.sessionToken,
        actor,
        systemProgram: SystemProgram.programId,
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
  profile: RunSlotProfile | null,
  slot: RunSlot,
): { runId: bigint; addresses: RunAddresses } {
  const activeRunId = activeRunIdForSlot(profile, slot);
  if (activeRunId > 0n) {
    throw new Error(
      `${slot === "campaign" ? "Campaign" : "Arcade"} run ${activeRunId.toString()} is already active. Resume it before starting another.`,
    );
  }
  const runId = profile ? BigInt(profile.nextRunId.toString()) : INITIAL_RUN_ID;
  return { runId, addresses: deriveRunAddresses(owner, runId) };
}

interface RunSlotProfile {
  version: number | { toString(): string };
  nextRunId: { toString(): string };
  activeRunId?: { toString(): string };
  campaignActiveRunId?: { toString(): string };
}

/** Return the exact fresh-bootstrap PlayerState slot for a run family. */
export function activeRunIdForSlot(
  profile: Pick<
    RunSlotProfile,
    "version" | "activeRunId" | "campaignActiveRunId"
  > | null,
  slot: RunSlot,
): bigint {
  if (!profile) return 0n;
  const version = Number(profile.version);
  const sharedRunId = profile.activeRunId
    ? BigInt(profile.activeRunId.toString())
    : 0n;
  if (version !== PLAYER_STATE_ACCOUNT_VERSION) {
    throw new Error("PlayerState has an unsupported run-slot version");
  }
  if (slot === "arcade") return sharedRunId;
  if (!profile.campaignActiveRunId) {
    throw new Error("PlayerState is missing its Campaign run slot");
  }
  return BigInt(profile.campaignActiveRunId.toString());
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
    .delegateActiveRun()
    .accountsPartial({
      bufferPda: delegateBufferPdaFromDelegatedAccountAndOwnerProgram(
        activeRun,
        ZKUBE_PROGRAM_ID,
      ),
      delegationRecordPda: delegationRecordPdaFromDelegatedAccount(activeRun),
      delegationMetadataPda:
        delegationMetadataPdaFromDelegatedAccount(activeRun),
      pda: activeRun,
      payer,
      ownerAuthority: args.ownerAuthority,
      sessionToken: args.sessionToken,
      actor: args.wallet.publicKey,
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
  ownerAuthority: PublicKey;
  sessionToken: PublicKey;
  sessionSigner: Keypair;
}): Promise<PreparedRunPlan> {
  if (!args.prepared.sessionToken.equals(args.sessionToken)) {
    throw new Error("Prepared run and delegation use different session tokens");
  }
  const expectedSessionToken = deriveSessionTokenV2Pda({
    authority: args.ownerAuthority,
    sessionSigner: args.sessionSigner.publicKey,
  }).sessionToken;
  if (!expectedSessionToken.equals(args.sessionToken)) {
    throw new Error(
      "Delegation session token does not match the device signer",
    );
  }
  const sessionWallet = new SessionWallet(args.sessionSigner);
  const delegate = await buildDelegateRunPlan({
    wallet: sessionWallet,
    ownerAuthority: args.ownerAuthority,
    sessionToken: args.sessionToken,
    addresses: args.prepared.addresses,
    connection: args.prepared.transactionPlan.connection,
  });
  if (
    args.prepared.transactionPlan.layer !== "solana-base" ||
    delegate.layer !== "solana-base" ||
    !delegate.feePayer.equals(args.sessionSigner.publicKey) ||
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
      args.sessionSigner.publicKey,
      [
        ...args.prepared.transactionPlan.transaction.instructions,
        ...delegate.transaction.instructions,
      ],
      uniqueSigners([
        ...args.prepared.transactionPlan.signers,
        ...delegate.signers,
        args.sessionSigner,
      ]),
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
    .requestVrf([...clientSeed])
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

export async function buildRequestRerollPlan(args: {
  owner: PublicKey;
  sessionWallet: WalletLike;
  sessionToken: PublicKey;
  activeRun: PublicKey;
  erConnection: Connection;
  expectedAction: number;
  clientSeed?: Uint8Array;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const clientSeed =
    args.clientSeed ?? crypto.getRandomValues(new Uint8Array(32));
  if (clientSeed.length !== 32)
    throw new Error("clientSeed must contain 32 bytes");
  const instruction = await program.methods
    .requestReroll(args.expectedAction, [...clientSeed])
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
    "Reroll preview",
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
export async function buildFinishRunPlan(args: {
  owner: PublicKey;
  signerWallet: WalletLike;
  sessionToken: PublicKey | null;
  activeRun: PublicKey;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.signerWallet);
  const instruction = await program.methods
    .finishRun({ abandon: {} })
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
        .finishRun({ abandon: {} })
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
  const { rentPayer } = await program.account.activeRun.fetch(
    args.addresses.activeRun,
  );
  if (args.mode === "daily") {
    const dailyChallenge = args.dailyChallenge;
    if (!dailyChallenge) {
      throw new Error("Daily settlement requires the challenge address");
    }
    return program.methods
      .consumeArenaRun()
      .accountsPartial({
        activeRun: args.addresses.activeRun,
        playerState: derivePlayerStatePda(args.owner),
        arenaDaily: dailyChallenge,
        arenaPlayer: deriveArenaPlayerPda(dailyChallenge, args.owner),
        rentRecipient: rentPayer,
      })
      .instruction();
  }
  return program.methods
    .consumeCampaignRun()
    .accountsPartial({
      activeRun: args.addresses.activeRun,
      playerState: derivePlayerStatePda(args.owner),
      owner: args.owner,
      rentRecipient: rentPayer,
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

/** Every persisted run field must have an explicit client projection. The
 * exhaustive source-key type and the IDL-backed test make adding storage
 * without naming its reader a compile- or test-time failure. */
export const ACTIVE_RUN_FIELD_PROJECTIONS = {
  version: "version",
  owner: "owner",
  rentPayer: "rentPayer",
  dailyChallenge: "dailyChallenge",
  runId: "runId",
  mode: "mode",
  lifecycle: "lifecycle",
  finishReason: "finishReason",
  rulesHash: "runToken",
  deadlineAt: "deadlineAt",
  mapId: "mapId",
  level: "level",
  rules: "rules",
  grid: "runToken",
  nextRow: "runToken",
  hasNextRow: "runToken",
  score: "runToken",
  dailyScore: "runToken",
  objectiveTotal: "runToken",
  pressureScore: "runToken",
  dailyTheme: "dailyTheme",
  actionCounter: "runToken",
  moves: "runToken",
  comboCounter: "runToken",
  maxCombo: "runToken",
  primaryProgress: "runToken",
  secondaryProgress: "runToken",
  latchedStarSources: "runToken",
  streak: "runToken",
  chargesEarned: "runToken",
  levelLinesCleared: "runToken",
  bonusType: "runToken",
  bonusCharges: "runToken",
  rerollCharges: "runToken",
  currentTier: "runToken",
  vrfRequestCounter: "vrfRequestCounter",
  pendingVrfCounter: "pendingVrfCounter",
  replayHash: "runToken",
  finishedAt: "finishedAt",
  bump: "bump",
} as const satisfies Record<keyof DecodedActiveRunAccount, keyof ActiveRunView>;

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
  return reconcileRunFromChain(decoded);
}

/**
 * Rebuild the deterministic token from the validated account, then project the
 * HUD view from that token. This is the only chain-to-engine reconciliation
 * path used by subscriptions, confirmation polling, and recovery.
 */
export function reconcileRunFromChain(
  account: DecodedActiveRunAccount,
): ActiveRunView {
  const lifecycle = Object.keys(account.lifecycle)[0] ?? "unknown";
  const finishReason =
    account.finishReason === null
      ? null
      : (Object.keys(account.finishReason)[0] ?? null);
  const mode = Object.keys(account.mode)[0] ?? "unknown";
  if (mode !== "campaign" && mode !== "daily") {
    throw new Error("ActiveRun mode is invalid");
  }
  const dailyPressure = CANONICAL_DAILY_PRESSURE;
  const mapId = Number(account.mapId);
  const level = Number(account.level);
  const rules = mapLevelRuleSnapshot(account.rules, mapId, level, mode);
  const dailyTheme = {
    kind: Number(account.dailyTheme.kind),
    value: Number(account.dailyTheme.value),
  };
  const rulesHash = Uint8Array.from(account.rulesHash, Number);
  const replayHash = Uint8Array.from(account.replayHash, Number);
  const config = coreBuildRunConfig({
    mode,
    rulesHash,
    initialReplay: replayHash,
    maxMoves: rules.maxMoves,
    bonusType: rules.guardian.bonus,
    trigger: rules.guardian.trigger,
    triggerThreshold: rules.guardian.threshold,
    startingHeight: rules.startingRows,
    fixedTier: rules.difficulty,
    pointsRequired: rules.pointsRequired,
    primary: rules.primary,
    secondary: rules.secondary,
    objective: { ...dailyTheme, requiredCount: 0 },
  });
  const state = coreReconcileRunState(config, {
    phase: chainCorePhase(lifecycle),
    endReason: chainEndReason(lifecycle, finishReason),
    bonusType: Number(account.bonusType),
    bonusCharges: Number(account.bonusCharges),
    rerollCharges: Number(account.rerollCharges),
    comboCounter: Number(account.comboCounter),
    maxCombo: Number(account.maxCombo),
    primaryProgress: Number(account.primaryProgress),
    secondaryProgress: Number(account.secondaryProgress),
    latchedStarSources: Number(account.latchedStarSources),
    streak: Number(account.streak),
    chargesEarned: Number(account.chargesEarned),
    currentTier: Number(account.currentTier),
    levelLinesCleared: Number(account.levelLinesCleared),
    moves: Number(account.moves),
    actionCounter: Number(account.actionCounter),
    vrfRequestCounter: Number(account.vrfRequestCounter),
    pendingVrfCounter: Number(account.pendingVrfCounter),
    score: Number(account.score),
    dailyScore: Number(account.dailyScore),
    objectiveTotal: BigInt(account.objectiveTotal.toString()),
    pressureScore: Number(account.pressureScore),
    grid: [...account.grid].map(Number),
    nextRow: account.hasNextRow ? [...account.nextRow].map(Number) : null,
    replayHash,
  });
  const token = { config, state };
  return {
    version: Number(account.version),
    owner: account.owner,
    rentPayer: account.rentPayer,
    runId: BigInt(account.runId.toString()),
    mode,
    dailyChallenge: account.dailyChallenge,
    mapId,
    level,
    rules,
    deadlineAt: Number(account.deadlineAt),
    dailyTheme,
    dailyPressure,
    ...projectCoreRun(token),
    lifecycle,
    finishReason,
    pendingVrfCounter: Number(account.pendingVrfCounter),
    vrfRequestCounter: Number(account.vrfRequestCounter),
    finishedAt: Number(account.finishedAt),
    bump: Number(account.bump),
  };
}

function chainCorePhase(lifecycle: string): CoreRunPhase {
  if (lifecycle === "playing") return "playing";
  if (lifecycle === "levelComplete") return "levelComplete";
  if (lifecycle === "finished") return "finished";
  if (
    lifecycle === "prepared" ||
    lifecycle === "delegated" ||
    lifecycle === "awaitingVrf"
  ) {
    return "awaitingVrf";
  }
  throw new Error("ActiveRun lifecycle is invalid");
}

function chainEndReason(
  lifecycle: string,
  finishReason: string | null,
): number {
  if (lifecycle === "levelComplete" && finishReason === null) return 1;
  if (lifecycle !== "finished") return finishReason === null ? 0 : 255;
  if (finishReason === null) return 2;
  if (finishReason === "abandon") return 3;
  if (finishReason === "deadline") return 4;
  return 255;
}

export async function compileWalletTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
}): Promise<VersionedTransaction> {
  const { transactionPlan } = args;
  const { blockhash } =
    await transactionPlan.connection.getLatestBlockhash("confirmed");
  const instructions = withPinnedWalletComputeBudget(
    transactionPlan.transaction.instructions,
  );
  const message = new TransactionMessage({
    payerKey: transactionPlan.feePayer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message();
  const requiredSignerKeys = message.staticAccountKeys.slice(
    0,
    message.header.numRequiredSignatures,
  );
  if (!requiredSignerKeys.some((key) => key.equals(args.wallet.publicKey))) {
    throw new Error(
      "The connected wallet is not a required transaction signer",
    );
  }
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
  requiredSignerKeys.forEach((key, index) => {
    if (
      !key.equals(args.wallet.publicKey) &&
      isZeroSignature(transaction.signatures[index])
    ) {
      throw new Error(
        `Missing partial signature for required signer ${key.toBase58()}`,
      );
    }
  });
  const unsignedSimulation =
    await transactionPlan.connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: false,
    });
  if (unsignedSimulation.value.err) {
    throw new Error(
      `Preflight failed before wallet signature for ${transactionPlan.label}: ${JSON.stringify(unsignedSimulation.value.err)}. The wallet was not prompted and no entry was charged.`,
    );
  }
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

function uniqueSigners(signers: readonly Signer[]): Signer[] {
  const seen = new Set<string>();
  return signers.filter(({ publicKey }) => {
    const address = publicKey.toBase58();
    if (seen.has(address)) return false;
    seen.add(address);
    return true;
  });
}

function isZeroSignature(signature: Uint8Array | undefined): boolean {
  return !signature || signature.every((byte) => byte === 0);
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
