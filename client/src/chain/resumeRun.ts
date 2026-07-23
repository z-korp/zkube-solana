import { Connection, PublicKey } from "@solana/web3.js";
import type { RunSessionMarker } from "./runSessionStore";
import {
  isRunSessionFresh,
  loadRunSession,
  runSlotForMode,
  saveRunSession,
  type RunSlot,
} from "./runSessionStore";
import {
  fetchActiveRun,
  type ActiveRunView,
  zkubeProgram,
} from "./runPlan";
import { getDelegationStatus, type DelegationStatus } from "./router";
import type { WalletLike } from "./sessionWallet";
import { DELEGATION_PROGRAM_ID, ZKUBE_PROGRAM_ID } from "./constants";
import type { DeviceSession } from "./deviceSessionStore";
import { derivePlayerStatePda, deriveRunAddresses } from "./pdas";

export type ResumedRun =
  | { phase: "none" }
  | { phase: "missing"; marker: RunSessionMarker; sessionAuthorized: boolean }
  | {
      // Delegate confirmed on base, but the ER validator has not cloned the
      // account yet (transient cloner lag). Not a dead-end: the watcher keeps
      // polling and this heals to "delegated" once the ER catches up.
      phase: "resolving";
      marker: RunSessionMarker;
      sessionAuthorized: boolean;
    }
  | {
      phase: "base";
      marker: RunSessionMarker;
      activeRun: ActiveRunView;
      connection: Connection;
      sessionAuthorized: boolean;
    }
  | {
      // Undelegated terminal state is durably back on Solana, but canonical
      // base settlement has not consumed and closed ActiveRun yet.
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
    };

/** Compatibility result shape used only by the UI's in-memory terminal
 * snapshot. Results are never persisted in a separate on-chain account. */
export interface RunResultView {
  owner: PublicKey;
  runId: bigint;
  mode: string;
  mapId: number;
  level: number;
  score: number;
  dailyScore: number;
  pressureScore: number;
  finalPressureTier: number;
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
  fetchActiveRunId?: (
    connection: Connection,
    wallet: WalletLike,
    owner: PublicKey,
    slot: RunSlot,
  ) => Promise<bigint>;
}

