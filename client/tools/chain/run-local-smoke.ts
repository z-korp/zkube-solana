/**
 * Dry-run-first local Solana + MagicBlock smoke, modeled after cycling-sim's chain flow.
 *
 * Start the stack and VRF oracle in separate terminals:
 *   pnpm chain:local:stack
 *   pnpm chain:local:vrf
 *
 * Preview only (default):
 *   pnpm chain:local:smoke
 *
 * Sending additionally requires the approval fingerprint printed by preview:
 *   ZKUBE_LOCAL_SEND=1 ZKUBE_LOCAL_APPROVAL=<fingerprint> pnpm chain:local:smoke
 *
 * This proves base setup, delegation, ER play/VRF, copyback, settlement, and cleanup.
 */

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BN from "bn.js";
import {
  ACCOUNT_SIZE,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createInitializeAccount3Instruction,
  createInitializeMintInstruction,
  unpackAccount,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";
import { validatePaymasterTransaction } from "../../src/server/paymaster";
import { ZKUBE_PROGRAM_ID } from "../../src/chain/constants";
import {
  buildInitializePlayerPlan,
  buildInitializeProtocolPlan,
  buildPublishCanonicalMapsPlan,
  buildPublishProgressCatalogPlan,
} from "../../src/chain/adminClient";
import {
  deriveCampaignProgressPda,
  derivePlayerProfilePda,
  deriveProtocolConfigPda,
  deriveRunAddresses,
  deriveSponsorAllowancePda,
  deriveTreasuryLedgerPda,
  deriveYieldPolicyPda,
} from "../../src/chain/pdas";
import {
  CANONICAL_ACHIEVEMENT_RULES,
  CANONICAL_QUEST_RULES,
} from "../../src/chain/progressCatalog";
import { waitForDelegation } from "../../src/chain/router";
import {
  buildApplyBonusPlan,
  buildCloseSettledRunPlan,
  buildCommitRunPlan,
  buildPlayMovePlan,
  buildRequestRowPlan,
  buildSealRunPlan,
  fetchActiveRun,
  zkubeProgram,
  type ActiveRunView,
  type TransactionPlan,
} from "../../src/chain/runPlan";
import {
  buildTopUpMagicActionEscrowInstruction,
  deriveMagicActionEscrowPda,
} from "../../src/chain/magicAction";
import {
  buildCreateSessionV2Instruction,
  deriveSessionTokenV2Pda,
} from "../../src/chain/sessionV2";
import { SessionWallet } from "../../src/chain/sessionWallet";
import { withSponsorshipInstruction } from "../../src/chain/sponsorshipClient";

const RPC = process.env.ZKUBE_LOCAL_RPC ?? "http://127.0.0.1:8899";
const ROUTER_RPC = process.env.ZKUBE_LOCAL_ROUTER_RPC ?? "http://127.0.0.1:6699";
const LOCAL_ER_RPC = process.env.ZKUBE_LOCAL_ER_RPC ?? "http://127.0.0.1:7799";
const LOCAL_ER_VALIDATOR = new PublicKey("mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev");
const LOCAL_DIR = resolve(process.cwd(), "../.localnet");
const PROOF_OUT = process.env.ZKUBE_LOCAL_PROOF_OUT
  ?? resolve(process.cwd(), "../artifacts/local-base-smoke.proof.json");
const PROGRAM_ARTIFACT = process.env.ZKUBE_LOCAL_PROGRAM_ARTIFACT
  ?? resolve(process.cwd(), "../target/deploy/solana.so");
const CONTENT_VERSION = 1;
const PROGRESS_VERSION = 1;
const AUTHORITY_AIRDROP_SOL = 20;
const PAYMASTER_AIRDROP_SOL = 10;

interface LocalBatch {
  id: string;
  plan: TransactionPlan;
  localSigners: Signer[];
  walletSigner: Keypair;
  sponsoredOwner?: Keypair;
}

interface ExecutedBatch {
  id: string;
  label: string;
  signature: string;
  feePayer: string;
  requiredSigners: string[];
  programIds: string[];
}

interface MagicLifecycleProof {
  routerEndpoint: string;
  erEndpoint: string;
  delegatedAfterMs: number;
  vrfRequests: number;
  playerActions: number;
  transactions: ExecutedBatch[];
  terminal: {
    lifecycle: string;
    score: number;
    moves: number;
    actionHashHex: string;
    vrfHashHex: string;
  };
  copybackAfterMs: number;
}

async function main(): Promise<void> {
  assertLocalRpc(RPC);
  const connection = new Connection(RPC, "confirmed");
  await assertLocalValidatorReady(connection);
  const programArtifactSha256 = createHash("sha256")
    .update(readFileSync(PROGRAM_ARTIFACT))
    .digest("hex");

  const authority = loadOrCreateKeypair("authority");
  const paymaster = loadOrCreateKeypair("paymaster");
  const player = loadOrCreateKeypair("player");
  const mint = loadOrCreateKeypair("mock-usdc-mint");
  const runSession = loadOrCreateKeypair("run-session");
  const flowConfig = loadOrCreateFlowConfig();
  const vaultKeypairs = Object.fromEntries(
    ["team", "paymaster", "treasury", "reward", "payment"].map((name) => [
      name,
      loadOrCreateKeypair(`${name}-vault`),
    ]),
  ) as Record<"team" | "paymaster" | "treasury" | "reward" | "payment", Keypair>;
  const authorityWallet = new SessionWallet(authority);
  const playerWallet = new SessionWallet(player);
  const mintRent = await connection.getMinimumBalanceForRentExemption(MINT_SIZE, "confirmed");
  const tokenAccountRent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE, "confirmed");
  const protocolAddress = deriveProtocolConfigPda();
  const vaultOwners = {
    team: authority.publicKey,
    paymaster: protocolAddress,
    treasury: protocolAddress,
    reward: protocolAddress,
    payment: protocolAddress,
  };
  const vaults = Object.fromEntries(Object.entries(vaultKeypairs).map(([name, keypair]) => [
    name,
    keypair.publicKey,
  ])) as Record<keyof typeof vaultKeypairs, PublicKey>;

  const tokenMint = tokenMintPlan({ connection, authority, mint, mintRent });
  const tokenVaults = tokenVaultsPlan({
    connection,
    authority,
    mint,
    tokenAccountRent,
    vaultOwners,
    vaultKeypairs,
  });
  const protocol = await buildInitializeProtocolPlan({
    connection,
    authority: authorityWallet,
    config: {
      paymaster: paymaster.publicKey,
      teamVault: vaults.team,
      paymasterVault: vaults.paymaster,
      treasuryVault: vaults.treasury,
      rewardVault: vaults.reward,
      paymasterCap: 100_000_000n,
      revenueRewardBps: 0,
      sponsorshipDailyTxLimit: 20,
      sponsorshipDailyPaidAttemptLimit: 3,
      paymentMint: mint.publicKey,
      paymentTokenProgram: TOKEN_PROGRAM_ID,
      paymentVault: vaults.payment,
      contentVersion: CONTENT_VERSION,
      governanceDelaySeconds: 3_600,
      governanceExecutionWindowSeconds: 86_400,
    },
  });
  const progress = await buildPublishProgressCatalogPlan({
    connection,
    authority: authorityWallet,
    progressVersion: PROGRESS_VERSION,
  });
  const mapPlans = await Promise.all(Array.from({ length: 10 }, async (_, index) =>
    buildPublishCanonicalMapsPlan({
      connection,
      authority: authorityWallet,
      contentVersion: CONTENT_VERSION,
      mapIds: [index + 1],
    })));
  const initializePlayer = await buildInitializePlayerPlan({
    connection,
    owner: playerWallet,
    payer: paymaster.publicKey,
  });
  const prepareRun = await buildLocalPrepareRunPlan({
    connection,
    playerWallet,
    paymaster,
    runSession,
    sessionValidUntil: flowConfig.sessionValidUntil,
  });
  const delegateRun = await buildLocalDelegateRunPlan({ connection, playerWallet, paymaster });
  const closeRun = await buildCloseSettledRunPlan({
    wallet: playerWallet,
    runId: 1n,
    addresses: deriveRunAddresses(player.publicKey, 1n),
    connection,
    paymaster: paymaster.publicKey,
  });
  const replaySettlement = await buildLocalReplaySettlementPlan({
    connection,
    playerWallet,
    paymaster,
  });
  const baseBatches: LocalBatch[] = [
    { id: "base-mock-usdc-mint", plan: tokenMint, localSigners: [mint], walletSigner: authority },
    {
      id: "base-segregated-vaults",
      plan: tokenVaults,
      localSigners: Object.values(vaultKeypairs),
      walletSigner: authority,
    },
    { id: "base-protocol", plan: protocol, localSigners: [], walletSigner: authority },
    { id: "base-progress-catalog", plan: progress, localSigners: [], walletSigner: authority },
    ...mapPlans.map((plan, index) => ({
      id: `base-map-${index + 1}`,
      plan,
      localSigners: [],
      walletSigner: authority,
    })),
    {
      id: "base-player-sponsored",
      plan: initializePlayer,
      localSigners: [],
      walletSigner: player,
      sponsoredOwner: player,
    },
    {
      id: "base-run-prepare-sponsored",
      plan: prepareRun,
      localSigners: [runSession],
      walletSigner: player,
      sponsoredOwner: player,
    },
    {
      id: "base-run-delegate-sponsored",
      plan: delegateRun,
      localSigners: [],
      walletSigner: player,
      sponsoredOwner: player,
    },
  ];
  const closeBatch: LocalBatch = {
    id: "base-run-close-sponsored",
    plan: closeRun,
    localSigners: [],
    walletSigner: player,
    sponsoredOwner: player,
  };
  const replayBatch: LocalBatch = {
    id: "base-settlement-idempotency-replay",
    plan: replaySettlement,
    localSigners: [],
    walletSigner: paymaster,
  };

  const preview = {
    cluster: RPC,
    router: ROUTER_RPC,
    ephemeralRollup: LOCAL_ER_RPC,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    programArtifactSha256,
    genesisLoadedProgram: true,
    funding: [
      { recipient: authority.publicKey.toBase58(), amountSol: AUTHORITY_AIRDROP_SOL, source: "local faucet" },
      { recipient: paymaster.publicKey.toBase58(), amountSol: PAYMASTER_AIRDROP_SOL, source: "local faucet" },
      { recipient: player.publicKey.toBase58(), amountSol: 0, source: "none" },
    ],
    mockUsdc: {
      mint: mint.publicKey.toBase58(),
      decimals: 6,
      mintedBaseUnits: "0",
      mintRentLamports: mintRent,
      tokenAccountRentLamports: tokenAccountRent,
      vaults: Object.fromEntries(Object.entries(vaults).map(([key, value]) => [key, value.toBase58()])),
    },
    policy: {
      paymaster: paymaster.publicKey.toBase58(),
      paymasterCapBaseUnits: "100000000",
      revenueRewardBps: 0,
      yieldStrategy: "unconfigured and deposits disabled",
      realizedYieldRouting: "100% rewards by default; timelocked governance can change it",
      sponsorshipDailyTxLimit: 20,
      sponsorshipDailyPaidAttemptLimit: 3,
      progressVersion: PROGRESS_VERSION,
      achievementCount: CANONICAL_ACHIEVEMENT_RULES.length,
      achievementXpTotal: CANONICAL_ACHIEVEMENT_RULES
        .reduce((sum, rule) => sum + rule.xpReward, 0),
      questRewards: CANONICAL_QUEST_RULES.map((rule) => rule.starReward),
      questThresholds: CANONICAL_QUEST_RULES.map((rule) => rule.threshold),
      dailyQuestRotation: "three of nine by UTC day modulo 3, plus finisher",
      sessionSigner: runSession.publicKey.toBase58(),
      sessionValidUntil: flowConfig.sessionValidUntil,
      delegatedValidator: LOCAL_ER_VALIDATOR.toBase58(),
    },
    batches: [...baseBatches, replayBatch, closeBatch].map(previewBatch),
    dynamicErPolicy: {
      sessionFeePayer: runSession.publicKey.toBase58(),
      commitFeePayer: player.publicKey.toBase58(),
      maxVrfRequests: 64,
      maxPlayerActions: 64,
      tokenTransfers: "none",
      lifecycle: ["router-resolved delegation", "fresh VRF rows", "valid moves/bonuses", "seal", "commit+undelegate", "copyback", "idempotent receipt", "cleanup"],
    },
    excluded: [
      "No USDC is minted or transferred",
      "No devnet or mainnet RPC is contacted",
    ],
  };
  const approvalFingerprint = createHash("sha256")
    .update(JSON.stringify(preview))
    .digest("hex")
    .slice(0, 16);
  printPreview(preview, approvalFingerprint);

  if (process.env.ZKUBE_LOCAL_SEND !== "1") {
    console.log("\nDry run only. No transaction was signed or sent.");
    return;
  }
  if (process.env.ZKUBE_LOCAL_APPROVAL !== approvalFingerprint) {
    throw new Error(`send blocked: set ZKUBE_LOCAL_APPROVAL=${approvalFingerprint} after approval`);
  }

  await fund(connection, authority.publicKey, AUTHORITY_AIRDROP_SOL);
  await fund(connection, paymaster.publicKey, PAYMASTER_AIRDROP_SOL);
  const authorityBefore = await connection.getBalance(authority.publicKey, "confirmed");
  const paymasterBefore = await connection.getBalance(paymaster.publicKey, "confirmed");
  const playerBefore = await connection.getBalance(player.publicKey, "confirmed");
  const executed: ExecutedBatch[] = [];
  for (const batch of baseBatches) {
    executed.push(batch.sponsoredOwner
      ? await executeSponsoredBatch(connection, batch, paymaster)
      : await executeWalletBatch(connection, batch));
  }
  const magic = await executeMagicBlockLifecycle({
    baseConnection: connection,
    player,
    session: runSession,
    sessionToken: deriveSessionTokenV2Pda({
      authority: player.publicKey,
      sessionSigner: runSession.publicKey,
    }).sessionToken,
    addresses: deriveRunAddresses(player.publicKey, 1n),
  });
  executed.push(await executeWalletBatch(connection, replayBatch));
  executed.push(await executeSponsoredBatch(connection, closeBatch, paymaster));
  const proof = await verifyAndBuildProof({
    connection,
    authority,
    paymaster,
    player,
    mint,
    vaults,
    approvalFingerprint,
    programArtifactSha256,
    executed,
    magic,
    before: { authority: authorityBefore, paymaster: paymasterBefore, player: playerBefore },
  });
  mkdirSync(dirname(PROOF_OUT), { recursive: true });
  writeFileSync(PROOF_OUT, JSON.stringify(proof, null, 2));
  console.log(`\nProof artifact: ${PROOF_OUT}`);
}

