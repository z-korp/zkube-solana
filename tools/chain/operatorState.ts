import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import { dayIdAt, dailyWindow, scheduledDailyWindow } from "../../services/src/zkubeCore.js";
import { ZKUBE_PROGRAM_ID } from "../../shared/chain.js";
import { CADENCE_FUNDING_SEED_LAMPORTS, LAUNCH_DAILY_SEED_LAMPORTS } from "./adminClient.js";
import { accountCoder, chainTime, readAccount, programDataAddress } from "./chainRelease.js";
import { deriveArenaDailyPda, deriveCadenceFundingPda, deriveCreditVaultPda, deriveProtocolConfigPda } from "./pdas.js";
import { type Operation, type OperatorBundle } from "./operatorPlan.js";

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
  const protocol = await readGovernance(connection, authority, launchDayId);
  const now = await chainTime(connection);
  const window = scheduledDailyWindow(dayIdAt(BigInt(now)), protocol.suspendedUntilDay);
  const deposits = [];
  for (const request of requested) {
    const dayId = request.selector === "current" ? window.first : request.selector === "following"
      ? window.following : Number(request.selector);
    if (dayId !== window.first && dayId !== window.following) throw new Error("Top-up targets the current or following scheduled Daily");
    const { value } = await readAccount(connection, "arenaDaily", deriveArenaDailyPda(dayId));
    if (value.dayId !== dayId || !("funding" in value.status || "open" in value.status) ||
        now >= dailyWindow(dayId).runsCloseAt) throw new Error("Top-up Daily is not open for funding");
    const seededBefore = value.ledger.seededLamports.toString();
    if (BigInt(seededBefore) + BigInt(request.lamports) > 0xffff_ffff_ffff_ffffn) throw new Error("Seeded ledger would overflow");
    deposits.push({ dayId, lamports: request.lamports, seededBefore });
  }
  return deposits;
}

export async function checkFreshTransaction(connection: Connection, bundle: OperatorBundle, index: number): Promise<void> {
  const operation = bundle.payload.operation;
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
    await readGovernance(connection, operation.authority, operation.launchDayId);
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
  for (const dayId of [input.launchDayId, input.launchDayId + 1]) {
    const { value } = await readAccount(connection, "arenaDaily", deriveArenaDailyPda(dayId));
    const ledger = value.ledger;
    if (value.dayId !== dayId || !("funding" in value.status) || value.predecessorRolloverApplied ||
        [ledger.seededLamports, ledger.entryLamports, ledger.rolloverInLamports,
          ledger.payoutLamports, ledger.rolloverOutLamports].some(amount => !amount.isZero())) {
      throw new Error("Staged Daily differs from the approved launch");
    }
  }
  const funding = await connection.getAccountInfo(deriveCadenceFundingPda(), "confirmed");
  const rent = await connection.getMinimumBalanceForRentExemption(accountCoder.size("arenaDaily"), "confirmed");
  if (!funding || funding.executable || !funding.owner.equals(SystemProgram.programId) || funding.data.length ||
      funding.lamports !== CADENCE_FUNDING_SEED_LAMPORTS - 2 * rent) throw new Error("Staged cadence funding differs from approval");
}

export async function checkLaunchResult(connection: Connection, operation: Operation): Promise<void> {
  if (operation.kind !== "launch") return;
  const protocol = await readGovernance(connection, operation.input.authority, operation.input.launchDayId);
  const { value } = await readAccount(connection, "arenaDaily", deriveArenaDailyPda(operation.input.launchDayId));
  if (protocol.paused || !("open" in value.status) ||
      value.ledger.seededLamports.toString() !== String(LAUNCH_DAILY_SEED_LAMPORTS)) {
    throw new Error("The approved launch did not become active");
  }
}
