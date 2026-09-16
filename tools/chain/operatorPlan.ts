import { PublicKey, Transaction, type Connection } from "@solana/web3.js";
import { buildDepositArenaDailyPlan, buildSetArenaSuspensionPlan, CADENCE_FUNDING_SEED_LAMPORTS, LAUNCH_DAILY_SEED_LAMPORTS } from "./adminClient.js";
import { quoteLaunchCosts, launchTransactionPlans, buildFundingPlan, type LaunchPlannerInput, type LaunchSettings, type LaunchCostPlan } from "./launchPlanner.js";
import { deploymentTransactions, type DeploymentInput, type PlannedTransaction } from "./deploymentPlan.js";
import { type ReleaseBinding, requireInteger, OPERATOR_RESERVE_LAMPORTS } from "./chainRelease.js";
import { createReadOnlyWallet } from "./readOnlyWallet.js";
import { fingerprint, publicTransaction, transactionMessage,
  type PublicTransaction, type TransactionReceipt } from "./operatorTransaction.js";

export type Operation =
  | { kind: "deploy"; input: DeploymentInput }
  | { kind: "launch"; input: LaunchSettings; costs: LaunchCostPlan }
  | { kind: "top-up"; authority: string; launchDayId: number;
      deposits: Array<{ dayId: number; lamports: string; seededBefore: string }> }
  | { kind: "set-suspension"; authority: string; launchDayId: number; untilDay: number };

export interface OperatorBundle {
  schema: "zkube-operator-v1";
  payload: { release: ReleaseBinding; operation: Operation; transactions: PublicTransaction[] };
  fingerprint: string;
  receipts: Record<number, TransactionReceipt>;
}

export async function rebuildTransactions(operation: Operation, connection: Connection): Promise<PlannedTransaction[]> {
  if (operation.kind === "deploy") return deploymentTransactions(operation.input);
  if (operation.kind === "launch") {
    const { input, costs } = operation;
    const result: PlannedTransaction[] = [];
    const funding = buildFundingPlan({ deployer: new PublicKey(input.deployer),
      authority: new PublicKey(input.authority), teamDestination: new PublicKey(input.teamDestination),
      authorityFundingLamports: costs.authorityFundingLamports, teamFundingLamports: costs.teamFundingLamports });
    if (funding) result.push({ label: funding.label, payer: funding.feePayer, transaction: funding.transaction,
      spend: costs.authorityFundingLamports + costs.teamFundingLamports });
    const plans = await launchTransactionPlans(input, connection);
    const spends = [costs.accountRentLamports, CADENCE_FUNDING_SEED_LAMPORTS, 0, 0, LAUNCH_DAILY_SEED_LAMPORTS];
    result.push(...plans.map((plan, index) => ({ label: plan.label, payer: plan.feePayer,
      transaction: plan.transaction, spend: spends[index]! })));
    return result;
  }
  const authority = createReadOnlyWallet(new PublicKey(operation.authority));
  if (operation.kind === "set-suspension") {
    const plan = await buildSetArenaSuspensionPlan({ connection, authority, untilDay: operation.untilDay });
    return [{ label: plan.label, payer: plan.feePayer, transaction: plan.transaction, spend: 0 }];
  }
  if (operation.deposits.length < 1 || operation.deposits.length > 6) throw new Error("Top-up needs one to six deposits");
  const transaction = new Transaction();
  let spend = 0n;
  const days = new Set<number>();
  for (const deposit of operation.deposits) {
    if (days.has(deposit.dayId)) throw new Error("Combine duplicate Daily deposits before planning");
    days.add(deposit.dayId);
    const lamports = BigInt(deposit.lamports);
    const plan = await buildDepositArenaDailyPlan({ connection, authority, pool: "daily", cadenceId: deposit.dayId, lamports });
    transaction.add(...plan.transaction.instructions);
    spend += lamports;
  }
  return [{ label: "Top up Daily prize pools", payer: authority.publicKey, transaction,
    spend: requireInteger(Number(spend), "Top-up spend") }];
}

