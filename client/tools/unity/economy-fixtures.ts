import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { repositoryRoot } from "./solana-fixtures";
import { initializeZkubeCoreSync, coreRankPayoutPlan } from "../../src/core/zkubeCore";
import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import BN from "bn.js";
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { IDL } from "../../src/backend/solana/idl";
import { ZKUBE_PROGRAM_ID } from "../../src/backend/solana/constants";
import { deriveProtocolConfigPda, deriveOperatorRevenueVaultPda, deriveArenaDailyPda, deriveArenaBoardPda } from "../../src/backend/solana/pdas";
import { ARCADE_ACCOUNT_VERSION, DAILY_REWARD_CLAIM_WINDOW_SECONDS } from "../../src/core/protocolVersions.generated";
import { ARENA_BOARD_CAPACITY, buildClaimDailyPrizePlan } from "../../src/backend/solana/content/dailyClient";
import { SessionWallet } from "../../src/backend/solana/session/sessionWallet";
import { deriveSessionTokenV2Pda } from "../../src/backend/solana/session/sessionV2";
import { withPinnedWalletComputeBudget } from "../../src/backend/solana/runs/runPlan";

export async function generateEconomyFixtures() {
  initializeZkubeCoreSync(readFileSync(resolve(repositoryRoot, "client/src/core/generated/zkube_core_bg.wasm")));
  const plans = JSON.parse(readFileSync(resolve(repositoryRoot, "fixtures/unity-plans-v1.json"), "utf8"));
  const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));
  async function encode(name: string, fields: object) {
    const bytes = Buffer.alloc(coder.size(name)); (await coder.encode(name, fields)).copy(bytes); return bytes;
  }
  const envelope = (address: PublicKey, data: Buffer) => ({ address: address.toBase58(), owner: ZKUBE_PROGRAM_ID.toBase58(), executable: false, data: data.toString("base64") });
  const revenue = envelope(deriveOperatorRevenueVaultPda(), await encode("operatorRevenueVault", {
    version: ARCADE_ACCOUNT_VERSION, protocol: deriveProtocolConfigPda(), grossOperatorShare: new BN(25000000), withdrawn: new BN(0), bump: 0,
  }));
  const claimed = plans.boards.find((board: { id: string }) => board.id === "claimed");
  const daily = coder.decode("arenaDaily", Buffer.from(plans.accounts.daily.data, "base64"));
  const sourceHeader = coder.decode("arenaBoard", Buffer.from(claimed.envelope.data, "base64"));
  const pool = BigInt(sourceHeader.poolLamports.toString());
  const payout = coreRankPayoutPlan(pool, sourceHeader.qualifiedCount, ARENA_BOARD_CAPACITY);
  // A sealed prize board belongs to a finalized Daily. Its immutable ledger
  // binds both native board pools even after individual rewards are collected.
  Object.assign(daily, { dayId: claimed.day, status: { finalized: {} }, claimsExpired: false,
    scoreQualifiedPlayers: sourceHeader.qualifiedCount, themeQualifiedPlayers: sourceHeader.qualifiedCount,
    ledger: { seededLamports: new BN((pool * 2n).toString()), entryLamports: new BN(0), rolloverInLamports: new BN(0),
      payoutLamports: new BN((payout.paidLamports * 2n).toString()), rolloverOutLamports: new BN((payout.rolloverLamports * 2n).toString()) } });
  const claimDaily = envelope(deriveArenaDailyPda(claimed.day), await encode("arenaDaily", daily));
  const owner = Keypair.fromSeed(new Uint8Array(32).fill(1)), device = Keypair.fromSeed(new Uint8Array(32).fill(2));
  async function signedClaim(day: number, board: "score" | "theme") {
    const plan = await buildClaimDailyPrizePlan({ connection: { rpcEndpoint: "https://base.invalid" } as Connection, wallet: new SessionWallet(device),
    ownerAuthority: owner.publicKey, sessionToken: deriveSessionTokenV2Pda({ authority: owner.publicKey, sessionSigner: device.publicKey }).sessionToken,
    dayId: day, board, position: 0 });
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: device.publicKey, recentBlockhash: plans.inputs.blockhash,
    instructions: withPinnedWalletComputeBudget(plan.transaction.instructions) }).compileToV0Message());
    transaction.sign([device]); return Buffer.from(transaction.serialize()).toString("base64");
  }
  const oldDay = plans.inputs.day - 200;
  daily.dayId = oldDay;
  const oldDaily = envelope(deriveArenaDailyPda(oldDay), await encode("arenaDaily", daily));
  const sourceBytes = Buffer.from(plans.boards.find((board: { id: string }) => board.id === "third-score").envelope.data, "base64");
  async function oldBoard(kind: "score" | "theme", claimed: boolean) {
    const header = coder.decode("arenaBoard", sourceBytes);
    Object.assign(header, { dayId: oldDay, arenaDaily: deriveArenaDailyPda(oldDay), kind: { [kind]: {} },
      sealedAt: new BN(plans.inputs.now - (kind === "theme" ? DAILY_REWARD_CLAIM_WINDOW_SECONDS + 1 : 10)), claimedCount: claimed ? 1 : 0,
      claimedLamports: new BN(claimed ? payout.payouts[0]!.toString() : 0) });
    const tail = Buffer.from(sourceBytes.subarray(coder.size("arenaBoard"))); tail[tail.length - 1] = claimed ? 1 : 0;
    return envelope(deriveArenaBoardPda(deriveArenaDailyPda(oldDay), kind), Buffer.concat([await encode("arenaBoard", header), tail]));
  }
  return { version: 1, revenue, claimDaily, claimedBoard: claimed.envelope, claim: { day: claimed.day, kind: "score", position: 0,
    signedTransaction: await signedClaim(claimed.day, "score") }, oldDay, oldDaily, oldScore: await oldBoard("score", false),
    oldScoreClaimed: await oldBoard("score", true), oldExpiredTheme: await oldBoard("theme", false), oldScoreTransaction: await signedClaim(oldDay, "score") };
}