function tokenMintPlan(args: {
  connection: Connection;
  authority: Keypair;
  mint: Keypair;
  mintRent: number;
}): TransactionPlan {
  const instructions: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: args.authority.publicKey,
      newAccountPubkey: args.mint.publicKey,
      lamports: args.mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      args.mint.publicKey,
      6,
      args.authority.publicKey,
      args.authority.publicKey,
      TOKEN_PROGRAM_ID,
    ),
  ];
  return {
    layer: "solana-base",
    label: "Create zero-supply mock USDC mint",
    connection: args.connection,
    transaction: new Transaction().add(...instructions),
    feePayer: args.authority.publicKey,
    signers: [args.mint],
  };
}

function tokenVaultsPlan(args: {
  connection: Connection;
  authority: Keypair;
  mint: Keypair;
  tokenAccountRent: number;
  vaultOwners: Record<string, PublicKey>;
  vaultKeypairs: Record<string, Keypair>;
}): TransactionPlan {
  const instructions = Object.entries(args.vaultKeypairs).flatMap(([name, keypair]) => [
    SystemProgram.createAccount({
      fromPubkey: args.authority.publicKey,
      newAccountPubkey: keypair.publicKey,
      lamports: args.tokenAccountRent,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccount3Instruction(
      keypair.publicKey,
      args.mint.publicKey,
      args.vaultOwners[name],
      TOKEN_PROGRAM_ID,
    ),
  ]);
  return {
    layer: "solana-base",
    label: "Create five segregated mock-USDC vaults with program-owned internal custody",
    connection: args.connection,
    transaction: new Transaction().add(...instructions),
    feePayer: args.authority.publicKey,
    signers: Object.values(args.vaultKeypairs),
  };
}

async function buildLocalPrepareRunPlan(args: {
  connection: Connection;
  playerWallet: SessionWallet;
  paymaster: Keypair;
  runSession: Keypair;
  sessionValidUntil: number;
}): Promise<TransactionPlan> {
  const addresses = deriveRunAddresses(args.playerWallet.publicKey, 1n);
  const prepare = await zkubeProgram(args.connection, args.playerWallet).methods
    .prepareCampaignRunV1(new BN(1), 1, 1, args.runSession.publicKey)
    .accountsPartial({
      protocol: deriveProtocolConfigPda(),
      playerProfile: derivePlayerProfilePda(args.playerWallet.publicKey),
      campaignProgress: deriveCampaignProgressPda(args.playerWallet.publicKey),
      mapCatalog: PublicKey.findProgramAddressSync(
        [Buffer.from("map"), u32le(CONTENT_VERSION), Buffer.from([1])],
        ZKUBE_PROGRAM_ID,
      )[0],
      runShell: addresses.runShell,
      activeRun: addresses.activeRun,
      runReceipt: addresses.runReceipt,
      payer: args.paymaster.publicKey,
      owner: args.playerWallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const instructions = [
    buildCreateSessionV2Instruction({
      authority: args.playerWallet.publicKey,
      sessionSigner: args.runSession.publicKey,
      feePayer: args.paymaster.publicKey,
      topUp: false,
      validUntil: args.sessionValidUntil,
    }),
    buildTopUpMagicActionEscrowInstruction({
      authority: args.playerWallet.publicKey,
      payer: args.paymaster.publicKey,
    }),
    prepare,
  ];
  return {
    layer: "solana-base",
    label: "Authorize session, fund Magic Action escrow, and prepare Campaign map 1 level 1",
    connection: args.connection,
    transaction: new Transaction().add(...instructions),
    feePayer: args.paymaster.publicKey,
    signers: [args.runSession],
  };
}

async function buildLocalDelegateRunPlan(args: {
  connection: Connection;
  playerWallet: SessionWallet;
  paymaster: Keypair;
}): Promise<TransactionPlan> {
  const addresses = deriveRunAddresses(args.playerWallet.publicKey, 1n);
  const instruction = await zkubeProgram(args.connection, args.playerWallet).methods
    .delegateActiveRunV1()
    .accountsPartial({
      payer: args.paymaster.publicKey,
      owner: args.playerWallet.publicKey,
      runShell: addresses.runShell,
      pda: addresses.activeRun,
    })
    .remainingAccounts([{
      pubkey: LOCAL_ER_VALIDATOR,
      isSigner: false,
      isWritable: false,
    }])
    .instruction();
  return {
    layer: "solana-base",
    label: "Delegate ActiveRun to the local MagicBlock validator",
    connection: args.connection,
    transaction: new Transaction().add(instruction),
    feePayer: args.paymaster.publicKey,
    signers: [],
  };
}

async function buildLocalReplaySettlementPlan(args: {
  connection: Connection;
  playerWallet: SessionWallet;
  paymaster: Keypair;
}): Promise<TransactionPlan> {
  const owner = args.playerWallet.publicKey;
  const addresses = deriveRunAddresses(owner, 1n);
  const instruction = await zkubeProgram(args.connection, args.playerWallet).methods
    .consumeRunReceiptV1()
    .accountsPartial({
      activeRun: addresses.activeRun,
      runShell: addresses.runShell,
      runReceipt: addresses.runReceipt,
      playerProfile: derivePlayerProfilePda(owner),
      campaignProgress: deriveCampaignProgressPda(owner),
      owner,
      escrowAuth: owner,
      escrow: deriveMagicActionEscrowPda(owner),
    })
    .instruction();
  return {
    layer: "solana-base",
    label: "Replay settled receipt consumption to prove idempotency",
    connection: args.connection,
    transaction: new Transaction().add(instruction),
    feePayer: args.paymaster.publicKey,
    signers: [],
  };
}

async function executeMagicBlockLifecycle(args: {
  baseConnection: Connection;
  player: Keypair;
  session: Keypair;
  sessionToken: PublicKey;
  addresses: ReturnType<typeof deriveRunAddresses>;
}): Promise<MagicLifecycleProof> {
  const routeStartedAt = Date.now();
  const delegation = await waitForDelegation(args.addresses.activeRun, {
    endpoint: ROUTER_RPC,
    attempts: 120,
    delayMs: 500,
  });
  const delegatedAfterMs = Date.now() - routeStartedAt;
  assertLocalRpc(delegation.fqdn);
  const erConnection = new Connection(delegation.fqdn, "confirmed");
  const sessionWallet = new SessionWallet(args.session);
  const playerWallet = new SessionWallet(args.player);
  const transactions: ExecutedBatch[] = [];
  let vrfRequests = 0;
  let playerActions = 0;
  let active = await waitForActiveRun(erConnection, sessionWallet, args.addresses.activeRun);

  for (let iteration = 0; iteration < 128; iteration += 1) {
    active = await hydrateLocalRows({
      erConnection,
      sessionWallet,
      sessionToken: args.sessionToken,
      owner: args.player.publicKey,
      active,
      transactions,
      onRequest: () => { vrfRequests += 1; },
    });
    if (isTerminal(active.lifecycle)) break;
    if (active.lifecycle !== "playing") {
      throw new Error(`unexpected ER lifecycle ${active.lifecycle}`);
    }
    if (playerActions >= 64) throw new Error("local ER action bound exceeded");
    const move = findAdjacentMove(active.grid);
    const actionPlan = move
      ? await buildPlayMovePlan({
          owner: args.player.publicKey,
          sessionWallet,
          sessionToken: args.sessionToken,
          activeRun: args.addresses.activeRun,
          erConnection,
          expectedMove: active.moves,
          expectedAction: active.actionCounter,
          ...move,
        })
      : active.bonusCharges > 0
        ? await buildApplyBonusPlan({
            owner: args.player.publicKey,
            sessionWallet,
            sessionToken: args.sessionToken,
            activeRun: args.addresses.activeRun,
            erConnection,
            expectedAction: active.actionCounter,
            ...firstOccupiedCell(active.grid),
          })
        : null;
    if (!actionPlan) throw new Error("no valid move or bonus is available for the local smoke solver");
    transactions.push(await executeDynamicWalletPlan(
      `er-player-action-${playerActions + 1}`,
      actionPlan,
      args.session,
    ));
    playerActions += 1;
    active = await waitForActiveRun(erConnection, sessionWallet, args.addresses.activeRun);
  }
  if (!isTerminal(active.lifecycle)) throw new Error("local ER run did not reach a terminal state");
  const seal = await buildSealRunPlan({
    owner: args.player.publicKey,
    sessionWallet,
    sessionToken: args.sessionToken,
    activeRun: args.addresses.activeRun,
    erConnection,
  });
  transactions.push(await executeDynamicWalletPlan("er-seal-run", seal, args.session));
  const terminalAccount = await zkubeProgram(erConnection, sessionWallet).account.activeRun
    .fetch(args.addresses.activeRun);
  const terminal = {
    lifecycle: Object.keys(terminalAccount.lifecycle)[0] ?? "unknown",
    score: Number(terminalAccount.score),
    moves: Number(terminalAccount.moves),
    actionHashHex: Buffer.from(terminalAccount.actionHash).toString("hex"),
    vrfHashHex: Buffer.from(terminalAccount.vrfHash).toString("hex"),
  };
  const commit = await buildCommitRunPlan({
    owner: args.player.publicKey,
    payerWallet: playerWallet,
    addresses: args.addresses,
    erConnection,
  });
  transactions.push(await executeDynamicWalletPlan("er-commit-undelegate", commit, args.player));
  const copybackStartedAt = Date.now();
  const receipt = await waitForConsumedReceipt(
    args.baseConnection,
    playerWallet,
    args.addresses.runReceipt,
  );
  const receiptActionHash = Buffer.from(receipt.actionHash).toString("hex");
  const receiptVrfHash = Buffer.from(receipt.vrfHash).toString("hex");
  if (receiptActionHash !== terminal.actionHashHex || receiptVrfHash !== terminal.vrfHashHex) {
    throw new Error("copyback receipt commitment hash mismatch");
  }
  return {
    routerEndpoint: ROUTER_RPC,
    erEndpoint: delegation.fqdn,
    delegatedAfterMs,
    vrfRequests,
    playerActions,
    transactions,
    terminal,
    copybackAfterMs: Date.now() - copybackStartedAt,
  };
}

async function hydrateLocalRows(args: {
  erConnection: Connection;
  sessionWallet: SessionWallet;
  sessionToken: PublicKey;
  owner: PublicKey;
  active: ActiveRunView;
  transactions: ExecutedBatch[];
  onRequest: () => void;
}): Promise<ActiveRunView> {
  let active = args.active;
  for (let attempt = 0; attempt < 64; attempt += 1) {
    if (active.lifecycle === "playing" || isTerminal(active.lifecycle)) return active;
    if (active.lifecycle === "awaitingVrf" && active.pendingVrfCounter > 0) {
      active = await waitForVrfFulfillment(
        args.erConnection,
        args.sessionWallet,
        active,
      );
      continue;
    }
    if (
      (active.lifecycle === "delegated" || active.lifecycle === "awaitingVrf")
      && active.pendingVrfCounter === 0
    ) {
      const clientSeed = createHash("sha256")
        .update("zkube-local-vrf")
        .update(active.runId.toString())
        .update(String(active.actionCounter))
        .update(String(attempt))
        .digest();
      const request = await buildRequestRowPlan({
        owner: args.owner,
        sessionWallet: args.sessionWallet,
        sessionToken: args.sessionToken,
        activeRun: activeAddress(active),
        erConnection: args.erConnection,
        clientSeed,
      });
      args.transactions.push(await executeDynamicWalletPlan(
        `er-vrf-request-${active.pendingVrfCounter + attempt + 1}`,
        request,
        args.sessionWallet.keypair,
      ));
      args.onRequest();
      active = await waitForActiveRun(
        args.erConnection,
        args.sessionWallet,
        activeAddress(active),
      );
      continue;
    }
    throw new Error(`cannot hydrate ER lifecycle ${active.lifecycle}`);
  }
  throw new Error("local VRF hydration exceeded 64 requests");
}

async function waitForVrfFulfillment(
  connection: Connection,
  wallet: SessionWallet,
  initial: ActiveRunView,
): Promise<ActiveRunView> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const active = await waitForActiveRun(connection, wallet, activeAddress(initial));
    if (active.pendingVrfCounter === 0) return active;
    await delay(500);
  }
  throw new Error("local VRF oracle did not fulfill within 30 seconds; run pnpm chain:local:vrf");
}

async function waitForActiveRun(
  connection: Connection,
  wallet: SessionWallet,
  address: PublicKey,
): Promise<ActiveRunView> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const active = await fetchActiveRun(connection, wallet, address);
    if (active) return active;
    await delay(500);
  }
  throw new Error(`ActiveRun ${address.toBase58()} is unavailable on the ER`);
}

