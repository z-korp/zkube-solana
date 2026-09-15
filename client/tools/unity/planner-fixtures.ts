import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { BorshAccountsCoder, BorshCoder, convertIdlToCamelCase, type IdlType } from "@anchor-lang/core";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage,
  type AccountInfo, type Connection, type TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import { IDL } from "../../src/backend/solana/idl";
import { DELEGATION_PROGRAM_ID, ZKUBE_PROGRAM_ID, SOLANA_DEVNET_GENESIS_HASH } from "../../src/backend/solana/constants";
import * as pdas from "../../src/backend/solana/pdas";
import { buildApplyBonusPlan, buildCommitRunPlan, buildDelegateRunPlan, buildFinalizeRunPlan,
  buildFinishRunPlan, buildPlayMovePlan, buildRequestRerollPlan,
  buildRequestRowPlan, combinePreparedAndDelegatePlan, resolvePreparedRunAddresses, withPinnedWalletComputeBudget,
  WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT, WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  decodeActiveRunAccount, type TransactionPlan } from "../../src/backend/solana/runs/runPlan";
import { buildClaimDailyPrizePlan, buildPrepareDailyRunPlan, buildPurchaseKreditsPlan,
  ARENA_BOARD_CAPACITY, AUTO_CLAIM_LOOKBACK_DAYS, MAX_AUTO_CLAIMS_PER_ENTRY, type DailyView } from "../../src/backend/solana/content/dailyClient";
import { buildDeviceSessionEnableInstructions, SESSION_LIFETIME_SECONDS } from "../../src/backend/solana/SolanaIdentitySessionLive";
import { buildDeviceSessionRefillInstructions, buildDeviceSignerReclaimInstruction,
  DEVICE_SESSION_READY_SKEW_SECONDS } from "../../src/backend/solana/session/deviceSessionLifecycle";
import { assertDeviceSignerCanPay, DEVICE_FEE_ALLOWANCE_LAMPORTS,
  DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS } from "../../src/backend/solana/session/deviceSessionFunding";
import { buildRevokeExpiredSessionPlan, REVOKE_SESSION_V2_DISCRIMINATOR } from "../../src/backend/solana/session/sessionCleanup";
import { deriveSessionTokenV2Pda, SESSION_KEYS_PROGRAM_ID, SESSION_TOKEN_V2_DISCRIMINATOR } from "../../src/backend/solana/session/sessionV2";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { ARCADE_ACCOUNT_VERSION, ARENA_ENTRY_LAMPORTS, PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION, CATALOG_VERSION, ENTRY_DAILY_LAMPORTS, DAILY_MAX_MOVES } from "../../src/core/protocolVersions.generated";
import { generateAccountFixtures } from "./account-fixtures";
import { buildRecordCampaignStarsPlan, buildSetFeaturedEmblemPlan } from "../../src/backend/solana/economy/playerStateClient";
import { MAX_EMBLEM_ID } from "../../src/config/emblems";
import { LADDER_TIERS } from "../../src/config/ladderTiers";
import { coreFinishRun, coreRunSummary, coreRankPayoutPlan, coreDailyPairIndex, initializeZkubeCoreSync } from "../../src/core/zkubeCore";
import { canonicalJson, repositoryRoot } from "./solana-fixtures";

import { canonicalCampaignMap } from "../../src/core/campaignCatalog";
import { dailyContentFromPairIndex } from "../../src/core/dailyRules";

export const plannerFixturePath = resolve(repositoryRoot, "fixtures/unity-plans-v1.json");
export const plannerConstantsPath = resolve(repositoryRoot, "unity/Assets/ZKube/Integration/Planning/PlanningConstants.g.cs");
export const clientPolicyPath = resolve(repositoryRoot, "unity/Assets/ZKube/Generated/ClientPolicy.g.cs");

export function generatedClientPolicy() {
  return "// Generated from TypeScript client boundary policy. Do not edit.\nnamespace ZKube.Core.Generated\n{\n    public static class ClientPolicy\n    {\n" +
    `        public const string SolanaDevnetGenesisHash = ${JSON.stringify(SOLANA_DEVNET_GENESIS_HASH)};\n` +
    `        public const uint SessionReadySkewSeconds = ${DEVICE_SESSION_READY_SKEW_SECONDS}U;\n` +
    `        public const uint ArenaBoardCapacity = ${ARENA_BOARD_CAPACITY}U;\n    }\n}\n`;
}

