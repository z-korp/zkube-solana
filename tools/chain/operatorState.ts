import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { dayIdAt, dailyWindow } from "../../services/src/zkubeCore.js";
import { ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { CADENCE_FUNDING_SEED_LAMPORTS, LAUNCH_DAILY_SEED_LAMPORTS } from "./adminClient.js";
import { assertDevnetRelease, chainTime, readAccount, programDataAddress, type ReleaseBinding } from "./chainRelease.js";
import { deriveArenaDailyPda, deriveCadenceFundingPda, deriveCreditVaultPda, deriveProtocolConfigPda } from "./pdas.js";
import { type Operation, type OperatorBundle } from "./operatorPlan.js";

/** How long a signed transaction can still land: its blockhash lives about 150 slots. */
export const LANDING_SECONDS = 120;

export type DailyRulesHash = (dayId: number) => string;
/** The rules hash this checkout's program gives a Daily it prepares for that day (programs/solana/examples/daily-rules-hash.rs). */
export const preparedRulesHash: DailyRulesHash = dayId => execFileSync("cargo",
  ["run", "-q", "--offline", "--locked", "-p", "solana", "--example", "daily-rules-hash", "--", String(dayId)],
  { encoding: "utf8", cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Before an upgrade lands ProgramData holds what the plan replaces; afterwards it holds the release. Nothing else passes. */
export async function assertUpgradeRelease(connection: Connection, release: ReleaseBinding,
  deployed: { programDataSha256: string; allocationBytes: number }): Promise<void> {
  try { await assertDevnetRelease(connection, { ...release, ...deployed }); }
  catch { await assertDevnetRelease(connection, release); }
}

/**
 * Preparing a Daily stores a rules hash made from the realm table, and each
 * entry takes the realm's rules from that table again. New program bytes may
 * therefore land only while no entry can be made: every day the transaction
 * could land on is suspended. A day that has not opened has no Daily yet, so
 * whatever is prepared afterwards is prepared by the new program.
 */
export async function requireNoEntryWhileUpgrading(connection: Connection): Promise<void> {
  const { value } = await readAccount(connection, "protocolConfig", deriveProtocolConfigPda());
  const now = await chainTime(connection);
  for (const at of [now, now + LANDING_SECONDS]) {
    const day = dayIdAt(BigInt(at));
    if (day >= value.suspendedUntilDay) {
      throw new Error(`Day ${day} is not suspended: an entry could reach a Daily prepared by the program this upgrade replaces`);
    }
  }
}

export async function checkLaunchWindow(connection: Connection, operation: Operation): Promise<void> {
  if (operation.kind === "launch" && await chainTime(connection) > operation.input.launchCutoffUnixTimestamp) {
    throw new Error("The approved launch cutoff has expired");
  }
}

export async function readGovernance(connection: Connection, authority: string, launchDayId?: number) {
  const { value } = await readAccount(connection, "protocolConfig", deriveProtocolConfigPda());
  if (value.authority.toBase58() !== authority || (launchDayId !== undefined && value.launchDayId !== launchDayId)) {
    throw new Error("Protocol authority or launch day differs from the launch bundle");
  }
  return value;
}

export async function observeDeposits(connection: Connection, authority: string, launchDayId: number,
  requested: Array<{ selector: string; lamports: string }>) {
  await readGovernance(connection, authority, launchDayId);
  const now = await chainTime(connection);
  // A deposit joins the pot of the day it is made on: today's Daily, which
  // exists once someone has entered it or prepared it.
  const today = dayIdAt(BigInt(now));
  const deposits = [];
  for (const request of requested) {
    const dayId = request.selector === "current" ? today : Number(request.selector);
    if (dayId !== today) throw new Error("Top-up targets today's Daily");
    const { value } = await readAccount(connection, "arenaDaily", deriveArenaDailyPda(dayId));
    if (value.dayId !== dayId || !value.finalizedAt.isZero() ||
        now >= dailyWindow(dayId).runsCloseAt) throw new Error("Top-up Daily is not open for funding");
    const seededBefore = value.ledger.seededLamports.toString();
    if (BigInt(seededBefore) + BigInt(request.lamports) > 0xffff_ffff_ffff_ffffn) throw new Error("Seeded ledger would overflow");
    deposits.push({ dayId, lamports: request.lamports, seededBefore });
  }
  return deposits;
}

export async function checkFreshTransaction(connection: Connection, bundle: OperatorBundle, index: number,
  rulesHash: DailyRulesHash = preparedRulesHash): Promise<void> {
  const operation = bundle.payload.operation;
  if (operation.kind === "upgrade") {
    const last = bundle.payload.transactions.length - 1;
    if (index !== 0 && index !== last) return;
    // The program is still exactly what the plan replaces.
    await assertDevnetRelease(connection, { ...bundle.payload.release, ...operation.input.deployed });
    if (index === last) return requireNoEntryWhileUpgrading(connection);
    if (await connection.getAccountInfo(new PublicKey(operation.input.buffer), "confirmed")) {
      throw new Error("Upgrade buffer address is occupied");
    }
    return;
  }
  if (operation.kind === "deploy") {
    if (index === 0) {
      const accounts = await connection.getMultipleAccountsInfo([
        new PublicKey(operation.input.buffer), ZKUBE_PROGRAM_ID, programDataAddress()], "confirmed");
      if (accounts.some(Boolean)) throw new Error("Fresh deployment addresses are occupied");
    }
    return;
  }
  if (operation.kind === "top-up") {
    const observed = await observeDeposits(connection, operation.authority, operation.launchDayId,
      operation.deposits.map(deposit => ({ selector: String(deposit.dayId), lamports: deposit.lamports })));
    if (JSON.stringify(observed) !== JSON.stringify(operation.deposits)) throw new Error("Seeded balances changed after approval");
    return;
  }
  if (operation.kind === "set-suspension") {
    const protocol = await readGovernance(connection, operation.authority, operation.launchDayId);
    // Lifting today's suspension lets entries reach today's Daily. If the
    // program was upgraded today, a Daily the replaced program prepared keeps
    // its hash while new runs would take the new rules: that day stays
    // suspended. A program deployed on an earlier day prepared every Daily of
    // today itself.
    const today = dayIdAt(BigInt(await chainTime(connection)));
    if (today < protocol.suspendedUntilDay && operation.untilDay <= today) {
      const data = await connection.getAccountInfo(programDataAddress(), "confirmed");
      // A slot too recent for the endpoint to date counts as today.
      const deployedAt = data && await connection.getBlockTime(Number(data.data.readBigUInt64LE(4))).catch(() => null);
      if ((!deployedAt || dayIdAt(BigInt(deployedAt)) >= today) &&
          await connection.getAccountInfo(deriveArenaDailyPda(today), "confirmed")) {
        const { value } = await readAccount(connection, "arenaDaily", deriveArenaDailyPda(today));
        if (Buffer.from(value.rulesHash).toString("hex") !== rulesHash(today)) {
          throw new Error(`Day ${today}'s Daily was prepared under another catalogue; leave the day suspended`);
        }
      }
    }
    return;
  }
  await checkLaunchWindow(connection, operation);
  if (index !== bundle.payload.transactions.length - 1) return;
  const { input } = operation;
  const protocol = await readGovernance(connection, input.authority, 0);
  if (!protocol.paused || protocol.teamDestination.toBase58() !== input.teamDestination ||
      Buffer.from(protocol.replayDomain).toString("hex") !== input.replayDomainHex ||
      protocol.lastDailyId !== 0 || Buffer.from(protocol.dailyRoot).some(byte => byte !== 0)) {
    throw new Error("Staged protocol differs from the approved launch");
  }
  const vault = await readAccount(connection, "creditVault", deriveCreditVaultPda());
  if (!vault.value.availablePrizeLamports.isZero()) throw new Error("Staged Kredit vault is not empty");
  // The launch Daily is prepared by the launch transaction itself: nothing is staged for it.
  if (await connection.getAccountInfo(deriveArenaDailyPda(input.launchDayId), "confirmed")) {
    throw new Error("The launch Daily already exists");
  }
  const funding = await connection.getAccountInfo(deriveCadenceFundingPda(), "confirmed");
  if (!funding || funding.executable || !funding.owner.equals(SystemProgram.programId) || funding.data.length ||
      funding.lamports !== CADENCE_FUNDING_SEED_LAMPORTS) throw new Error("Staged cadence funding differs from approval");
}

export async function checkLaunchResult(connection: Connection, operation: Operation): Promise<void> {
  if (operation.kind !== "launch") return;
  const protocol = await readGovernance(connection, operation.input.authority, operation.input.launchDayId);
  const { value } = await readAccount(connection, "arenaDaily", deriveArenaDailyPda(operation.input.launchDayId));
  if (protocol.paused || !value.predecessorRolloverApplied || !value.finalizedAt.isZero() ||
      value.ledger.seededLamports.toString() !== String(LAUNCH_DAILY_SEED_LAMPORTS)) {
    throw new Error("The approved launch did not become active");
  }
}
