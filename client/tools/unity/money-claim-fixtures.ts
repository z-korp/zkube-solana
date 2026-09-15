/** Finite device-signed claims; all keys/accounts are synthetic and offline. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BorshAccountsCoder, BorshCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { repositoryRoot } from "./solana-fixtures";
import { IDL } from "../../src/backend/solana/idl";
import { deriveArenaDailyPda, deriveArenaBoardPda, derivePlayerStatePda } from "../../src/backend/solana/pdas";
import { buildClaimDailyPrizePlan, fetchDailyBoardAccount, fetchDailyView, ARENA_BOARD_CAPACITY } from "../../src/backend/solana/content/dailyClient";
import { projectSolanaBoards } from "../../src/backend/solana/content/SolanaContentBoardsLive";
import { fetchPlayerStateView } from "../../src/backend/solana/economy/playerStateClient";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";
import { initializeZkubeCoreSync, coreDailyBoardPools, coreRankPayoutPlan, coreLadderPoints, coreLadderTier } from "../../src/core/zkubeCore";
import { DAILY_REWARD_CLAIM_WINDOW_SECONDS } from "../../src/core/protocolVersions.generated";

export const moneyClaimFixturePath = process.env.ZKUBE_MONEY_CLAIM_FIXTURE_PATH ?? resolve(repositoryRoot, "fixtures/unity-money-claims-v1.json");
export const moneyClaimDataPath = process.env.ZKUBE_MONEY_CLAIM_DATA_PATH ?? resolve(repositoryRoot, "unity/Assets/ZKube/Integration/App/Evidence/MoneyClaimEvidenceData.g.cs");
type Kind = "score" | "theme";
interface Envelope { address: string; owner: string; executable: boolean; data: string; lamports?: number }
interface Definition { id: string; kind: Kind; status: "confirmed" | "processed"; failure: boolean; variant: "sealed" | "deadline" | "expired" | "claims-expired" | "unsealed" | "claimed" | "missing-session" }
const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function generateMoneyClaimFixtures() {
  initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const paths = ["fixtures/unity-money-economy-v1.json", "fixtures/unity-money-session-v1.json", "fixtures/unity-product-reads-v1.json", "fixtures/unity-plans-v1.json"];
  const [economy, sessions, products, plans] = paths.map(path => JSON.parse(readFileSync(resolve(repositoryRoot, path), "utf8")));
  const owner = Keypair.fromSeed(Buffer.alloc(32, 1)), device = Keypair.fromSeed(Buffer.alloc(32, 2));
  const now = economy.inputs.now as number, day = products.inputs.oldDay as number;
  const session = sessions.scenarios.find((row: { id: string }) => row.id === "session-current");
  if (session.active.signer !== device.publicKey.toBase58()) throw new Error("Synthetic claim signer mismatch");
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL)), types = new BorshCoder(convertIdlToCamelCase(IDL)).types;
  const encode = async (name: string, fields: object) => {
    const bytes = Buffer.alloc(coder.size(name)); (await coder.encode(name, fields)).copy(bytes); return bytes;
  };
  const dailyAddress = deriveArenaDailyPda(day), playerAddress = derivePlayerStatePda(owner.publicKey);
  const base = economy.scenarios.find((row: { id: string }) => row.id === "kredit-buy-1").before as Envelope[];
  const playerSource = base.find(row => row.address === playerAddress.toBase58())!;
  const dailySource = products.boardCases.find((row: { kind: Kind; variant: string }) => row.kind === "score" && row.variant === "sealed").daily as Envelope;
  const pools = coreDailyBoardPools(80000000n, 15);
  const payout = { score: coreRankPayoutPlan(pools.score, 30, ARENA_BOARD_CAPACITY), theme: coreRankPayoutPlan(pools.theme, 15, ARENA_BOARD_CAPACITY) };
  if (payout.score.winnerCount !== 4 || payout.theme.winnerCount !== 4) throw new Error("Claim fixture needs the native four-place floor");
  const definitions: Definition[] = [];
  for (const kind of ["score", "theme"] as const) {
    for (const variant of ["sealed", "deadline", "expired", "claims-expired", "unsealed", "claimed", "missing-session"] as const)
      definitions.push({ id: "claim-" + kind + "-" + variant, kind, variant, status: "confirmed", failure: false });
    definitions.push({ id: "claim-" + kind + "-pending-success", kind, variant: "sealed", status: "processed", failure: false },
      { id: "claim-" + kind + "-pending-failure", kind, variant: "sealed", status: "processed", failure: true });
  }
  const scenarios = [];
  for (const definition of definitions) {
    const rows = new Map(base.map(row => [row.address, { ...row }]));
    if (definition.variant !== "missing-session") for (const row of session.before as Envelope[])
      if (row.address === session.active.signer || row.address === session.active.token) rows.set(row.address, { ...row });
    const player = coder.decode("playerState", Buffer.from(playerSource.data, "base64"));
    player.ladderPoints = new BN(200); player.highestLadderTier = coreLadderTier(200n);
    rows.set(playerSource.address, { ...playerSource, data: (await encode("playerState", player)).toString("base64") });
    const daily = coder.decode("arenaDaily", Buffer.from(dailySource.data, "base64"));
    // Deliberately contradictory RPC state checks the program's explicit expired
    // flag even when the separately returned board timestamp looks claimable.
    Object.assign(daily, { scoreQualifiedPlayers: 30, themeQualifiedPlayers: 15, claimsExpired: definition.variant === "claims-expired",
      ledger: { seededLamports: new BN(80000000), entryLamports: new BN(0), rolloverInLamports: new BN(0),
        payoutLamports: new BN((payout.score.paidLamports + payout.theme.paidLamports).toString()),
        rolloverOutLamports: new BN((payout.score.rolloverLamports + payout.theme.rolloverLamports).toString()) } });
    rows.set(dailySource.address, { ...dailySource, data: (await encode("arenaDaily", daily)).toString("base64"), lamports: 85000000 });
    for (const kind of ["score", "theme"] as const) {
      const source = products.boardCases.find((row: { kind: Kind; variant: string }) => row.kind === kind && row.variant === "sealed").envelope as Envelope;
      const header = coder.decode("arenaBoard", Buffer.from(source.data, "base64"));
      const chosen = kind === definition.kind, unsealed = chosen && definition.variant === "unsealed", claimed = chosen && definition.variant === "claimed";
      // The peer board has its own valid window, even when this board expired.
      const sealedAt = unsealed ? 0 : chosen && definition.variant === "expired" ? now - DAILY_REWARD_CLAIM_WINDOW_SECONDS - 1
        : chosen && definition.variant === "deadline" ? now - DAILY_REWARD_CLAIM_WINDOW_SECONDS : now - (kind === "score" ? 100 : 200);
      Object.assign(header, { sealed: !unsealed, sealedAt: new BN(sealedAt), qualifiedCount: kind === "score" ? 30 : 15,
        widthCount: payout[kind].widthWinnerCount, payoutCount: payout[kind].winnerCount, denominator: new BN(payout[kind].denominator.toString()),
        poolLamports: new BN(pools[kind].toString()), paidLamports: new BN(payout[kind].paidLamports.toString()), rolloverLamports: new BN(payout[kind].rolloverLamports.toString()),
        capacityLimited: payout[kind].capacityLimited, cursor: unsealed ? 0 : payout[kind].winnerCount,
        claimedCount: claimed ? 1 : 0, claimedLamports: new BN(claimed ? payout[kind].payouts[0]!.toString() : 0) });
      const entries = Array.from({ length: payout[kind].winnerCount }, (_, index) => types.encode("arenaBoardEntry", {
        player: index === 0 ? owner.publicKey : Keypair.fromSeed(Buffer.alloc(32, index + 5)).publicKey,
        score: 1000 - index * 10, objectiveTotal: new BN(500 - index * 5), finalizedAt: new BN(now - 300), replayHash: new Array(32).fill(index + 1),
      }));
      const bytes = Buffer.concat([await encode("arenaBoard", header), ...entries, Buffer.from([claimed ? 1 : 0])]);
      rows.set(source.address, { ...source, data: bytes.toString("base64") });
    }
    const before = [...rows.values()];
    const amount = payout[definition.kind].payouts[0]!, points = coreLadderPoints(definition.kind === "score" ? 30 : 15, 1);
    const plan = await buildClaimDailyPrizePlan({ connection: { rpcEndpoint: economy.inputs.base } as Connection, wallet: new SessionWallet(device),
      ownerAuthority: owner.publicKey, sessionToken: new PublicKey(session.active.token), dayId: day, board: definition.kind, position: 0 });
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: device.publicKey, recentBlockhash: plans.inputs.blockhash,
      instructions: withPinnedWalletComputeBudget(plan.transaction.instructions) }).compileToV0Message());
    const partial = Buffer.from(tx.serialize()).toString("base64"); tx.sign([device]);
    const succeeds = (definition.variant === "sealed" || definition.variant === "deadline") && !definition.failure;
    if (succeeds) {
      player.ladderPoints = player.ladderPoints.addn(points); player.highestLadderTier = Math.max(player.highestLadderTier, coreLadderTier(BigInt(player.ladderPoints.toString())));
      const record = player[definition.kind + "Record"];
      record.bestPrizeRank = 1; record.podiums = Math.min(0xffffffff, record.podiums + 1); record.wins = Math.min(0xffffffff, record.wins + 1);
      record.rewardsLamports = record.rewardsLamports.add(new BN(amount.toString()));
      rows.set(playerSource.address, { ...playerSource, data: (await encode("playerState", player)).toString("base64") });
      const boardAddress = deriveArenaBoardPda(dailyAddress, definition.kind).toBase58(), board = rows.get(boardAddress)!;
      const bytes = Buffer.from(board.data, "base64"), header = coder.decode("arenaBoard", bytes);
      header.claimedCount = 1; header.claimedLamports = new BN(amount.toString());
      const tail = Buffer.from(bytes.subarray(coder.size("arenaBoard"))); tail[tail.length - 1] = 1;
      rows.set(boardAddress, { ...board, data: Buffer.concat([await encode("arenaBoard", header), tail]).toString("base64") });
      for (const [address, delta] of [[dailyAddress.toBase58(), -amount], [owner.publicKey.toBase58(), amount]] as const) {
        const row = rows.get(address)!; rows.set(address, { ...row, lamports: Number(BigInt(row.lamports!) + delta) });
      }
    }
    const project = async (accounts: Envelope[]) => {
      const map = new Map(accounts.map(row => [row.address, row]));
      const info = (address: PublicKey) => { const row = map.get(address.toBase58()); return row ? { owner: new PublicKey(row.owner), executable: row.executable,
        data: Buffer.from(row.data, "base64"), lamports: row.lamports ?? economy.inputs.accountLamports, rentEpoch: 0 } : null; };
      const connection = { rpcEndpoint: economy.inputs.base, getAccountInfo: async (address: PublicKey) => info(address),
        getAccountInfoAndContext: async (address: PublicKey) => ({ context: { slot: 100 }, value: info(address) }),
        getMultipleAccountsInfo: async (addresses: PublicKey[]) => addresses.map(info) } as unknown as Connection;
      const wallet = new SessionWallet(owner), profile = await fetchPlayerStateView({ connection, wallet, owner: owner.publicKey });
      const dailyView = await fetchDailyView({ connection, wallet, dayId: day });
      if (!profile || !dailyView) throw new Error("Claim fixture rejected by actual product readers");
      const boards = await Promise.all([fetchDailyBoardAccount(connection, dailyAddress, day, "score"), fetchDailyBoardAccount(connection, dailyAddress, day, "theme")]);
      const projected = projectSolanaBoards({ daily: dailyView, accounts: boards, owner: owner.publicKey, nowUnix: now });
      return { kredits: profile.kreditBalance.toString(), ladderPoints: profile.ladderPoints.toString(), highestTier: profile.highestLadderTier,
        ownerLamports: map.get(owner.publicKey.toBase58())!.lamports, boards: projected };
    };
    const after = [...rows.values()];
    scenarios.push({ ...definition, operation: "claim", label: "Offline synthetic claim · " + definition.id, day, before, after, erAccounts: [],
      active: definition.variant === "missing-session" ? null : session.active, expectedActive: definition.variant === "missing-session" ? null : session.active,
      ownerDeclines: false, transaction: { partial, message: Buffer.from(tx.message.serialize()).toString("base64"), signed: Buffer.from(tx.serialize()).toString("base64"),
        ownerRequired: false, feePayer: device.publicKey.toBase58() }, amountLamports: amount.toString(), points,
      expectedBefore: await project(before), expectedAfter: await project(after) });
  }
  paths.push("client/src/backend/solana/content/dailyClient.ts", "client/src/backend/solana/content/SolanaContentBoardsLive.ts", "client/src/core/zkubeCore.ts",
    "client/src/core/generated/zkube_core_bg.wasm", "programs/solana/src/instructions/arcade_instructions.rs", "programs/solana/src/state/protocol.rs");
  const body = { schemaVersion: 1, evidenceClass: "offline-synthetic-money-claims", inputs: economy.inputs, scenarios,
    provenance: [...paths.map(path => ({ path, sha256: hash(readFileSync(resolve(repositoryRoot, path))) })),
      { path: "client/tools/unity/money-claim-fixtures.ts", sha256: hash(readFileSync(new URL(import.meta.url))) }] };
  // Product view rewards contain bigint values. Keep serialized fixture values exact.
  const normalized = JSON.parse(JSON.stringify(body, (_, value) => typeof value === "bigint" ? value.toString() : value));
  return { ...normalized, sourceSha256: hash(JSON.stringify(normalized)) };
}

export function generatedMoneyClaimData(value: Awaited<ReturnType<typeof generateMoneyClaimFixtures>>) {
  return "// Generated synthetic evidence only. Excluded from production and Store.\n#if (UNITY_EDITOR || ZKUBE_EVIDENCE) && !ZKUBE_STORE\nnamespace ZKube.Integration.App.Evidence\n{\n    internal static class MoneyClaimEvidenceData\n    {\n        internal static string Json => System.Text.Encoding.UTF8.GetString(System.Convert.FromBase64String(\"" + Buffer.from(JSON.stringify(value)).toString("base64") + "\"));\n    }\n}\n#endif\n";
}
