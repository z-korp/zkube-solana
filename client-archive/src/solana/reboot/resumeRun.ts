import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { PaymasterClient } from "./paymasterClient";
import type { RunSessionMarker } from "./runSessionStore";
import { loadRunSession, saveRunSession } from "./runSessionStore";
import {
  buildRotateActiveRunSessionPlan,
  buildRotateRunShellSessionPlan,
  fetchActiveRun,
  submitSponsoredTransactionPlan,
  submitWalletTransactionPlan,
  type ActiveRunView,
  zkubeProgram,
} from "./runPlan";
import { getDelegationStatus, type DelegationStatus } from "./router";
import type { WalletLike } from "./sessionWallet";
import { ZKUBE_PROGRAM_ID } from "../constants";

export type ResumedRun =
  | { phase: "none" }
  | { phase: "missing"; marker: RunSessionMarker; sessionAuthorized: boolean }
  | {
      phase: "base";
      marker: RunSessionMarker;
      activeRun: ActiveRunView;
      connection: Connection;
      sessionAuthorized: boolean;
    }
  | {
      // Undelegated, terminal, receipt not consumed: the Magic Action never
      // ran. Settlement can be completed directly on base (no signer needed
      // for consumption) — this is the recovery path.
      phase: "settleable";
      marker: RunSessionMarker;
      activeRun: ActiveRunView;
      connection: Connection;
      sessionAuthorized: boolean;
    }
  | {
      phase: "delegated";
      marker: RunSessionMarker;
      activeRun: ActiveRunView;
      connection: Connection;
      sessionAuthorized: boolean;
    }
  | {
      phase: "settled";
      marker: RunSessionMarker;
      receipt: RunReceiptView;
      sessionAuthorized: boolean;
    };

export interface RunReceiptView {
  owner: PublicKey;
  runId: bigint;
  mode: string;
  score: number;
  moves: number;
  levelStars: number;
  completed: boolean;
  consumed: boolean;
}

export interface ResumeRunDependencies {
  getStatus?: (activeRun: PublicKey) => Promise<DelegationStatus>;
  makeErConnection?: (endpoint: string) => Connection;
  fetchRun?: (
    connection: Connection,
    wallet: WalletLike,
    activeRun: PublicKey,
  ) => Promise<ActiveRunView | null>;
  fetchReceipt?: (
    connection: Connection,
    wallet: WalletLike,
    receipt: PublicKey,
  ) => Promise<RunReceiptView | null>;
}

export async function resolvePersistedRun(args: {
  owner: PublicKey;
  wallet: WalletLike;
  baseConnection: Connection;
  dependencies?: ResumeRunDependencies;
}): Promise<ResumedRun> {
  const marker = loadRunSession(args.owner);
  if (!marker) return { phase: "none" };
  const dependencies = args.dependencies ?? {};
  const sessionAuthorized = Boolean(
    await args.baseConnection.getAccountInfo(marker.sessionToken, "confirmed"),
  );
  const status = await (dependencies.getStatus ?? getDelegationStatus)(
    marker.addresses.activeRun,
  );
  const fetchRun = dependencies.fetchRun ?? fetchActiveRun;
  if (status.isDelegated && status.fqdn) {
    if (
      status.delegationRecord &&
      status.delegationRecord.owner !== ZKUBE_PROGRAM_ID.toBase58()
    ) {
      throw new Error(
        `Delegation record owner ${status.delegationRecord.owner} does not match zKube`,
      );
    }
    const connection = (dependencies.makeErConnection ?? defaultErConnection)(
      status.fqdn,
    );
    const erInfo = await connection.getAccountInfo(
      marker.addresses.activeRun,
      "confirmed",
    );
    if (!erInfo?.owner.equals(ZKUBE_PROGRAM_ID)) {
      throw new Error(
        `Resolved ER account ${marker.addresses.activeRun.toBase58()} is not owned by zKube`,
      );
    }
    const activeRun = await fetchRun(
      connection,
      args.wallet,
      marker.addresses.activeRun,
    );
    if (!activeRun || !matchesMarker(activeRun, marker)) {
      return { phase: "missing", marker, sessionAuthorized };
    }
    return {
      phase: "delegated",
      marker,
      activeRun,
      connection,
      sessionAuthorized,
    };
  }

  const receipt = await (dependencies.fetchReceipt ?? fetchReceipt)(
    args.baseConnection,
    args.wallet,
    marker.addresses.runReceipt,
  );
  if (
    receipt?.consumed &&
    receipt.owner.equals(marker.owner) &&
    receipt.runId === marker.runId
  ) {
    return { phase: "settled", marker, receipt, sessionAuthorized };
  }
  const activeRun = await fetchRun(
    args.baseConnection,
    args.wallet,
    marker.addresses.activeRun,
  );
  if (activeRun && matchesMarker(activeRun, marker)) {
    const terminal =
      activeRun.lifecycle === "levelComplete" ||
      activeRun.lifecycle === "finished";
    if (terminal && !receipt?.consumed) {
      return {
        phase: "settleable",
        marker,
        activeRun,
        connection: args.baseConnection,
        sessionAuthorized,
      };
    }
    return {
      phase: "base",
      marker,
      activeRun,
      connection: args.baseConnection,
      sessionAuthorized,
    };
  }
  return { phase: "missing", marker, sessionAuthorized };
}