async function waitForConsumedReceipt(
  connection: Connection,
  wallet: SessionWallet,
  address: PublicKey,
) {
  const program = zkubeProgram(connection, wallet);
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    const receipt = await program.account.runReceipt.fetchNullable(address);
    if (receipt?.consumed) return receipt;
    await delay(500);
  }
  throw new Error(`copyback receipt ${address.toBase58()} was not consumed within 90 seconds`);
}

async function executeDynamicWalletPlan(
  id: string,
  plan: TransactionPlan,
  signer: Keypair,
): Promise<ExecutedBatch> {
  assertLocalRpc(plan.connection.rpcEndpoint);
  let lastError = "unknown ER execution error";
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const latest = await plan.connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: plan.feePayer,
      recentBlockhash: latest.blockhash,
      instructions: plan.transaction.instructions,
    }).compileToV0Message());
    transaction.sign([signer]);
    const simulation = await plan.connection.simulateTransaction(transaction, {
      sigVerify: true,
      replaceRecentBlockhash: false,
    });
    if (simulation.value.err) {
      lastError = `simulation failed: ${JSON.stringify(simulation.value.err)}`;
      if (attempt < 5) {
        await delay(attempt * 500);
        continue;
      }
      break;
    }
    try {
      const signature = await plan.connection.sendRawTransaction(transaction.serialize(), {
        skipPreflight: false,
        maxRetries: 5,
      });
      await plan.connection.confirmTransaction({ signature, ...latest }, "confirmed");
      console.log(`✓ ${id} ${signature}`);
      return {
        id,
        label: plan.label,
        signature,
        feePayer: plan.feePayer.toBase58(),
        requiredSigners: [signer.publicKey.toBase58()],
        programIds: unique(plan.transaction.instructions.map((instruction) => instruction.programId.toBase58())),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 5 && /cloner|pending request owner|blockhash/i.test(lastError)) {
        await delay(attempt * 500);
        continue;
      }
      break;
    }
  }
  throw new Error(`${id} failed after bounded ER retries: ${lastError}`);
}