export async function quoteBundle(operation: Operation, release: ReleaseBinding, connection: Connection): Promise<OperatorBundle> {
  const rebuilt = await rebuildTransactions(operation, connection);
  const latest = await connection.getLatestBlockhash("confirmed");
  const feeBySignatures = new Map<number, number>();
  const transactions: PublicTransaction[] = [];
  for (const item of rebuilt) {
    const reserveLamports = operation.kind === "launch"
      ? (item.payer.toBase58() === operation.input.authority
        ? operation.input.authorityReserveLamports : operation.input.deployerReserveLamports) : OPERATOR_RESERVE_LAMPORTS;
    const plan = publicTransaction(item.label, item.payer, item.transaction,
      { maximumFeeLamports: 0, maximumSpendLamports: item.spend, reserveLamports });
    const message = transactionMessage(plan, latest.blockhash);
    if (message.serialize().length + 1 + 64 * message.header.numRequiredSignatures > 1232) {
      throw new Error("Planned transaction exceeds the Solana packet bound");
    }
    const signatures = message.header.numRequiredSignatures;
    const fee = feeBySignatures.get(signatures) ?? (await connection.getFeeForMessage(message, "confirmed")).value;
    if (fee === null || !Number.isSafeInteger(fee) || fee <= 0) throw new Error("Unable to quote the transaction fee");
    feeBySignatures.set(signatures, fee);
    plan.maximumFeeLamports = fee;
    plan.maximumSpendLamports = requireInteger(item.spend + fee, "Maximum spend");
    transactions.push(plan);
  }
  if (operation.kind !== "launch") {
    const payer = new PublicKey(transactions[0]!.payer);
    const total = transactions.reduce((sum, plan) => requireInteger(sum + plan.maximumSpendLamports, "Total spend"), 0);
    if (await connection.getBalance(payer, "confirmed") < total + transactions[0]!.reserveLamports) {
      throw new Error("Payer balance is below total approved spend and reserve");
    }
  }
  const payload = { release, operation, transactions };
  return { schema: "zkube-operator-v1", payload, fingerprint: fingerprint(payload), receipts: {} };
}

export async function quoteLaunch(input: LaunchPlannerInput, connection: Connection): Promise<OperatorBundle> {
  const costs = await quoteLaunchCosts(input, connection);
  const settings: LaunchSettings = { authority: input.authority, deployer: input.deployer,
    teamDestination: input.teamDestination, replayDomainHex: input.replayDomainHex,
    launchDayId: input.launchDayId, launchCutoffUnixTimestamp: input.launchCutoffUnixTimestamp,
    keeperReleaseFingerprint: input.keeperReleaseFingerprint, authorityReserveLamports: input.authorityReserveLamports,
    deployerReserveLamports: input.deployerReserveLamports };
  return quoteBundle({ kind: "launch", input: settings, costs }, {
    rpc: input.baseRpc, programDataSha256: input.deployedProgramDataSha256,
    allocationBytes: input.programAllocationBytes, upgradeAuthority: input.programUpgradeAuthority }, connection);
}

export function readBundle(source: string): OperatorBundle {
  const bundle: OperatorBundle = JSON.parse(source);
  if (bundle.schema !== "zkube-operator-v1" || !bundle.payload ||
      !/^[0-9a-f]{64}$/.test(bundle.fingerprint) || fingerprint(bundle.payload) !== bundle.fingerprint ||
      !Array.isArray(bundle.payload.transactions) || !bundle.payload.transactions.length ||
      !bundle.receipts || Array.isArray(bundle.receipts)) throw new Error("Operator bundle fingerprint or shape is invalid");
  for (const [index, receipt] of Object.entries(bundle.receipts)) {
    if (!/^\d+$/.test(index) || Number(index) >= bundle.payload.transactions.length || !receipt) {
      throw new Error("Receipt index is outside the approved plan");
    }
  }
  return bundle;
}
