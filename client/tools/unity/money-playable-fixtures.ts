/** Offline Daily trajectory: native transitions and actual TS wire plans. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import BN from "bn.js";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import { Keypair, PublicKey, Transaction, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { generateAccountFixtures } from "./account-fixtures";
import { repositoryRoot } from "./solana-fixtures";
import { IDL } from "../../src/backend/solana/idl";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { deriveRunAddresses, deriveArenaDailyPda, deriveArenaPlayerPda } from "../../src/backend/solana/pdas";
import { fetchCampaignView } from "../../src/backend/solana/content/campaignClient";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { deriveSessionTokenV2Pda } from "../../src/backend/solana/session/sessionV2";
import { buildPrepareDailyRunPlan, type DailyView } from "../../src/backend/solana/content/dailyClient";
import { SESSION_LIFETIME_SECONDS } from "../../src/backend/solana/SolanaIdentitySessionLive";
import { ARCADE_ACCOUNT_VERSION, ARENA_ENTRY_LAMPORTS, ENTRY_DAILY_LAMPORTS } from "../../src/core/protocolVersions.generated";
import { buildApplyBonusPlan, buildPlayMovePlan, buildRequestRerollPlan, buildRequestRowPlan,
  buildCommitRunPlan, buildFinalizeRunPlan, combinePreparedAndDelegatePlan, withPinnedWalletComputeBudget, decodeActiveRunAccount } from "../../src/backend/solana/runs/runPlan";
import { coreInitializeRun, coreApplyRunVrf, corePlayRunMove, coreApplyRunBonus,
  coreRequestRunReroll, coreRunSummary, coreBuildRunConfig, coreInitialReplayCommitment, coreLadderTier } from "../../src/core/zkubeCore";

interface Envelope { id?: string; address: string; owner: string; executable: boolean; data: string }
type Gesture = { kind: "move"; row: number; start: number; destination: number } |
  { kind: "bonus"; row: number; column: number } | { kind: "reroll" };
const bytes = (value: Uint8Array) => Buffer.from(value).toString("base64");
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const moneyDailyPlayableFixturePath = resolve(repositoryRoot, "fixtures/unity-money-daily-playable-v1.json");
export const moneyPlayableDataPath = resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/Evidence/MoneyPlayableEvidenceData.g.cs");

export async function generateMoneyPlayableFixtures() {
  const mode = "daily";
  const overview = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-money-overview-v1.json"), "utf8"));
  const plans = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-plans-v1.json"), "utf8"));
  const rpc = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-rpc-v1.json"), "utf8"));
  const native = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/native-run-trajectories.json"), "utf8"));
  const now = overview.inputs.now as number, runId = 9007199254740993n;
  // Public, deterministic fixture keys only. Never read wallet credentials.
  const owner = Keypair.fromSeed(Buffer.alloc(32, 1)), device = Keypair.fromSeed(Buffer.alloc(32, 2));
  const accountRows = await generateAccountFixtures(owner, device, now, true) as Envelope[];
  const template = accountRows.find(row => row.id === `active-${mode}-prepared`)!;
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  const activeFields = coder.decode("activeRun", Buffer.from(template.data, "base64"));
  const day = Math.floor(now / 86400), challenge = deriveArenaDailyPda(day);
  let config = decodeActiveRunAccount(Buffer.from(template.data, "base64"), ZKUBE_PROGRAM_ID).runToken!.config;
  if (mode === "daily") {
    const publication = native.dailyRulesPublications.find((row: { day: number }) => row.day === day);
    if (!publication) throw new Error("Native Daily publication is missing");
    const daily = coder.decode("arenaDaily", Buffer.from(plans.accounts.daily.data, "base64"));
    if (!Buffer.from(daily.rulesHash).equals(Buffer.from(publication.rulesHash))) throw new Error("Daily rules hash disagrees with native publication");
    const protocol = coder.decode("protocolConfig", Buffer.from(plans.accounts.protocol.data, "base64"));
    const rulesHash = Uint8Array.from(publication.rulesHash);
    const initialReplay = coreInitialReplayCommitment({ chainDomain: Uint8Array.from(protocol.replayDomain), challengeId: challenge.toBytes(),
      rulesHash, rawAccount: owner.publicKey.toBytes(), runId, mode: "ranked" });
    const absent = { kind: 0, value: 0, requiredCount: 0 };
    config = coreBuildRunConfig({ mode, rulesHash, initialReplay, maxMoves: publication.maxMoves,
      bonusType: publication.guardian.bonus, trigger: publication.guardian.trigger, triggerThreshold: publication.guardian.threshold,
      startingHeight: publication.startingHeight, fixedTier: 0, pointsRequired: 0, primary: absent, secondary: absent,
      objective: { ...publication.objective, requiredCount: 0 } });
    Object.assign(activeFields, { rules: daily.rules, rulesHash: publication.rulesHash, replayHash: [...initialReplay],
      mapId: publication.realm, dailyTheme: publication.objective, dailyChallenge: challenge, deadlineAt: new BN(now + 86340) });
  }
  const addresses = deriveRunAddresses(owner.publicKey, runId), wallet = new SessionWallet(device);
  const sessionToken = deriveSessionTokenV2Pda({ authority: owner.publicKey, sessionSigner: device.publicKey }).sessionToken;
  const blockhash = new PublicKey(Buffer.alloc(32, 9)).toBase58(), clientSeed = Buffer.alloc(32, 7);
  let state = coreInitializeRun(config), requestCounter = 0;

  async function envelope(lifecycle?: string): Promise<Envelope & { token: { config: string; state: string } }> {
    const summary = coreRunSummary(state), terminal = summary.phase === "finished" || summary.phase === "levelComplete";
    const fields = { ...activeFields, ...summary, lifecycle: { [lifecycle ?? summary.phase]: {} },
      objectiveTotal: new BN(summary.objectiveTotal.toString()), finishedAt: new BN(terminal ? now : 0),
      finishReason: null, hasNextRow: summary.nextRow !== null, nextRow: summary.nextRow ?? Array(8).fill(0),
      vrfRequestCounter: requestCounter, pendingVrfCounter: summary.phase === "awaitingVrf" ? requestCounter : 0 };
    const data = Buffer.alloc(coder.size("activeRun")); (await coder.encode("activeRun", fields)).copy(data);
    const decoded = decodeActiveRunAccount(data, ZKUBE_PROGRAM_ID).runToken!;
    if (!Buffer.from(decoded.state).equals(Buffer.from(state)))
      throw new Error("ActiveRun account projection disagrees with native trajectory at " + summary.actionCounter);
    // Reconciliation seeds a fresh config from the accepted replay hash. Keep
    // its exact config alongside the state instead of manufacturing an identity.
    return { address: addresses.activeRun.toBase58(), owner: ZKUBE_PROGRAM_ID.toBase58(), executable: false,
      data: data.toString("base64"), token: { config: bytes(decoded.config), state: bytes(decoded.state) } };
  }
  let accepted = await envelope("delegated");
  const initial = accepted;
  const er = { rpcEndpoint: "https://er.invalid/", getAccountInfoAndContext: async () => ({ context: { slot: 100 }, value: {
    owner: ZKUBE_PROGRAM_ID, executable: false, lamports: 1, rentEpoch: 0, data: Buffer.from(accepted.data, "base64") } }) } as unknown as Connection;
  const context = { owner: owner.publicKey, sessionWallet: wallet, sessionToken, activeRun: addresses.activeRun,
    erConnection: er, clientSeed };
  const wire = (plan: Awaited<ReturnType<typeof buildRequestRowPlan>>, versionZero = false) => {
    if (versionZero) {
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: device.publicKey, recentBlockhash: blockhash,
        instructions: withPinnedWalletComputeBudget(plan.transaction.instructions) }).compileToV0Message());
      tx.sign([device]);
      return { route: plan.layer, bytes: bytes(tx.serialize()), message: bytes(tx.message.serialize()), signatureBytes: bytes(tx.signatures[0]!) };
    }
    const tx = new Transaction({ feePayer: device.publicKey, recentBlockhash: blockhash }).add(...plan.transaction.instructions);
    tx.sign(device);
    return { route: plan.layer, bytes: tx.serialize().toString("base64"), message: tx.serializeMessage().toString("base64"),
      signatureBytes: bytes(tx.signature!) };
  };
  const steps: object[] = [];
  const record = async (command: object, transaction: ReturnType<typeof wire> | null, lifecycle?: string) => {
    accepted = await envelope(lifecycle);
    steps.push({ command, transaction, account: accepted });
  };
  const opening = wire(await buildRequestRowPlan(context));
  requestCounter = 1;
  await record({ kind: "requestVrf" }, opening);

  async function resolveVrf() {
    const output = Buffer.alloc(32, 9 + requestCounter);
    state = coreApplyRunVrf({ config, state, requestCounter, vrfOutput: output });
    await record({ kind: "oracleVrf", requestCounter, output: bytes(output) }, null);
  }
  await resolveVrf();
  const apply = async (gesture: Gesture) => {
    const before = coreRunSummary(state);
    let transaction: ReturnType<typeof wire>;
    if (gesture.kind === "reroll") {
      transaction = wire(await buildRequestRerollPlan({ ...context, expectedAction: before.actionCounter }));
      state = coreRequestRunReroll(config, state, before.actionCounter);
    } else if (gesture.kind === "bonus") {
      transaction = wire(await buildApplyBonusPlan({ ...context, expectedAction: before.actionCounter, row: gesture.row, column: gesture.column }));
      state = coreApplyRunBonus({ config, state, action: before.actionCounter, row: gesture.row, column: gesture.column });
    } else {
      transaction = wire(await buildPlayMovePlan({ ...context, expectedAction: before.actionCounter, expectedMove: before.moves,
        row: gesture.row, start: gesture.start, destination: gesture.destination }));
      state = corePlayRunMove({ config, state, action: before.actionCounter, expectedMove: before.moves,
        row: gesture.row, start: gesture.start, destination: gesture.destination });
    }
    if (coreRunSummary(state).phase === "awaitingVrf") requestCounter++;
    await record({ ...gesture, expectedAction: before.actionCounter, expectedMove: before.moves }, transaction);
    if (coreRunSummary(state).phase === "awaitingVrf") await resolveVrf();
  };
  await apply({ kind: "reroll" });
  let usedBonus = false;
  const scoreCandidate = (next: ReturnType<typeof coreRunSummary>) => {
    const height = Math.ceil((next.grid.reduce((last, value, index) => value ? index : last, -1) + 1) / 8);
    return next.latchedStarSources * 100000 + next.score * 100 + Number(next.objectiveTotal) * 50 - height * 10 - next.grid.filter(Boolean).length;
  };
  for (let turn = 0; turn < 110 && coreRunSummary(state).phase === "playing"; turn++) {
    const summary = coreRunSummary(state);
    if (!usedBonus && summary.bonusCharges > 0) {
      let bonus: Gesture | undefined, rank = -Infinity;
      for (let row = 0; row < 10; row++) for (let column = 0; column < 8; column++) {
        let next: ReturnType<typeof coreRunSummary>;
        try { next = coreRunSummary(coreApplyRunBonus({ config, state, action: summary.actionCounter, row, column })); }
        catch { continue; }
        const candidate = scoreCandidate(next);
        if (candidate > rank) { rank = candidate; bonus = { kind: "bonus", row, column }; }
      }
      if (bonus) { await apply(bonus); usedBonus = true; continue; }
    }
    let best: Gesture | undefined, rank = -Infinity;
    for (let row = 0; row < 10; row++) for (let start = 0; start < 8; start++) for (let destination = 0; destination < 8; destination++) {
      if (start === destination || summary.grid[row * 8 + start] === 0) continue;
      let next: ReturnType<typeof coreRunSummary>;
      try { next = coreRunSummary(corePlayRunMove({ config, state, action: summary.actionCounter, expectedMove: summary.moves, row, start, destination })); }
      catch { continue; } // Native rejection excludes this search candidate.
      const candidate = scoreCandidate(next);
      if (candidate > rank) { rank = candidate; best = { kind: "move", row, start, destination }; }
    }
    if (!best) throw new Error("No legal native gesture reaches the next " + mode + " step");
    await apply(best);
  }
  const terminal = coreRunSummary(state);
  if (terminal.phase !== "finished" && terminal.phase !== "levelComplete") throw new Error(mode + " trajectory did not reach a native terminal state");
  const commit = wire(await buildCommitRunPlan({ owner: owner.publicKey, payerWallet: wallet, addresses, erConnection: er }));
  const consume = wire(await buildFinalizeRunPlan({ wallet, owner: owner.publicKey, sessionToken, runId, addresses,
    mode, dailyChallenge: challenge, connection: er }), true);
  const background: Envelope[] = overview.scenarios.find((row: { id: string }) => row.id === "owner-overview").baseAccounts;
  const playerTemplate: Envelope = plans.accounts.player;
  const playerFields = coder.decode("playerState", Buffer.from(playerTemplate.data, "base64"));
  Object.assign(playerFields, { activeRunId: new BN(0),
    nextRunId: new BN((runId + 1n).toString()), campaignStars: Array(25).fill(0) });
  const encode = async (name: string, fields: object, original: Envelope): Promise<Envelope> => {
    const data = Buffer.alloc(coder.size(name)); (await coder.encode(name, fields)).copy(data);
    return { ...original, data: data.toString("base64") };
  };
  const player = () => encode("playerState", playerFields, playerTemplate);
  if (mode === "daily") Object.assign(playerFields, { nextRunId: new BN(runId.toString()),
    activeRunDaily: PublicKey.default, activeRunMode: { daily: {} }, activeRunDeadlineAt: new BN(0),
    lastEntryDayId: 0, entryStreakDays: 0 });
  const playerBefore = await player();
  const baseAccounts: Array<Envelope & { lamports?: number }> = [...background.filter(row => row.address !== playerTemplate.address), playerBefore, plans.accounts.session,
    { address: device.publicKey.toBase58(), owner: PublicKey.default.toBase58(), executable: false, data: "", lamports: 20000000 }];
  const entryAccounts: Envelope[] = [], resultAccounts: Envelope[] = [];
  let dailyResult: { score: number; theme: string; qualifyingPoints: number; followingContribution: string; kreditsBefore: string; kreditsAfter: string; streakAfter: number } | null = null;
  {
    if (!usedBonus || terminal.dailyScore <= 0 || terminal.objectiveTotal <= 0n)
      throw new Error("Daily evidence requires earned guardian use and both qualifying metrics");
    const currentTemplate = plans.accounts.daily as Envelope, followingTemplate = plans.accounts.following as Envelope;
    const current = coder.decode("arenaDaily", Buffer.from(currentTemplate.data, "base64"));
    const following = coder.decode("arenaDaily", Buffer.from(followingTemplate.data, "base64"));
    // A fresh entrant and a synthetically seeded open pot keep this entire
    // journey internally consistent; unrelated profile/settlement specimens
    // are not a plausible history for a first qualification.
    current.ledger.seededLamports = new BN(ARENA_ENTRY_LAMPORTS.toString()).muln(50);
    const replace = (row: Envelope) => {
      const at = baseAccounts.findIndex(value => value.address === row.address);
      if (at < 0) baseAccounts.push(row); else baseAccounts[at] = row;
    };
    replace(await encode("arenaDaily", current, currentTemplate)); replace(followingTemplate);
    replace(plans.accounts.credit);
    const lookup = (address: PublicKey) => {
      const row = baseAccounts.find(value => value.address === address.toBase58());
      return row ? { owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"),
        lamports: row.lamports ?? 5000000, rentEpoch: 0 } : null;
    };
    const base = { rpcEndpoint: overview.inputs.base, getAccountInfo: async (address: PublicKey) => lookup(address),
      getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(lookup) } as unknown as Connection;
    const daily = { address: challenge, dayId: day, followingDayId: day + 1, kreditBalance: BigInt(playerFields.kreditBalance.toString()),
      nextRunId: runId, activeRunId: 0n, entryLamports: ARENA_ENTRY_LAMPORTS } as DailyView;
    const previousClosest = ConnectionMagicRouter.prototype.getClosestValidator, previousNow = Date.now;
    ConnectionMagicRouter.prototype.getClosestValidator = async () => ({ identity: plans.inputs.validator, fqdn: er.rpcEndpoint });
    Date.now = () => now * 1000;
    try {
      const prepared = await buildPrepareDailyRunPlan({ connection: base, wallet, ownerAuthority: owner.publicKey, sessionToken,
        daily, sessionValidUntil: now + SESSION_LIFETIME_SECONDS });
      const combined = await combinePreparedAndDelegatePlan({ prepared, ownerAuthority: owner.publicKey, sessionToken, sessionSigner: device });
      steps.unshift({ command: { kind: "entry" }, transaction: wire(combined.transactionPlan, true), account: initial });
    } finally { ConnectionMagicRouter.prototype.getClosestValidator = previousClosest; Date.now = previousNow; }
    const kreditsBefore = playerFields.kreditBalance.toString();
    Object.assign(playerFields, { activeRunId: new BN(runId.toString()), activeRunDaily: challenge,
      activeRunMode: { daily: {} }, activeRunDeadlineAt: new BN(now + 86340), nextRunId: new BN((runId + 1n).toString()),
      kreditBalance: playerFields.kreditBalance.subn(1), lifetimePaidEntries: playerFields.lifetimePaidEntries.addn(1),
      lastEntryDayId: day, entryStreakDays: 1 });
    entryAccounts.push(await player());
    current.entriesPaid = current.entriesPaid.addn(1); current.uniquePlayers++;
    entryAccounts.push(await encode("arenaDaily", current, currentTemplate));
    following.ledger.entryLamports = following.ledger.entryLamports.add(new BN(ENTRY_DAILY_LAMPORTS.toString()));
    entryAccounts.push(await encode("arenaDaily", following, followingTemplate));
    const credit = coder.decode("creditVault", Buffer.from(plans.accounts.credit.data, "base64"));
    credit.spentPrizeLamports = credit.spentPrizeLamports.add(new BN(ENTRY_DAILY_LAMPORTS.toString()));
    entryAccounts.push(await encode("creditVault", credit, plans.accounts.credit));
    const arenaAddress = deriveArenaPlayerPda(challenge, owner.publicKey);
    const [checkedArena, bump] = PublicKey.findProgramAddressSync([Buffer.from("arena_player"), challenge.toBuffer(), owner.publicKey.toBuffer()], ZKUBE_PROGRAM_ID);
    if (!checkedArena.equals(arenaAddress)) throw new Error("ArenaPlayer fixture bump disagrees with canonical PDA");
    const emptyRow = { player: PublicKey.default, score: 0, objectiveTotal: new BN(0), finalizedAt: new BN(0), replayHash: Array(32).fill(0) };
    const arena = { version: ARCADE_ACCOUNT_VERSION, challenge, player: owner.publicKey, rentPayer: device.publicKey,
      paidEntries: 1, resolvedEntries: 0, activePaidRunId: new BN(runId.toString()), hasScoreBest: false,
      scoreBestEntry: emptyRow, scoreBestRunId: new BN(0), hasThemeBest: false, themeBestEntry: emptyRow, themeBestRunId: new BN(0), bump };
    const arenaTemplate = { address: arenaAddress.toBase58(), owner: ZKUBE_PROGRAM_ID.toBase58(), executable: false, data: "" };
    entryAccounts.push(await encode("arenaPlayer", arena, arenaTemplate));
    const scoreRow = { player: owner.publicKey, score: terminal.dailyScore, objectiveTotal: new BN(terminal.objectiveTotal.toString()),
      finalizedAt: new BN(now), replayHash: terminal.replayHash };
    Object.assign(arena, { resolvedEntries: 1, activePaidRunId: new BN(0), hasScoreBest: true, scoreBestEntry: scoreRow,
      scoreBestRunId: new BN(runId.toString()), hasThemeBest: true, themeBestEntry: scoreRow, themeBestRunId: new BN(runId.toString()) });
    resultAccounts.push(await encode("arenaPlayer", arena, arenaTemplate));
    current.entriesScored = current.entriesScored.addn(1); current.scoreQualifiedPlayers++; current.themeQualifiedPlayers++;
    resultAccounts.push(await encode("arenaDaily", current, currentTemplate));
    const qualifyingPoints = Number(native.ladderQualifyPoints) * 2;
    if (!Number.isSafeInteger(qualifyingPoints) || qualifyingPoints <= 0) throw new Error("Native qualifying credit is missing");
    playerFields.ladderPoints = playerFields.ladderPoints.addn(qualifyingPoints);
    playerFields.highestLadderTier = Math.max(playerFields.highestLadderTier, coreLadderTier(BigInt(playerFields.ladderPoints.toString())));
    playerFields.bestDailyScore = Math.max(playerFields.bestDailyScore, terminal.dailyScore);
    Object.assign(playerFields, { activeRunId: new BN(0), activeRunDaily: PublicKey.default,
      activeRunMode: { daily: {} }, activeRunDeadlineAt: new BN(0) });
    dailyResult = { score: terminal.dailyScore, theme: terminal.objectiveTotal.toString(), qualifyingPoints,
      followingContribution: ENTRY_DAILY_LAMPORTS.toString(), kreditsBefore, kreditsAfter: playerFields.kreditBalance.toString(), streakAfter: playerFields.entryStreakDays };
  }
  const playerAfter = await player();
  const progress = async (profile: Envelope) => {
    const lookup = (address: PublicKey) => {
      const row = address.toBase58() === profile.address ? profile : baseAccounts.find(value => value.address === address.toBase58());
      return row ? { owner: new PublicKey(row.owner), executable: row.executable, data: Buffer.from(row.data, "base64"), lamports: 1, rentEpoch: 0 } : null;
    };
    const connection = { getAccountInfo: async (address: PublicKey) => lookup(address),
      getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(lookup) } as unknown as Connection;
    const view = await fetchCampaignView({ connection, wallet: new SessionWallet(owner) });
    if (!view) throw new Error("Actual TS Campaign reads rejected the playable profile");
    return view.maps.map(map => ({ mapId: map.mapId, unlocked: map.unlocked, levelStars: map.levelStars }));
  };
  const result = (id: string) => rpc.cases.find((row: { id: string }) => row.id === id).result;
  const paths = ["client/tools/unity/account-fixtures.ts", "client/src/backend/solana/runs/runPlan.ts",
    "client/src/backend/solana/idl/solana.json", "client/src/core/zkubeCore.ts", "client/src/core/generated/zkube_core_bg.wasm",
    "fixtures/unity-money-overview-v1.json", "fixtures/unity-plans-v1.json", "fixtures/unity-rpc-v1.json",
    "fixtures/native-run-trajectories.json", "client/src/backend/solana/pdas.ts", "client/src/backend/solana/content/dailyClient.ts",
    "programs/solana/src/state/arcade.rs", "programs/solana/src/state/protocol.rs", "programs/solana/src/instructions/arcade_instructions.rs",
    "client/src/backend/solana/content/campaignClient.ts"];
  const body = { schemaVersion: 1, evidenceClass: `offline-synthetic-money-${mode}-trajectory`, inputs: {
    mode,
    now, owner: owner.publicKey.toBase58(), device: device.publicKey.toBase58(), sessionToken: sessionToken.toBase58(),
    runId: runId.toString(), clientSeed: bytes(clientSeed), blockhash, config: bytes(config) }, initial, steps,
    transport: { ...overview.inputs, now, blockhash: result("base-blockhash"), fee: result("base-fee"), rent: result("base-rent"),
      simulation: result("simulation-ok"), baseAccounts, playerBefore, playerAfter, entryAccounts, resultAccounts,
      validator: { identity: plans.inputs.validator, fqdn: er.rpcEndpoint } },
    campaign: { before: await progress(playerBefore), after: await progress(playerAfter) },
    daily: dailyResult,
    terminal: { phase: terminal.phase, score: terminal.score, latchedStarSources: terminal.latchedStarSources, usedBonus }, settlement: { commit, consume },
    provenance: [...paths.map(path => ({ path, sha256: hash(readFileSync(resolve(repositoryRoot, path))) })),
      { path: "client/tools/unity/money-playable-fixtures.ts", sha256: hash(readFileSync(new URL(import.meta.url))) }] };
  return { ...body, sourceSha256: hash(JSON.stringify(body)) };
}

export function generatedMoneyPlayableData(daily: Awaited<ReturnType<typeof generateMoneyPlayableFixtures>>) {
  const property = (name: string, data: unknown) => `        internal static string ${name} => System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String("${Buffer.from(JSON.stringify(data)).toString("base64")}"));\n`;
  return "// Generated offline evidence only. Excluded from production and Store.\n#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE\nnamespace ZKube.Integration.App.Evidence\n{\n    internal static class MoneyPlayableEvidenceData\n    {\n" + property("DailyJson", daily) + "    }\n}\n#endif\n";
}