function findAdjacentMove(grid: number[]): { row: number; start: number; destination: number } | null {
  for (let row = 0; row < 10; row += 1) {
    let column = 0;
    while (column < 8) {
      const width = grid[row * 8 + column] ?? 0;
      if (width === 0) {
        column += 1;
        continue;
      }
      if (column > 0 && grid[row * 8 + column - 1] === 0) {
        return { row, start: column, destination: column - 1 };
      }
      if (column + width < 8 && grid[row * 8 + column + width] === 0) {
        return { row, start: column, destination: column + 1 };
      }
      column += width;
    }
  }
  return null;
}

function firstOccupiedCell(grid: number[]): { row: number; column: number } {
  const index = grid.findIndex((value) => value > 0);
  if (index < 0) throw new Error("cannot apply a bonus to an empty grid");
  return { row: Math.floor(index / 8), column: index % 8 };
}

function activeAddress(active: ActiveRunView): PublicKey {
  return deriveRunAddresses(active.owner, active.runId).activeRun;
}

function isTerminal(lifecycle: string): boolean {
  return lifecycle === "levelComplete" || lifecycle === "finished";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewBatch(batch: LocalBatch) {
  const instructions = batch.sponsoredOwner
    ? withSponsorshipInstruction({
        owner: batch.sponsoredOwner.publicKey,
        paymaster: batch.plan.feePayer,
        instructions: batch.plan.transaction.instructions,
      })
    : batch.plan.transaction.instructions;
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: batch.plan.feePayer,
    recentBlockhash: "11111111111111111111111111111111",
    instructions,
  }).compileToV0Message());
  const serializedBytes = transaction.serialize().length;
  if (serializedBytes > 1_232) {
    throw new Error(`${batch.id} is ${serializedBytes} bytes and exceeds Solana's transaction limit`);
  }
  return {
    id: batch.id,
    label: batch.plan.label,
    layer: batch.plan.layer,
    feePayer: batch.plan.feePayer.toBase58(),
    requiredSigners: unique([
      batch.plan.feePayer.toBase58(),
      ...instructions.flatMap((instruction) => instruction.keys
        .filter((key) => key.isSigner)
        .map((key) => key.pubkey.toBase58())),
    ]),
    programIds: unique(instructions.map((instruction) => instruction.programId.toBase58())),
    instructionDataSha256: instructions.map((instruction) => createHash("sha256")
      .update(instruction.data)
      .digest("hex")),
    serializedBytes,
    writableAccounts: unique(instructions.flatMap((instruction) => instruction.keys
      .filter((key) => key.isWritable)
      .map((key) => key.pubkey.toBase58()))),
  };
}

