import {
  AnchorProvider,
  Program as AnchorProgram,
  type Program,
} from "@anchor-lang/core";
import BN from "bn.js";
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
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
  SOLANA_ENDPOINT,
  ZKUBE_PROGRAM_ID,
  getDelegationRecord,
} from "./constants.js";
import {
  buildTopUpMagicActionEscrowInstruction,
  deriveMagicActionEscrowPda,
} from "./magicAction.js";
import type { PaymasterClient } from "./paymasterClient.js";
import { saveReusableSession, saveRunSession } from "./runSessionStore.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  deriveCampaignProgressPda,
  deriveDailyLeaderboardPda,
  deriveDailyPlayerPda,
  deriveMapCatalogPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveWeeklyStipendPda,
  type RunAddresses,
} from "./pdas.js";
import { getClosestValidator, waitForDelegation } from "./router.js";
import {
  buildCreateSessionV2Instruction,
  deriveSessionTokenV2Pda,
} from "./sessionV2.js";
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

export interface RotatedSessionPlan {
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
  session: Keypair;
  mapId: number;
  level: number;
  connection?: Connection;
  nowUnix?: number;
  paymaster?: PublicKey;
  /** Live expiry of a REUSED session token (marker correctness). */
  sessionValidUntil?: number;
}): Promise<PreparedRunPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const owner = args.wallet.publicKey;
  const payer = args.paymaster ?? owner;
  const profileAddress = derivePlayerProfilePda(owner);
  const campaignAddress = deriveCampaignProgressPda(owner);
  const profile =
    await program.account.playerProfile.fetchNullable(profileAddress);
  const protocolAddress = deriveProtocolConfigPda();
  const protocol = await program.account.protocolConfig.fetch(protocolAddress);
  const runId = profile ? BigInt(profile.nextRunId.toString()) : 1n;
  const addresses = deriveRunAddresses(owner, runId);
  const mapCatalog = deriveMapCatalogPda(
    Number(protocol.contentVersion),
    args.mapId,
  );
  const { sessionToken } = deriveSessionTokenV2Pda({
    authority: owner,
    sessionSigner: args.session.publicKey,
  });
  const instructions: TransactionInstruction[] = [];
  let sessionValidUntil =
    (args.nowUnix ?? Math.floor(Date.now() / 1_000)) + 6 * 24 * 60 * 60;
  // The session keypair only signs the createSessionV2 instruction. A reused
  // session skips that instruction, so it must NOT be listed as a signer
  // (web3.js rejects signing with a non-required key).
  let sessionCreated = false;

  if (!profile) {
    instructions.push(
      await program.methods
        .initializePlayer()
        .accountsPartial({
          playerProfile: profileAddress,
          campaignProgress: campaignAddress,
          payer,
          owner,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  if (!(await connection.getAccountInfo(sessionToken, "confirmed"))) {
    instructions.push(
      buildCreateSessionV2Instruction({
        authority: owner,
        sessionSigner: args.session.publicKey,
        feePayer: payer,
        topUp: false,
        validUntil: sessionValidUntil,
      }),
    );
    sessionCreated = true;
  } else if (args.sessionValidUntil) {
    // Reused session: the marker must reflect the live token's real expiry,
    // not a fresh six-day claim.
    sessionValidUntil = args.sessionValidUntil;
  }
  instructions.push(
    buildTopUpMagicActionEscrowInstruction({ authority: owner, payer }),
  );
  instructions.push(
    await program.methods
      .prepareCampaignRun(
        new BN(runId.toString()),
        args.mapId,
        args.level,
        args.session.publicKey,
      )
      .accountsPartial({
        protocol: protocolAddress,
        playerProfile: profileAddress,
        campaignProgress: campaignAddress,
        mapCatalog,
        runShell: addresses.runShell,
        activeRun: addresses.activeRun,
        runReceipt: addresses.runReceipt,
        payer,
        owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  );

  return {
    runId,
    addresses,
    sessionToken,
    sessionValidUntil,
    transactionPlan: plan(
      "solana-base",
      "Prepare campaign run",
      connection,
      payer,
      instructions,
      sessionCreated ? [args.session] : [],
    ),
  };
}

export async function buildDelegateRunPlan(args: {
  wallet: WalletLike;
  addresses: RunAddresses;
  connection?: Connection;
  paymaster?: PublicKey;
}): Promise<TransactionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const validator = await getClosestValidator();
  const payer = args.paymaster ?? args.wallet.publicKey;
  const instruction = await program.methods
    .delegateActiveRun()
    .accountsPartial({
      payer,
      owner: args.wallet.publicKey,
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
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const instruction = await program.methods
    .playMove(
      args.expectedAction,
      args.expectedMove,
      args.row,
      args.start,
      args.destination,
    )
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor: args.sessionWallet.publicKey,
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
}): Promise<TransactionPlan> {
  const program = zkubeProgram(args.erConnection, args.sessionWallet);
  const instruction = await program.methods
    .applyBonus(args.expectedAction, args.row, args.column)
    .accountsPartial({
      activeRun: args.activeRun,
      ownerAuthority: args.owner,
      sessionToken: args.sessionToken,
      actor: args.sessionWallet.publicKey,
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
    "Commit run and settle receipt",
    args.erConnection,
    args.payerWallet.publicKey,
    [instruction],
  );
}

export async function buildCloseSettledRunPlan(args: {
  wallet: WalletLike;
  runId: bigint;
  addresses: RunAddresses;
  connection?: Connection;
  /** Fee payer AND rent recipient: cleanup returns every run rent to the
   *  protocol paymaster that fronted it at prepare. */
  paymaster: PublicKey;
}): Promise<TransactionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const program = zkubeProgram(connection, args.wallet);
  const instruction = await program.methods
    .closeSettledActiveRun(new BN(args.runId.toString()))
    .accountsPartial({
      owner: args.wallet.publicKey,
      protocol: deriveProtocolConfigPda(),
      rentRecipient: args.paymaster,
      runShell: args.addresses.runShell,
      runReceipt: args.addresses.runReceipt,
      activeRun: args.addresses.activeRun,
    })
    .instruction();
  return plan(
    "solana-base",
    "Close settled active run",
    connection,
    args.paymaster,
    [instruction],
  );
}

/**
 * Base-layer settlement completion in ONE atomic transaction: consume the
 * receipt (when the Magic Action stalled) and close the ActiveRun for rent.
 * Receipt consumption needs no program-level signer (`owner` is unchecked;
 * every account is a validated PDA); the bundled close carries the owner
 * signature the sponsored-shape policy requires. This is both the tail of
 * the normal settle pipeline and the recovery path for wedged runs.
 */
export async function buildFinalizeRunPlan(args: {
  wallet: WalletLike;
  owner: PublicKey;
  runId: bigint;
  addresses: RunAddresses;
  mode: "campaign" | "daily";
  dailyChallenge?: PublicKey | null;
  dailyVersion?: 1 | 2;
  receiptConsumed: boolean;
  /** Owner-signed abandon prepended for a stuck non-terminal base run. */
  abandonFirst?: boolean;
  connection?: Connection;
  /** Fee payer AND rent recipient for the bundled close (protocol paymaster). */
  paymaster: PublicKey;
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
          sessionToken: null,
          actor: args.owner,
        })
        .instruction(),
    );
  }
  if (!args.receiptConsumed) {
    const escrowMetas = {
      // #[action]-injected metas: the Magic Action escrow of the run owner.
      escrowAuth: args.owner,
      escrow: deriveMagicActionEscrowPda(args.owner),
    };
    if (args.mode === "daily") {
      if (!args.dailyChallenge) {
        throw new Error("Daily settlement requires the challenge address");
      }
      const dailyVersion = args.dailyVersion ?? 1;
      const accounts = {
        activeRun: args.addresses.activeRun,
        runShell: args.addresses.runShell,
        runReceipt: args.addresses.runReceipt,
        playerProfile: derivePlayerProfilePda(args.owner),
        dailyChallenge: args.dailyChallenge,
        dailyPlayer:
          dailyVersion === 2
            ? deriveDailyPlayerPda(args.dailyChallenge, args.owner)
            : deriveDailyPlayerPda(args.dailyChallenge, args.owner),
        leaderboard:
          dailyVersion === 2
            ? deriveDailyLeaderboardPda(args.dailyChallenge)
            : deriveDailyLeaderboardPda(args.dailyChallenge),
        ...(dailyVersion === 2
          ? { weeklyStipend: deriveWeeklyStipendPda(args.owner) }
          : {}),
        owner: args.owner,
        ...escrowMetas,
      };
      instructions.push(
        dailyVersion === 2
          ? await program.methods
              .consumeDailyReceipt()
              .accountsPartial(accounts)
              .instruction()
          : await program.methods
              .consumeDailyReceipt()
              .accountsPartial(accounts)
              .instruction(),
      );
    } else {
      instructions.push(
        await program.methods
          .consumeRunReceipt()
          .accountsPartial({
            activeRun: args.addresses.activeRun,
            runShell: args.addresses.runShell,
            runReceipt: args.addresses.runReceipt,
            playerProfile: derivePlayerProfilePda(args.owner),
            campaignProgress: deriveCampaignProgressPda(args.owner),
            owner: args.owner,
            ...escrowMetas,
          })
          .instruction(),
      );
    }
  }
  instructions.push(
    await program.methods
      .closeSettledActiveRun(new BN(args.runId.toString()))
      .accountsPartial({
        owner: args.owner,
        protocol: deriveProtocolConfigPda(),
        rentRecipient: args.paymaster,
        runShell: args.addresses.runShell,
        runReceipt: args.addresses.runReceipt,
        activeRun: args.addresses.activeRun,
      })
      .instruction(),
  );
  return plan(
    "solana-base",
    "Finalize run settlement",
    connection,
    args.paymaster,
    instructions,
  );
}

export async function buildRotateRunShellSessionPlan(args: {
  wallet: WalletLike;
  runId: bigint;
  addresses: RunAddresses;
  newSession: Keypair;
  paymaster: PublicKey;
  connection?: Connection;
  nowUnix?: number;
}): Promise<RotatedSessionPlan> {
  const connection =
    args.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const owner = args.wallet.publicKey;
  const sessionValidUntil =
    (args.nowUnix ?? Math.floor(Date.now() / 1_000)) + 6 * 24 * 60 * 60;
  const sessionToken = deriveSessionTokenV2Pda({
    authority: owner,
    sessionSigner: args.newSession.publicKey,
  }).sessionToken;
  const program = zkubeProgram(connection, args.wallet);
  const rotate = await program.methods
    .rotateRunShellAuthority(
      new BN(args.runId.toString()),
      args.newSession.publicKey,
    )
    .accountsPartial({
      runShell: args.addresses.runShell,
      owner,
    })
    .instruction();
  return {
    sessionToken,
    sessionValidUntil,
    transactionPlan: plan(
      "solana-base",
      "Authorize replacement run session",
      connection,
      args.paymaster,
      [
        buildCreateSessionV2Instruction({
          authority: owner,
          sessionSigner: args.newSession.publicKey,
          feePayer: args.paymaster,
          topUp: false,
          validUntil: sessionValidUntil,
        }),
        rotate,
      ],
      [args.newSession],
    ),
  };
}

export async function buildRotateActiveRunSessionPlan(args: {
  wallet: WalletLike;
  activeRun: PublicKey;
  newSession: PublicKey;
  erConnection: Connection;
}): Promise<TransactionPlan> {
  const instruction = await zkubeProgram(args.erConnection, args.wallet)
    .methods.rotateActiveRunAuthority(args.newSession)
    .accountsPartial({
      activeRun: args.activeRun,
      owner: args.wallet.publicKey,
    })
    .instruction();
  return plan(
    "magicblock-er",
    "Bind replacement session to active run",
    args.erConnection,
    args.wallet.publicKey,
    [instruction],
  );
}

export async function fetchActiveRun(
  connection: Connection,
  wallet: WalletLike,
  activeRun: PublicKey,
): Promise<ActiveRunView | null> {
  const account = await zkubeProgram(
    connection,
    wallet,
  ).account.activeRun.fetchNullable(activeRun);
  if (!account) return null;
  return mapActiveRunAccount(account);
}

type DecodedActiveRunAccount = Awaited<
  ReturnType<ReturnType<typeof zkubeProgram>["account"]["activeRun"]["fetch"]>
>;

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

export async function compileSponsoredTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
  paymaster: PublicKey;
}): Promise<VersionedTransaction> {
  const { transactionPlan } = args;
  if (transactionPlan.layer !== "solana-base") {
    throw new Error("Only Solana base-layer plans can use the paymaster");
  }
  if (!transactionPlan.feePayer.equals(args.paymaster)) {
    throw new Error("Plan was not built with the selected paymaster");
  }
  const { blockhash } =
    await transactionPlan.connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: args.paymaster,
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

export async function submitSponsoredTransactionPlan(args: {
  transactionPlan: TransactionPlan;
  wallet: WalletLike;
  paymaster: PaymasterClient;
}): Promise<string> {
  const transaction = await compileSponsoredTransactionPlan({
    transactionPlan: args.transactionPlan,
    wallet: args.wallet,
    paymaster: args.paymaster.pubkey,
  });
  return args.paymaster.submit(transaction.serialize());
}

export async function submitPreparedRunPlan(args: {
  preparedRun: PreparedRunPlan;
  wallet: WalletLike;
  paymaster: PaymasterClient;
  session: Keypair;
  mode?: "campaign" | "daily";
  dailyVersion?: 1 | 2;
}): Promise<string> {
  const signature = await submitSponsoredTransactionPlan({
    transactionPlan: args.preparedRun.transactionPlan,
    wallet: args.wallet,
    paymaster: args.paymaster,
  });
  await args.preparedRun.transactionPlan.connection.confirmTransaction(
    signature,
    "confirmed",
  );
  saveRunSession({
    owner: args.wallet.publicKey,
    runId: args.preparedRun.runId,
    mode: args.mode ?? "campaign",
    dailyVersion: args.dailyVersion ?? 1,
    session: args.session,
    sessionToken: args.preparedRun.sessionToken,
    addresses: args.preparedRun.addresses,
    validUntil: args.preparedRun.sessionValidUntil,
    createdAt: Math.floor(Date.now() / 1_000),
  });
  // The session identity outlives this run: later runs reuse it (and its
  // on-chain token) instead of paying new session rent.
  saveReusableSession(
    args.wallet.publicKey,
    args.session,
    args.preparedRun.sessionValidUntil,
  );
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