export async function resolvePersistedRun(args: {
  owner: PublicKey;
  slot: RunSlot;
  wallet: WalletLike;
  baseConnection: Connection;
  /** Current device authorization used to reconstruct a missing local marker. */
  deviceSession?: DeviceSession | null;
  dependencies?: ResumeRunDependencies;
}): Promise<ResumedRun> {
  const dependencies = args.dependencies ?? {};
  let marker = loadRunSession(args.owner, args.slot);
  if (!marker && args.deviceSession) {
    marker = await discoverActiveRunMarker({
      owner: args.owner,
      slot: args.slot,
      wallet: args.wallet,
      baseConnection: args.baseConnection,
      deviceSession: args.deviceSession,
      dependencies,
    });
    if (marker) saveRunSession(marker);
  }
  if (!marker) return { phase: "none" };
  const sessionAuthorized =
    isRunSessionFresh(marker) &&
    Boolean(
      await args.baseConnection.getAccountInfo(
        marker.sessionToken,
        "confirmed",
      ),
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
    if (!erInfo) {
      // Router reports delegated, but the ER has not cloned the account yet.
      // Keep waiting rather than dead-ending.
      return { phase: "resolving", marker, sessionAuthorized };
    }
    if (!erInfo.owner.equals(ZKUBE_PROGRAM_ID)) {
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

  const activeRun = await fetchRun(
    args.baseConnection,
    args.wallet,
    marker.addresses.activeRun,
  );
  if (activeRun && matchesMarker(activeRun, marker)) {
    const terminal =
      activeRun.lifecycle === "levelComplete" ||
      activeRun.lifecycle === "finished";
    if (terminal) {
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
  // No decodable zKube ActiveRun on base. If the account exists but is owned by
  // the delegation program, the run is delegated-on-base and the router/ER is
  // still catching up — keep resolving instead of dead-ending as "missing".
  const rawActiveRun = await args.baseConnection.getAccountInfo(
    marker.addresses.activeRun,
    "confirmed",
  );
  if (rawActiveRun?.owner.equals(DELEGATION_PROGRAM_ID)) {
    return { phase: "resolving", marker, sessionAuthorized };
  }
  return { phase: "missing", marker, sessionAuthorized };
}

/**
 * Reconstructs the local run marker from the owner's durable active-run
 * pointer. The pointer is authoritative across browsers; browser storage is
 * only a cache for the current device key.
 */
async function discoverActiveRunMarker(args: {
  owner: PublicKey;
  slot: RunSlot;
  wallet: WalletLike;
  baseConnection: Connection;
  deviceSession: DeviceSession;
  dependencies?: ResumeRunDependencies;
}): Promise<RunSessionMarker | null> {
  if (!args.deviceSession.owner.equals(args.owner)) {
    throw new Error("The device session owner does not match the connected wallet");
  }
  const dependencies = args.dependencies ?? {};
  const runId = await (
    dependencies.fetchActiveRunId ?? fetchActiveRunId
  )(args.baseConnection, args.wallet, args.owner, args.slot);
  if (runId === 0n) return null;

  const addresses = deriveRunAddresses(args.owner, runId);
  const status = await (dependencies.getStatus ?? getDelegationStatus)(
    addresses.activeRun,
  );
  const fetchRun = dependencies.fetchRun ?? fetchActiveRun;
  let activeRun: ActiveRunView | null = null;
  if (status.isDelegated) {
    if (!status.fqdn) return null;
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
    const info = await connection.getAccountInfo(addresses.activeRun, "confirmed");
    if (!info) return null;
    if (!info.owner.equals(ZKUBE_PROGRAM_ID)) {
      throw new Error("The discovered ER ActiveRun is not owned by zKube");
    }
    activeRun = await fetchRun(connection, args.wallet, addresses.activeRun);
  } else {
    const info = await args.baseConnection.getAccountInfo(
      addresses.activeRun,
      "confirmed",
    );
    // A delegation-program owner with a temporarily stale Router response is
    // retried by the watcher instead of being decoded as a zKube account.
    if (info?.owner.equals(DELEGATION_PROGRAM_ID)) return null;
    if (!info) {
      throw new Error(
        `PlayerState points to missing ActiveRun ${runId.toString()}`,
      );
    }
    if (!info.owner.equals(ZKUBE_PROGRAM_ID)) {
      throw new Error("The discovered base ActiveRun is not owned by zKube");
    }
    activeRun = await fetchRun(
      args.baseConnection,
      args.wallet,
      addresses.activeRun,
    );
  }
  if (
    !activeRun ||
    !activeRun.owner.equals(args.owner) ||
    activeRun.runId !== runId
  ) {
    throw new Error("The discovered ActiveRun does not match its owner and run id");
  }
  const mode =
    activeRun.mode === "daily" || activeRun.mode === "practice"
      ? activeRun.mode
      : "campaign";
  if (runSlotForMode(mode) !== args.slot) {
    throw new Error("The discovered ActiveRun belongs to the other run slot");
  }
  return {
    owner: args.owner,
    runId,
    mode,
    session: args.deviceSession.signer,
    sessionToken: args.deviceSession.sessionToken,
    addresses,
    validUntil: args.deviceSession.validUntil,
    createdAt: args.deviceSession.createdAt,
  };
}

async function fetchActiveRunId(
  connection: Connection,
  wallet: WalletLike,
  owner: PublicKey,
  slot: RunSlot,
): Promise<bigint> {
  const profileAddress = derivePlayerStatePda(owner);
  const info = await connection.getAccountInfo(profileAddress, "confirmed");
  if (!info) return 0n;
  const program = zkubeProgram(connection, wallet);
  if (
    !info.owner.equals(ZKUBE_PROGRAM_ID) ||
    info.executable ||
    info.data.length !== program.account.playerState.size
  ) {
    throw new Error("PlayerState has an invalid owner or data length");
  }
  const profile = (await program.account.playerState.fetch(profileAddress)) as
    Awaited<ReturnType<typeof program.account.playerState.fetch>> & {
      campaignActiveRunId?: { toString(): string };
    };
  if (!profile.owner.equals(owner)) {
    throw new Error("PlayerState owner does not match the connected wallet");
  }
  const sharedRunId = BigInt(profile.activeRunId.toString());
  const mode = Object.keys(profile.activeRunMode)[0];
  const version = Number(profile.version);
  if (version === 2) {
    return slot === "campaign"
      ? mode === "campaign" ? sharedRunId : 0n
      : mode === "campaign" ? 0n : sharedRunId;
  }
  if (version !== 3) {
    throw new Error("PlayerState has an unsupported run-slot version");
  }
  if (slot === "campaign") {
    if (!profile.campaignActiveRunId) {
      throw new Error("PlayerState v3 is missing its Campaign run slot");
    }
    return BigInt(profile.campaignActiveRunId.toString());
  }
  return sharedRunId;
}

function defaultErConnection(endpoint: string): Connection {
  return new Connection(endpoint, "confirmed");
}

function matchesMarker(
  activeRun: ActiveRunView,
  marker: RunSessionMarker,
): boolean {
  return (
    activeRun.owner.equals(marker.owner) &&
    activeRun.runId === marker.runId &&
    runSlotForMode(
      activeRun.mode === "daily" || activeRun.mode === "practice"
        ? activeRun.mode
        : "campaign",
    ) === runSlotForMode(marker.mode)
  );
}