async function executeWalletBatch(connection: Connection, batch: LocalBatch): Promise<ExecutedBatch> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: batch.plan.feePayer,
    recentBlockhash: latest.blockhash,
    instructions: batch.plan.transaction.instructions,
  }).compileToV0Message());
  transaction.sign([...batch.localSigners, batch.walletSigner]);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: true,
    replaceRecentBlockhash: false,
  });
  if (simulation.value.err) throw new Error(`${batch.id} simulation failed: ${JSON.stringify(simulation.value.err)}`);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  console.log(`✓ ${batch.id} ${signature}`);
  return executedBatch(batch, signature, previewBatch(batch));
}

async function executeSponsoredBatch(
  connection: Connection,
  batch: LocalBatch,
  paymaster: Keypair,
): Promise<ExecutedBatch> {
  const owner = batch.sponsoredOwner;
  if (!owner) throw new Error("missing sponsored owner");
  const latest = await connection.getLatestBlockhash("confirmed");
  const instructions = withSponsorshipInstruction({
    owner: owner.publicKey,
    paymaster: paymaster.publicKey,
    instructions: batch.plan.transaction.instructions,
  });
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: paymaster.publicKey,
    recentBlockhash: latest.blockhash,
    instructions,
  }).compileToV0Message());
  transaction.sign([...batch.localSigners, owner, paymaster]);
  const rejection = validatePaymasterTransaction(transaction, paymaster.publicKey);
  if (rejection) throw new Error(`${batch.id} paymaster policy rejected: ${rejection}`);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: true,
    replaceRecentBlockhash: false,
  });
  if (simulation.value.err) throw new Error(`${batch.id} simulation failed: ${JSON.stringify(simulation.value.err)}`);
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 5,
  });
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  console.log(`✓ ${batch.id} ${signature}`);
  return executedBatch(batch, signature, previewBatch(batch));
}

