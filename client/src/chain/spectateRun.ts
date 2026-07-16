import { Connection, PublicKey } from "@solana/web3.js";
import { INITIAL_RUN_ID, ZKUBE_PROGRAM_ID } from "./constants";
import { derivePlayerStatePda, deriveRunAddresses } from "./pdas";
import { createReadOnlyWallet } from "./readOnlyWallet";
import { getDelegationStatus } from "./router";
import {
  fetchActiveRun,
  zkubeProgram,
  type ActiveRunView,
} from "./runPlan";
const READ_ONLY_WALLET = createReadOnlyWallet();

export interface SpectateTarget {
  /** Direct ActiveRun PDA. */
  pda?: PublicKey;
  /** Run owner; latest run is resolved from their PlayerState. */
  player?: PublicKey;
  /** Explicit run id (only meaningful with `player`). */
  runId?: bigint;
}

export type SpectatedRun =
  | { phase: "not-found" }
  | { phase: "archived"; runId: bigint }
  | {
      phase: "delegated" | "base";
      activeRun: ActiveRunView;
      connection: Connection;
      activeRunPda: PublicKey;
    };

export interface SpectateRunDependencies {
  getStatus?: typeof getDelegationStatus;
  makeErConnection?: (endpoint: string) => Connection;
  fetchRun?: typeof fetchActiveRun;
  fetchNextRunId?: (
    connection: Connection,
    player: PublicKey,
  ) => Promise<bigint | null>;
}

export async function resolveSpectatedRun(args: {
  baseConnection: Connection;
  target: SpectateTarget;
  dependencies?: SpectateRunDependencies;
}): Promise<SpectatedRun> {
  const deps = args.dependencies ?? {};
  const resolved = await resolveAddresses(args.baseConnection, args.target, deps);
  if (!resolved) return { phase: "not-found" };
  const { activeRunPda } = resolved;

  // Delegation status FIRST: while delegated the base-layer account still
  // decodes but is stale — the ER copy is the authoritative one.
  const status = await (deps.getStatus ?? getDelegationStatus)(activeRunPda);
  if (status.isDelegated && status.fqdn) {
    if (
      status.delegationRecord &&
      status.delegationRecord.owner !== ZKUBE_PROGRAM_ID.toBase58()
    ) {
      throw new Error(
        `Delegation record owner ${status.delegationRecord.owner} does not match zKube`,
      );
    }
    const erConnection = (deps.makeErConnection ?? defaultErConnection)(
      status.fqdn,
    );
    const erInfo = await erConnection.getAccountInfo(activeRunPda, "confirmed");
    if (!erInfo?.owner.equals(ZKUBE_PROGRAM_ID)) {
      throw new Error(
        `Resolved ER account ${activeRunPda.toBase58()} is not owned by zKube`,
      );
    }
    const activeRun = await (deps.fetchRun ?? fetchActiveRun)(
      erConnection,
      READ_ONLY_WALLET,
      activeRunPda,
    );
    if (!activeRun) return { phase: "not-found" };
    return {
      phase: "delegated",
      activeRun,
      connection: erConnection,
      activeRunPda,
    };
  }

  const activeRun = await (deps.fetchRun ?? fetchActiveRun)(
    args.baseConnection,
    READ_ONLY_WALLET,
    activeRunPda,
  );
  if (!activeRun) {
    // A player-resolved run whose account no longer exists was atomically
    // consumed and closed after its terminal state copied back from the ER.
    if (resolved.resolvedRunId !== null) {
      return { phase: "archived", runId: resolved.resolvedRunId };
    }
    return { phase: "not-found" };
  }
  return {
    phase: "base",
    activeRun,
    connection: args.baseConnection,
    activeRunPda,
  };
}

async function resolveAddresses(
  connection: Connection,
  target: SpectateTarget,
  deps: SpectateRunDependencies,
): Promise<{
  activeRunPda: PublicKey;
  resolvedRunId: bigint | null;
} | null> {
  if (target.pda) {
    // A bare PDA has no owner/runId context for archived-result discovery.
    return { activeRunPda: target.pda, resolvedRunId: null };
  }
  if (!target.player) return null;
  let runId = target.runId;
  if (runId === undefined) {
    const nextRunId = await (deps.fetchNextRunId ?? defaultFetchNextRunId)(
      connection,
      target.player,
    );
    if (nextRunId === null || nextRunId <= INITIAL_RUN_ID) return null;
    runId = nextRunId - 1n;
  }
  const addresses = deriveRunAddresses(target.player, runId);
  return {
    activeRunPda: addresses.activeRun,
    resolvedRunId: runId,
  };
}

async function defaultFetchNextRunId(
  connection: Connection,
  player: PublicKey,
): Promise<bigint | null> {
  const profile = await zkubeProgram(
    connection,
    READ_ONLY_WALLET,
  ).account.playerState.fetchNullable(derivePlayerStatePda(player));
  if (!profile) return null;
  return BigInt(profile.nextRunId.toString());
}

function defaultErConnection(endpoint: string): Connection {
  return new Connection(endpoint, "confirmed");
}
