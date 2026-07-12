import { PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "../../src/solana/constants";
import { deriveRunAddresses } from "../../src/solana/reboot/pdas";
import {
  buildCommitRunPlan,
  resolveRunErConnection,
} from "../../src/solana/reboot/runPlan";
import type { WalletLike } from "../../src/solana/reboot/sessionWallet";

async function main(): Promise<void> {
  const [ownerText, runIdText] = process.argv.slice(2);
  if (!ownerText || !runIdText) {
    throw new Error("usage: simulate-devnet-settlement <owner> <run-id>");
  }
  const owner = new PublicKey(ownerText);
  const runId = BigInt(runIdText);
  const addresses = deriveRunAddresses(owner, runId);
  const wallet: WalletLike = {
    publicKey: owner,
    signTransaction: async <T extends Transaction | VersionedTransaction>(transaction: T) => transaction,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(transactions: T[]) => transactions,
  };
  const erConnection = await resolveRunErConnection(addresses.activeRun);
  const activeInfo = await erConnection.getAccountInfo(addresses.activeRun, "confirmed");
  if (!activeInfo?.owner.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("Router-resolved ER does not expose a zKube-owned ActiveRun");
  }
  const plan = await buildCommitRunPlan({
    owner,
    payerWallet: wallet,
    addresses,
    erConnection,
  });
  const transaction = plan.transaction;
  transaction.feePayer = owner;
  transaction.recentBlockhash = (
    await erConnection.getLatestBlockhash("confirmed")
  ).blockhash;
  const simulation = await erConnection.simulateTransaction(transaction);
  process.stdout.write(
    `${JSON.stringify(
      {
        owner: owner.toBase58(),
        runId: runId.toString(),
        activeRun: addresses.activeRun.toBase58(),
        er: erConnection.rpcEndpoint,
        writableAccounts: transaction.instructions[0].keys
          .filter((key) => key.isWritable)
          .map((key) => key.pubkey.toBase58()),
        error: simulation.value.err,
        unitsConsumed: simulation.value.unitsConsumed,
        logs: simulation.value.logs,
      },
      null,
      2,
    )}\n`,
  );
  if (simulation.value.err) process.exitCode = 1;
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