function executedBatch(batch: LocalBatch, signature: string, preview: ReturnType<typeof previewBatch>): ExecutedBatch {
  return {
    id: batch.id,
    label: batch.plan.label,
    signature,
    feePayer: preview.feePayer,
    requiredSigners: preview.requiredSigners,
    programIds: preview.programIds,
  };
}

async function verifyAndBuildProof(args: {
  connection: Connection;
  authority: Keypair;
  paymaster: Keypair;
  player: Keypair;
  mint: Keypair;
  vaults: Record<string, PublicKey>;
  approvalFingerprint: string;
  programArtifactSha256: string;
  executed: ExecutedBatch[];
  magic: MagicLifecycleProof;
  before: { authority: number; paymaster: number; player: number };
}) {
  const wallet = new SessionWallet(args.player);
  const program = zkubeProgram(args.connection, wallet);
  const addresses = deriveRunAddresses(args.player.publicKey, 1n);
  const [protocol, ledger, yieldPolicy, player, campaign, allowance, shell, activeInfo, receipt] = await Promise.all([
    program.account.protocolConfig.fetch(deriveProtocolConfigPda()),
    program.account.treasuryLedger.fetch(deriveTreasuryLedgerPda()),
    program.account.yieldStrategyPolicy.fetch(deriveYieldPolicyPda()),
    program.account.playerProfile.fetch(derivePlayerProfilePda(args.player.publicKey)),
    program.account.campaignProgress.fetch(deriveCampaignProgressPda(args.player.publicKey)),
    program.account.sponsorAllowance.fetch(deriveSponsorAllowancePda(args.player.publicKey)),
    program.account.runShell.fetch(addresses.runShell),
    args.connection.getAccountInfo(addresses.activeRun, "confirmed"),
    program.account.runReceipt.fetch(addresses.runReceipt),
  ]);
  if (
    !protocol.yieldPolicy.equals(deriveYieldPolicyPda())
    || !yieldPolicy.protocol.equals(deriveProtocolConfigPda())
    || yieldPolicy.depositsEnabled
    || yieldPolicy.emergencyExit
    || Number(yieldPolicy.yieldRewardBps) !== 10_000
    || Number(yieldPolicy.strategyVersion) !== 0
    || ledger.lifetimeStrategyDeposited.toString() !== "0"
    || ledger.lifetimeStrategyPrincipalRepaid.toString() !== "0"
    || ledger.strategyPrincipal.toString() !== "0"
    || ledger.realizedYield.toString() !== "0"
    || ledger.yieldAllocatedToRewards.toString() !== "0"
    || ledger.yieldRetainedInTreasury.toString() !== "0"
    || ledger.realizedStrategyLosses.toString() !== "0"
  ) throw new Error("local yield policy is not safely disabled");
  const vaultEntries = Object.entries(args.vaults);
  const vaultInfos = await args.connection.getMultipleAccountsInfo(
    vaultEntries.map(([, address]) => address),
    "confirmed",
  );
  const decodedVaultOwners = Object.fromEntries(vaultEntries.map(([name, address], index) => {
    const info = vaultInfos[index];
    if (!info) throw new Error(`verified vault ${name} is missing`);
    const account = unpackAccount(address, info, TOKEN_PROGRAM_ID);
    if (!account.mint.equals(args.mint.publicKey)) throw new Error(`verified vault ${name} mint mismatch`);
    const expectedOwner = name === "team" ? args.authority.publicKey : deriveProtocolConfigPda();
    if (!account.owner.equals(expectedOwner)) throw new Error(`verified vault ${name} custody mismatch`);
    return [name, account.owner.toBase58()];
  }));
  const after = {
    authority: await args.connection.getBalance(args.authority.publicKey, "confirmed"),
    paymaster: await args.connection.getBalance(args.paymaster.publicKey, "confirmed"),
    player: await args.connection.getBalance(args.player.publicKey, "confirmed"),
  };
  return {
    generatedAtUnix: Math.floor(Date.now() / 1_000),
    cluster: RPC,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    programArtifactSha256: args.programArtifactSha256,
    approvalFingerprint: args.approvalFingerprint,
    transactions: args.executed,
    accounts: {
      protocol: deriveProtocolConfigPda().toBase58(),
      treasuryLedger: deriveTreasuryLedgerPda().toBase58(),
      yieldPolicy: deriveYieldPolicyPda().toBase58(),
      playerProfile: derivePlayerProfilePda(args.player.publicKey).toBase58(),
      campaignProgress: deriveCampaignProgressPda(args.player.publicKey).toBase58(),
      sponsorAllowance: deriveSponsorAllowancePda(args.player.publicKey).toBase58(),
      runShell: addresses.runShell.toBase58(),
      activeRun: addresses.activeRun.toBase58(),
      runReceipt: addresses.runReceipt.toBase58(),
      mint: args.mint.publicKey.toBase58(),
      vaults: Object.fromEntries(Object.entries(args.vaults).map(([key, value]) => [key, value.toBase58()])),
    },
    state: {
      protocolPaymaster: protocol.paymaster.toBase58(),
      treasuryLedgerProtocol: ledger.protocol.toBase58(),
      yieldPolicyProtocol: yieldPolicy.protocol.toBase58(),
      yieldStrategyVersion: Number(yieldPolicy.strategyVersion),
      yieldDepositsEnabled: Boolean(yieldPolicy.depositsEnabled),
      yieldEmergencyExit: Boolean(yieldPolicy.emergencyExit),
      yieldRewardBps: Number(yieldPolicy.yieldRewardBps),
      vaultOwners: decodedVaultOwners,
      progressVersion: Number(protocol.progressVersion),
      playerOwner: player.owner.toBase58(),
      unlockedMaps: Number(campaign.unlockedMaps),
      sponsoredTransactions: Number(allowance.sponsoredTransactions),
      sponsoredPaidAttempts: Number(allowance.paidDailyAttempts),
      lifetimeRakeReceived: ledger.lifetimeRakeReceived.toString(),
      lifetimeMapSales: ledger.lifetimeMapSales.toString(),
      realizedYield: ledger.realizedYield.toString(),
      yieldAllocatedToRewards: ledger.yieldAllocatedToRewards.toString(),
      yieldRetainedInTreasury: ledger.yieldRetainedInTreasury.toString(),
      lifetimeStrategyDeposited: ledger.lifetimeStrategyDeposited.toString(),
      lifetimeStrategyPrincipalRepaid: ledger.lifetimeStrategyPrincipalRepaid.toString(),
      strategyPrincipal: ledger.strategyPrincipal.toString(),
      realizedStrategyLosses: ledger.realizedStrategyLosses.toString(),
      runId: shell.runId.toString(),
      runOwner: shell.owner.toBase58(),
      activeRunClosed: activeInfo === null,
      receiptOwner: receipt.owner.toBase58(),
    },
    spendLamports: {
      authority: args.before.authority - after.authority,
      paymaster: args.before.paymaster - after.paymaster,
      player: args.before.player - after.player,
    },
    magicBlock: args.magic,
  };
}