export async function recoverDelegatedRunSession(args: {
  run: Extract<ResumedRun, { phase: "delegated" }>;
  wallet: WalletLike;
  paymaster: PaymasterClient;
}): Promise<RunSessionMarker> {
  const newSession = Keypair.generate();
  const basePlan = await buildRotateRunShellSessionPlan({
    wallet: args.wallet,
    runId: args.run.marker.runId,
    addresses: args.run.marker.addresses,
    newSession,
    paymaster: args.paymaster.pubkey,
  });
  const baseSignature = await submitSponsoredTransactionPlan({
    transactionPlan: basePlan.transactionPlan,
    wallet: args.wallet,
    paymaster: args.paymaster,
  });
  await basePlan.transactionPlan.connection.confirmTransaction(
    baseSignature,
    "confirmed",
  );
  const erPlan = await buildRotateActiveRunSessionPlan({
    wallet: args.wallet,
    activeRun: args.run.marker.addresses.activeRun,
    newSession: newSession.publicKey,
    erConnection: args.run.connection,
  });
  await submitWalletTransactionPlan({
    transactionPlan: erPlan,
    wallet: args.wallet,
  });
  const marker: RunSessionMarker = {
    ...args.run.marker,
    session: newSession,
    sessionToken: basePlan.sessionToken,
    validUntil: basePlan.sessionValidUntil,
    createdAt: Math.floor(Date.now() / 1_000),
  };
  saveRunSession(marker);
  return marker;
}

export async function fetchReceipt(
  connection: Connection,
  wallet: WalletLike,
  receiptAddress: PublicKey,
): Promise<RunReceiptView | null> {
  const receipt = await zkubeProgram(
    connection,
    wallet,
  ).account.runReceipt.fetchNullable(receiptAddress);
  if (!receipt) return null;
  return {
    owner: receipt.owner,
    runId: BigInt(receipt.runId.toString()),
    mode: Object.keys(receipt.mode)[0] ?? "unknown",
    score: Number(receipt.score),
    moves: Number(receipt.moves),
    levelStars: Number(receipt.levelStars),
    completed: Boolean(receipt.completed),
    consumed: Boolean(receipt.consumed),
  };
}

function defaultErConnection(endpoint: string): Connection {
  return new Connection(endpoint, "confirmed");
}

function matchesMarker(
  activeRun: ActiveRunView,
  marker: RunSessionMarker,
): boolean {
  return (
    activeRun.owner.equals(marker.owner) && activeRun.runId === marker.runId
  );
}
