import { type Connection, type Keypair } from "@solana/web3.js";
import { assertDevnetRelease, requireInteger, OPERATOR_RESERVE_LAMPORTS } from "./chainRelease.js";
import { checkFreshTransaction, checkLaunchResult, checkLaunchWindow } from "./operatorState.js";
import { readBundle, rebuildTransactions, type OperatorBundle } from "./operatorPlan.js";
import { executeTransaction, fingerprint, publicTransaction } from "./operatorTransaction.js";

export async function executeBundle(source: string, options: {
  approval: string | undefined; until?: number; keeperFingerprint?: string;
  connect: (rpc: string) => Connection;
  loadSigner: (publicKey: string) => Keypair;
  persist: (bundle: OperatorBundle) => void;
}): Promise<OperatorBundle> {
  const bundle = readBundle(source);
  if (options.approval !== bundle.fingerprint) {
    throw new Error("ZKUBE_APPROVAL must match the exact bundle fingerprint before loading any keypair");
  }
  const { operation, transactions, release } = bundle.payload;
  const until = options.until ?? transactions.length - 1;
  requireInteger(until, "Last transaction index", transactions.length - 1);
  if (operation.kind === "launch" && until === transactions.length - 1 &&
      options.keeperFingerprint !== operation.input.keeperReleaseFingerprint) {
    throw new Error("Activation requires the verified staged keeper release fingerprint");
  }
  const connection = options.connect(release.rpc);
  const rebuilt = await rebuildTransactions(operation, connection);
  if (rebuilt.length !== transactions.length) throw new Error("Transaction count differs from the approved plan");
  for (const [index, item] of rebuilt.entries()) {
    const plan = transactions[index]!;
    const maximumFeeLamports = requireInteger(plan.maximumFeeLamports, "Maximum fee");
    const reserveLamports = operation.kind === "launch"
      ? (item.payer.toBase58() === operation.input.authority
        ? operation.input.authorityReserveLamports : operation.input.deployerReserveLamports) : OPERATOR_RESERVE_LAMPORTS;
    const expected = publicTransaction(item.label, item.payer, item.transaction, {
      maximumFeeLamports, maximumSpendLamports: requireInteger(item.spend + maximumFeeLamports, "Maximum spend"),
      reserveLamports: requireInteger(reserveLamports, "Payer reserve") });
    if (fingerprint(expected) !== fingerprint(plan)) throw new Error("Rebuilt transaction differs from the approved public plan");
  }
  await assertDevnetRelease(connection, release, operation.kind === "deploy");
  await checkLaunchWindow(connection, operation);
  for (let index = 0; index <= until; index++) {
    await executeTransaction({ connection, plan: transactions[index]!, existing: bundle.receipts[index],
      loadSigner: options.loadSigner,
      beforeFresh: () => checkFreshTransaction(connection, bundle, index),
      persist: receipt => { bundle.receipts[index] = receipt; options.persist(bundle); },
    });
  }
  if (until === transactions.length - 1) await checkLaunchResult(connection, operation);
  return bundle;
}