export function generatedPlannerConstants() {
  const constants = { ComputeUnitLimit: WALLET_TRANSACTION_COMPUTE_UNIT_LIMIT,
    ComputeUnitPrice: WALLET_TRANSACTION_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    DeviceAllowanceLamports: DEVICE_FEE_ALLOWANCE_LAMPORTS, SettlementReserveLamports: DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS,
    SessionLifetimeSeconds: SESSION_LIFETIME_SECONDS,
    ClaimLookbackDays: AUTO_CLAIM_LOOKBACK_DAYS, MaxEmblemId: MAX_EMBLEM_ID, MaxFrameTier: LADDER_TIERS.length - 1 };
  return "// Generated from TypeScript client orchestration constants. Do not edit.\nnamespace ZKube.Integration.Planning\n{\n    public static class PlanningConstants\n    {\n" +
    Object.entries(constants).map(([name, value]) => `        public const uint ${name} = ${value}U;\n`).join("") +
    `        public const int MaxAutoClaims = ${MAX_AUTO_CLAIMS_PER_ENTRY};\n` +
    `        public const string SystemProgram = "${SystemProgram.programId}";\n` +
    `        public const string ComputeBudgetProgram = "${ComputeBudgetProgram.programId}";\n` +
    `        public const string DelegationProgram = "${DELEGATION_PROGRAM_ID}";\n` +
    `        public static readonly byte[] RevokeSessionDiscriminator = { ${REVOKE_SESSION_V2_DISCRIMINATOR.join(", ")} };\n    }\n}\n`;
}

const idl = convertIdlToCamelCase(IDL), coder = new BorshAccountsCoder(idl), types = new BorshCoder(idl).types;
function zero(type: IdlType): unknown {
  if (typeof type === "string") {
    if (type === "pubkey") return PublicKey.default;
    if (type === "bool") return false;
    return ["u64", "i64", "u128"].includes(type) ? new BN(0) : 0;
  }
  if ("array" in type) return Array.from({ length: Number(type.array[1]) }, () => zero(type.array[0]));
  if ("option" in type) return null;
  if ("defined" in type) {
    const definition = idl.types.find(item => item.name === type.defined.name)?.type;
    if (definition?.kind === "struct") return Object.fromEntries((definition.fields ?? []).map(field => {
      if (!("name" in field)) throw new Error("Unsupported tuple fixture");
      return [field.name, zero(field.type)];
    }));
    if (definition?.kind === "enum") return { [definition.variants[0].name]: {} };
  }
  throw new Error("Unsupported fixture type");
}
async function encoded(name: string, fields: object): Promise<Buffer> {
  const data = Buffer.alloc(coder.size(name));
  (await coder.encode(name, { ...(zero({ defined: { name } }) as object), ...fields })).copy(data);
  return data;
}
function envelope(address: PublicKey, data: Buffer, owner = ZKUBE_PROGRAM_ID) {
  return { address: address.toBase58(), owner: owner.toBase58(), executable: false, data: data.toString("base64") };
}
function instruction(instruction: TransactionInstruction) {
  return { programId: instruction.programId.toBase58(), data: Buffer.from(instruction.data).toString("base64"),
    accounts: instruction.keys.map(key => ({ address: key.pubkey.toBase58(), signer: key.isSigner, writable: key.isWritable })) };
}