async function fund(connection: Connection, recipient: PublicKey, sol: number): Promise<void> {
  const signature = await connection.requestAirdrop(recipient, sol * 1_000_000_000);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

function loadOrCreateKeypair(name: string): Keypair {
  const path = resolve(LOCAL_DIR, `${name}.json`);
  mkdirSync(dirname(path), { recursive: true });
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8")) as number[]));
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
    const keypair = Keypair.generate();
    writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
    chmodSync(path, 0o600);
    return keypair;
  }
}

function loadOrCreateFlowConfig(): { sessionValidUntil: number } {
  const path = resolve(LOCAL_DIR, "flow.json");
  mkdirSync(dirname(path), { recursive: true });
  const now = Math.floor(Date.now() / 1_000);
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { sessionValidUntil?: unknown };
    if (
      typeof value.sessionValidUntil === "number"
      && Number.isSafeInteger(value.sessionValidUntil)
      && value.sessionValidUntil > now + 3_600
      && value.sessionValidUntil <= now + 7 * 86_400
    ) return { sessionValidUntil: value.sessionValidUntil };
  } catch (error) {
    if (error instanceof SyntaxError) throw error;
  }
  const config = { sessionValidUntil: now + 6 * 86_400 };
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: 0o600 });
  chmodSync(path, 0o600);
  return config;
}

async function assertLocalValidatorReady(connection: Connection): Promise<void> {
  try {
    await connection.getGenesisHash();
  } catch {
    throw new Error(`local validator is unavailable at ${RPC}; run pnpm chain:local:validator first`);
  }
  const program = await connection.getAccountInfo(ZKUBE_PROGRAM_ID, "confirmed");
  if (!program?.executable) {
    throw new Error(`zKube program ${ZKUBE_PROGRAM_ID.toBase58()} is not genesis-loaded on the local validator`);
  }
}

function assertLocalRpc(endpoint: string): void {
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("local smoke accepts only an explicit localhost HTTP RPC");
  }
}

function printPreview(preview: unknown, approvalFingerprint: string): void {
  console.log("zKube local base-layer smoke preview");
  console.log(JSON.stringify(preview, null, 2));
  console.log(`\nApproval fingerprint: ${approvalFingerprint}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function u32le(value: number): Buffer {
  const output = Buffer.alloc(4);
  output.writeUInt32LE(value);
  return output;
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