export async function generatePlannerFixtures() {
    initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const nativeRules = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/native-run-trajectories.json"), "utf8"))
    .dailyRulesPublications as Array<{ day: number; rulesHash: number[] }>;
  const ownerKey = Keypair.fromSeed(new Uint8Array(32).fill(1)), deviceKey = Keypair.fromSeed(new Uint8Array(32).fill(2));
  const owner = ownerKey.publicKey, device = deviceKey.publicKey, validator = new PublicKey(new Uint8Array(32).fill(3));
  const now = 1788912000, day = Math.floor(now / 86400), nextRunId = 9007199254740993n;
  const blockhash = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
  const sessionToken = deriveSessionTokenV2Pda({ authority: owner, sessionSigner: device }).sessionToken;
  const ownerWallet = new SessionWallet(ownerKey), deviceWallet = new SessionWallet(deviceKey);
  const infos = new Map<string, AccountInfo<Buffer>>();
  const accounts: Record<string, ReturnType<typeof envelope>> = {};
  function put(name: string, address: PublicKey, data: Buffer, program = ZKUBE_PROGRAM_ID) {
    accounts[name] = envelope(address, data, program);
    infos.set(address.toBase58(), { owner: program, data, executable: false, lamports: 5000000, rentEpoch: 0 });
  }
  put("protocol", pdas.deriveProtocolConfigPda(), await encoded("protocolConfig", { version: PROTOCOL_ACCOUNT_VERSION }));
  put("arcade", pdas.deriveArcadeConfigPda(), await encoded("arcadeConfig", { version: ARCADE_ACCOUNT_VERSION,
    protocol: pdas.deriveProtocolConfigPda(), launchSeeded: true, launchDayId: day - 1 }));
  put("credit", pdas.deriveCreditVaultPda(), await encoded("creditVault", { version: ARCADE_ACCOUNT_VERSION, protocol: pdas.deriveProtocolConfigPda(),
    purchasedPrizeLamports: new BN((25n * ENTRY_DAILY_LAMPORTS).toString()) }));
  // These accounts are shared by planner, readiness and product fixtures.
  // Populate the whole protocol publication here; consumers never repair a
  // zero-filled draw, move limit or realm rule just to make a read pass.
  for (const offset of [0, 1]) {
    const dayId = day + offset, opensAt = dayId * 86400;
    const publications = nativeRules.filter(value => value.day === dayId);
    if (publications.length !== 1 || publications[0]!.rulesHash.length !== 32 ||
        publications[0]!.rulesHash.some(value => !Number.isInteger(value) || value < 0 || value > 255))
      throw new Error("Missing canonical native Daily rules hash for " + dayId);
    const pair = dailyContentFromPairIndex(dayId, await coreDailyPairIndex(dayId));
    const realm = canonicalCampaignMap(CATALOG_VERSION, pair.realmMapId);
    put(offset ? "following" : "daily", pdas.deriveArenaDailyPda(dayId), await encoded("arenaDaily", {
      version: ARCADE_ACCOUNT_VERSION, catalogVersion: CATALOG_VERSION, rulesHash: publications[0]!.rulesHash,
      dayId, arcadeConfig: pdas.deriveArcadeConfigPda(), mapId: pair.realmMapId, dailyTheme: pair.objective,
      rules: { ...realm.levels[0], pointsRequired: 0, guardian: realm.mapRules.guardian, startingRows: realm.mapRules.startingRows },
      pressure: { maxMoves: DAILY_MAX_MOVES },
      status: offset ? { funding: {} } : { open: {} }, opensAt: new BN(opensAt), runsCloseAt: new BN(opensAt + 86340) }));
  }
  const player = { version: PLAYER_STATE_ACCOUNT_VERSION, owner, nextRunId: new BN(nextRunId.toString()),
    activeRunId: new BN(0), kreditBalance: new BN(25) };
  put("player", pdas.derivePlayerStatePda(owner), await encoded("playerState", player));
  const sessionData = Buffer.concat([Buffer.from(SESSION_TOKEN_V2_DISCRIMINATOR), owner.toBuffer(), ZKUBE_PROGRAM_ID.toBuffer(),
    device.toBuffer(), owner.toBuffer(), Buffer.alloc(8)]);
  sessionData.writeBigInt64LE(BigInt(now + SESSION_LIFETIME_SECONDS), 136);
  put("session", sessionToken, sessionData, SESSION_KEYS_PROGRAM_ID);
  const profileInfo = infos.get(pdas.derivePlayerStatePda(owner).toBase58())!;
  const accountRows = await generateAccountFixtures(ownerKey, deviceKey, now) as Array<{ id: string; data: string }>;
  const runAccounts: Record<string, ReturnType<typeof envelope>> = {};
  const terminalRuns: Record<string, ReturnType<typeof envelope>> = {};
  for (const mode of ["daily"] as const) {
    const source = accountRows.find(row => row.id === `active-${mode}-playing`)!;
    const fields = coder.decode<Record<string, unknown>>("activeRun", Buffer.from(source.data, "base64"));
    fields.dailyChallenge = pdas.deriveArenaDailyPda(day);
    const data = await encoded("activeRun", fields);
    runAccounts[mode] = envelope(pdas.deriveRunAddresses(owner, nextRunId).activeRun, data);
    const token = decodeActiveRunAccount(data, ZKUBE_PROGRAM_ID).runToken!;
    const summary = coreRunSummary(coreFinishRun(token.config, token.state, "abandon"));
    Object.assign(fields, summary, { lifecycle: { finished: {} }, finishReason: { abandon: {} }, finishedAt: new BN(now),
      hasNextRow: false, nextRow: Array(8).fill(0), objectiveTotal: new BN(summary.objectiveTotal.toString()), pendingVrfCounter: 0 });
    terminalRuns[mode] = envelope(pdas.deriveRunAddresses(owner, nextRunId).activeRun, await encoded("activeRun", fields));
  }
  const base = {
    rpcEndpoint: "https://base.invalid/", getAccountInfo: async (address: PublicKey) => infos.get(address.toBase58()) ?? null,
    getAccountInfoAndContext: async (address: PublicKey) => ({ context: { slot: 100 }, value: infos.get(address.toBase58()) ?? null }),
    getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(address => infos.get(address.toBase58()) ?? null),
  } as unknown as Connection;
  const er = { rpcEndpoint: "https://er.invalid/" } as Connection;
  const plans: object[] = [];
  function add(id: string, input: object, plan: TransactionPlan | null) {
    if (plan == null) { plans.push({ id, input, expected: null }); return; }
    const signers = new Set([plan.feePayer.toBase58(), ...plan.transaction.instructions.flatMap(ix => ix.keys.filter(key => key.isSigner).map(key => key.pubkey.toBase58()))]);
    const ownerRequired = signers.has(owner.toBase58());
    const v0 = plan.layer === "solana-base" || ownerRequired;
    const instructions = v0 ? withPinnedWalletComputeBudget(plan.transaction.instructions) : plan.transaction.instructions;
    const message = v0 ? new TransactionMessage({ payerKey: plan.feePayer, recentBlockhash: blockhash, instructions }).compileToV0Message().serialize()
      : new Transaction({ feePayer: plan.feePayer, recentBlockhash: blockhash }).add(...instructions).serializeMessage();
    plans.push({ id, input, expected: { route: plan.layer, feePayer: plan.feePayer.toBase58(), ownerRequired, versionZero: v0,
      deviceSigners: [...signers].filter(key => key !== owner.toBase58()), reserve: plan.postFeeRentReserveLamports ?? 0,
      instructions: plan.transaction.instructions.map(instruction), message: Buffer.from(message).toString("base64") } });
  }
  const rawPlan = (instructions: TransactionInstruction[], payer = owner): TransactionPlan | null => instructions.length === 0 ? null :
    ({ layer: "solana-base", label: "fixture", connection: base, transaction: new Transaction().add(...instructions), feePayer: payer, signers: [] });
  const previousClosest = ConnectionMagicRouter.prototype.getClosestValidator, previousNow = Date.now;
  ConnectionMagicRouter.prototype.getClosestValidator = async () => ({ identity: validator.toBase58(), fqdn: er.rpcEndpoint });
  Date.now = () => now * 1000;
  try {
    for (const count of [1, 10, 25]) add(`purchase-${count}`, { operation: "purchase", count }, await buildPurchaseKreditsPlan({ connection: base, ownerWallet, kreditCount: count }));
    add("session-enable", { operation: "enable" }, rawPlan(await buildDeviceSessionEnableInstructions({ connection: base, owner, signer: device, validUntil: now + SESSION_LIFETIME_SECONDS })));
    for (const balance of [0, 1000000]) add(`session-refill-${balance}`, { operation: "refill", balance }, rawPlan(buildDeviceSessionRefillInstructions({ owner, signer: device, balanceLamports: balance }).instructions));
    for (const balance of [0, 1000000]) {
      const reclaim = buildDeviceSignerReclaimInstruction({ owner, signer: device, balanceLamports: balance });
      add(`session-revoke-${balance}`, { operation: "revoke", balance }, rawPlan(reclaim ? [reclaim] : []));
    }
    const expiredData = Buffer.from(sessionData); expiredData.writeBigInt64LE(BigInt(now), 136);
    accounts.expiredSession = envelope(sessionToken, expiredData, SESSION_KEYS_PROGRAM_ID);
    add("session-expired-cleanup", { operation: "revokeExpired" }, buildRevokeExpiredSessionPlan({ connection: base, wallet: ownerWallet,
      session: { address: sessionToken, authority: owner, sessionSigner: device, targetProgram: ZKUBE_PROGRAM_ID, feePayer: owner, validUntil: now }, nowUnix: now }));
    for (const board of ["score", "theme"] as const) add(`claim-${board}`, { operation: "claim", day: day - 1, board, position: 3 },
      await buildClaimDailyPrizePlan({ connection: base, wallet: deviceWallet, ownerAuthority: owner, sessionToken, dayId: day - 1, board, position: 3 }));
    for (let emblem = 0; emblem <= MAX_EMBLEM_ID; emblem++) for (let frame = 0; frame < LADDER_TIERS.length; frame++)
      add(`featured-${emblem}-${frame}`, { operation: "featured", emblem, frame },
        await buildSetFeaturedEmblemPlan({ connection: base, wallet: deviceWallet, ownerAuthority: owner, sessionToken, emblemId: emblem, frameTier: frame }));
    for (const ownerSigner of [false, true]) {
      const stars = new Uint8Array(25).fill(228);
      add("campaign-record-" + ownerSigner, { operation: "recordCampaignStars", stars: [...stars], ownerSigner },
        await buildRecordCampaignStarsPlan({ connection: base, wallet: ownerSigner ? ownerWallet : deviceWallet,
          ownerAuthority: owner, sessionToken: ownerSigner ? null : sessionToken, stars }));
    }
    const prepared = { addresses: pdas.deriveRunAddresses(owner, nextRunId) };
    add("delegate", { operation: "delegate" }, await buildDelegateRunPlan({ connection: base, wallet: deviceWallet,
      ownerAuthority: owner, sessionToken, addresses: prepared.addresses }));
    const daily = { address: pdas.deriveArenaDailyPda(day), dayId: day, followingDayId: day + 1, kreditBalance: 25n,
      nextRunId, activeRunId: 0n, entryLamports: ARENA_ENTRY_LAMPORTS } as DailyView;
    const boards: Array<{ id: string; day: number; kind: string; envelope: ReturnType<typeof envelope> | null }> = [];
    async function board(id: string, daysAgo: number, kind: "score" | "theme", sealedAt: number, claimed = false, sealed = true, wrongOwner = false) {
      const daily = pdas.deriveArenaDailyPda(day - daysAgo), address = pdas.deriveArenaBoardPda(daily, kind);
      const pool = 1000000000n, plan = coreRankPayoutPlan(pool, 1, ARENA_BOARD_CAPACITY);
      const header = await encoded("arenaBoard", { version: ARCADE_ACCOUNT_VERSION, arenaDaily: daily, dayId: day - daysAgo,
        kind: { [kind]: {} }, qualifiedCount: 1, widthCount: plan.widthWinnerCount, payoutCount: plan.winnerCount,
        denominator: new BN(plan.denominator.toString()), poolLamports: new BN(pool.toString()),
        paidLamports: new BN(plan.paidLamports.toString()), rolloverLamports: new BN(plan.rolloverLamports.toString()), capacityLimited: plan.capacityLimited,
        cursor: sealed ? plan.winnerCount : 0, sealed, sealedAt: new BN(sealedAt), claimedCount: claimed ? 1 : 0,
        claimedLamports: new BN(claimed ? plan.payouts[0]!.toString() : 0) });
      const row = types.encode("arenaBoardEntry", { player: wrongOwner ? validator : owner, score: 1,
        objectiveTotal: new BN(1), finalizedAt: new BN(now - 100), replayHash: Array(32).fill(7) });
      const data = Buffer.concat([header, row, Buffer.from([claimed ? 1 : 0])]);
      boards.push({ id, day: day - daysAgo, kind, envelope: envelope(address, data) });
      infos.set(address.toBase58(), { data, owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 });
    }
    add("daily-no-claims", { operation: "daily", boards: [] }, (await buildPrepareDailyRunPlan({ connection: base, wallet: deviceWallet, ownerAuthority: owner, sessionToken, daily, sessionValidUntil: now + SESSION_LIFETIME_SECONDS })).transactionPlan);
    await board("oldest-theme", 3, "theme", now - 300);
    await board("second-score", 2, "score", now - 200);
    await board("third-score", 1, "score", now - 100);
    await board("claimed", 4, "score", now - 400, true);
    await board("expired", 5, "score", now - 30 * 86400 - 1);
    await board("unsealed", 6, "score", 0, false, false);
    await board("other-owner", 7, "score", now - 700, false, true, true);
    boards.push({ id: "missing", day: day - 8, kind: "score", envelope: null });
    await board("wrong-program", 9, "score", now - 900);
    const malformed = boards[boards.length - 1]!;
    malformed.envelope!.owner = SystemProgram.programId.toBase58();
    infos.get(malformed.envelope!.address)!.owner = SystemProgram.programId;
    const validBoards = boards.filter(item => ["oldest-theme", "second-score", "third-score"].includes(item.id));
    const temporarilyAbsent = validBoards.map(item => [item.envelope!.address, infos.get(item.envelope!.address)!] as const);
    for (const [address] of temporarilyAbsent) infos.delete(address);
    add("daily-skips-unavailable-claims", { operation: "daily", boards: boards.filter(item => !validBoards.includes(item)).map(item => item.id) },
      (await buildPrepareDailyRunPlan({ connection: base, wallet: deviceWallet, ownerAuthority: owner, sessionToken, daily, sessionValidUntil: now + SESSION_LIFETIME_SECONDS })).transactionPlan);
    for (const [address, info] of temporarilyAbsent) infos.set(address, info);
    const paid = await buildPrepareDailyRunPlan({ connection: base, wallet: deviceWallet, ownerAuthority: owner, sessionToken, daily, sessionValidUntil: now + SESSION_LIFETIME_SECONDS });
    const attached = paid.transactionPlan.transaction.instructions[0]!.keys.slice(-4).map(key => key.pubkey.toBase58());
    const expectedBoards = [[3, "theme"], [2, "score"]].flatMap(([ago, kind]) => {
      const address = pdas.deriveArenaDailyPda(day - Number(ago));
      return [address.toBase58(), pdas.deriveArenaBoardPda(address, kind as "score" | "theme").toBase58()];
    });
    if (JSON.stringify(attached) !== JSON.stringify(expectedBoards)) throw new Error("Entry oracle did not select the oldest two eligible rewards");
    add("daily-max-two-eligible", { operation: "daily", boards: boards.map(row => row.id) }, paid.transactionPlan);
    add("daily-prepare-delegate", { operation: "daily", boards: boards.map(row => row.id), delegate: true },
      (await combinePreparedAndDelegatePlan({ prepared: paid, ownerAuthority: owner, sessionToken, sessionSigner: deviceKey })).transactionPlan);
    for (const mode of ["daily"] as const) {
      const activeRun = prepared.addresses.activeRun, seed = new Uint8Array(32).fill(7);
      const context = { owner, sessionWallet: deviceWallet, sessionToken, activeRun, erConnection: er, clientSeed: seed };
      const high = { mode, row: 1, start: 2, destination: 4, column: 5 };
      add(`${mode}-vrf`, { ...high, operation: "vrf" }, await buildRequestRowPlan(context));
      add(`${mode}-move`, { ...high, operation: "move" }, await buildPlayMovePlan({ ...context, expectedAction: 0, expectedMove: 0, row: 1, start: 2, destination: 4 }));
      add(`${mode}-bonus`, { ...high, operation: "bonus" }, await buildApplyBonusPlan({ ...context, expectedAction: 0, row: 1, column: 5 }));
      add(`${mode}-reroll`, { ...high, operation: "reroll" }, await buildRequestRerollPlan({ ...context, expectedAction: 0 }));
      add(`${mode}-finish`, { ...high, operation: "finish" }, await buildFinishRunPlan({ owner, signerWallet: deviceWallet, sessionToken, activeRun, erConnection: er }));
      add(`${mode}-owner-finish`, { ...high, operation: "finish", ownerSigner: true }, await buildFinishRunPlan({ owner, signerWallet: ownerWallet, sessionToken: null, activeRun, erConnection: er }));
      add(`${mode}-commit`, { mode, operation: "commit" }, await buildCommitRunPlan({ owner, payerWallet: deviceWallet, addresses: prepared.addresses, erConnection: er }));
      for (const abandonFirst of [false, true]) {
        const run = (abandonFirst ? runAccounts : terminalRuns)[mode]!;
        infos.set(activeRun.toBase58(), { data: Buffer.from(run.data, "base64"), owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0 });
        add(`${mode}-consume-${abandonFirst}`, { mode, operation: "consume", abandonFirst },
          await buildFinalizeRunPlan({ wallet: deviceWallet, owner, sessionToken, runId: nextRunId, addresses: prepared.addresses, mode,
            dailyChallenge: pdas.deriveArenaDailyPda(day), abandonFirst, connection: base }));
      }
      infos.delete(activeRun.toBase58());
    }
    const slotCases = [];
    for (const arcade of [0n, 1n]) {
      const profile = { ...player, activeRunId: new BN(arcade.toString()) };
      let accepted = true;
      try { resolvePreparedRunAddresses(owner, profile, "arcade"); } catch { accepted = false; }
      slotCases.push({ mode: "daily", arcade: arcade.toString(), accepted,
        player: envelope(pdas.derivePlayerStatePda(owner), await encoded("playerState", profile)) });
    }
    const funding = [890879, 890880, 895879, 895880, 900879, 900880, 900881].map(balance => {
      let accepted = true;
      try { assertDeviceSignerCanPay({ balanceLamports: balance, rentFloorLamports: 890880, transactionFeeLamports: 5000,
        postFeeReserveLamports: DEVICE_SETTLEMENT_FEE_RESERVE_LAMPORTS }); } catch { accepted = false; }
      return { balance, rent: 890880, fee: 5000, accepted };
    });
    const sourcePaths = ["client/src/backend/solana/economy/playerStateClient.ts", "client/src/config/emblems.ts", "client/src/config/ladderTiers.ts", "client/tools/unity/planner-fixtures.ts", "fixtures/native-run-trajectories.json", "client/src/core/dailyRules.ts", "client/src/core/dailyRules.generated.ts",
      "client/src/core/campaignCatalog.ts", "client/src/core/protocolVersions.generated.ts", "client/src/core/generated/zkube_core_bg.wasm", "client/src/backend/solana/runs/runPlan.ts", "client/src/backend/solana/content/dailyClient.ts",
      "client/src/backend/solana/SolanaIdentitySessionLive.ts", "client/src/backend/solana/session/deviceSessionFunding.ts",
      "client/src/backend/solana/session/deviceSessionLifecycle.ts", "client/src/backend/solana/session/sessionCleanup.ts", "client/src/backend/solana/idl/solana.json"];
    return { schemaVersion: 1, sourceHashes: Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(resolve(repositoryRoot, path))).digest("hex")])),
      inputs: { owner: owner.toBase58(), device: device.toBase58(), validator: validator.toBase58(), now, day, nextRunId: nextRunId.toString(), blockhash },
      accounts, runs: runAccounts, terminalRuns, boards, plans, slotCases, funding };
  } finally {
    ConnectionMagicRouter.prototype.getClosestValidator = previousClosest; Date.now = previousNow;
    infos.set(pdas.derivePlayerStatePda(owner).toBase58(), profileInfo);
  }
}

export { canonicalJson };
