import { IDL } from "../../tools/chain/idl/index.js";

import {
  BorshAccountsCoder,
  BorshInstructionCoder,
  convertIdlToCamelCase,
  type Idl,
} from "@anchor-lang/core";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";

import {
  KEEPER_PLAN_INSTRUCTION,
  KEEPER_RECENT_DAILY_CADENCES,
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
  ZKUBE_PROGRAM_ID,
  activeRunPda,
  arenaDailyPda,
  arenaBoardPda,
  arenaPlayerPda,
  assertCadenceId,
  currentDayId,
  cadenceFundingPda,
  playerStatePda,
  protocolPda,
  type KeeperOperation,
  type KeeperPlanContext,
} from "./arcadeChain.js";
import { dailyWindow } from "./zkubeCore.js";
import {
  type DailySnapshot,
  type ProtocolSnapshot,
  type RunLifecycle,
  type RunSnapshot,
  type ClosedArenaPlayerSnapshot,
} from "./arcadeReconciliation.js";
import { type ProtocolInstructionMaterializer } from "./arcadeChain.js";
import { getDelegationStatus } from "./router.js";

const MAX_PROGRAM_ACCOUNT_BYTES = 129_538;
const MAX_RPC_ACCOUNT_BATCH = 100;
interface RemainingAccountMeta {
  pubkey: PublicKey;
  isWritable: boolean;
}

interface LoadedAccount {
  address: PublicKey;
  account: AccountInfo<Buffer>;
  value: Record<string, unknown>;
}

interface LoadedDaily {
  loaded: LoadedAccount;
  snapshot: DailySnapshot;
}

interface PlayerStateRecord {
  address: PublicKey;
  owner: PublicKey;
  activeRunId: bigint;
  activeRunDaily: PublicKey;
  activeRunDeadlineAt: number;
  orphanRunId: bigint;
}

export interface AnchorKeeperAdapterInput {
  connection: Connection;
  nowUnix: number;
  routerEndpoint?: string;
  fetcher?: typeof fetch;
  connectionFactory?: (endpoint: string) => Connection;
  launchDayId: number;
  /**
   * Addresses a complete read model names, read here from the chain. Absent,
   * the adapter scans the program's accounts instead.
   */
  discovery?: { arenaPlayers: readonly PublicKey[]; runOwners: readonly PublicKey[] };
}

export type KeeperLaunchState = "staged_launch_ready" | "active";

/** Exact checked-in Anchor IDL decoder and instruction materializer. */
export class AnchorKeeperAdapter implements ProtocolInstructionMaterializer {
  /** How the last snapshot found accounts: from verified hints, or by scanning the chain. */
  discovered: "read_model" | "scan" = "scan";
  private readonly accountsCoder: BorshAccountsCoder;
  private readonly instructionCoder: BorshInstructionCoder;

  private constructor(
    private readonly input: AnchorKeeperAdapterInput,
    private readonly idl: Idl,
  ) {
    this.accountsCoder = new BorshAccountsCoder(idl);
    this.instructionCoder = new BorshInstructionCoder(idl);

  }

  static async create(input: AnchorKeeperAdapterInput): Promise<AnchorKeeperAdapter> {
    // The interface is the build's own: the generated IDL is compiled in, so
    // the adapter reads no file and runs the same on Node and in the Worker.
    const parsed: unknown = IDL;
    if (!isRecord(parsed) || parsed.address !== ZKUBE_PROGRAM_ID.toBase58()) {
      throw new Error("checked-in Anchor IDL program address is not the pinned zKube program");
    }
    return new AnchorKeeperAdapter(
      input,
      convertIdlToCamelCase(parsed as Idl),
    );
  }

  async loadProtocolSnapshot(): Promise<ProtocolSnapshot> {
    const protocol = await this.loadRequired(
      "protocolConfig",
      protocolPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const launchDayId = u32(protocol.value.launchDayId, "launch day id");
    this.requireReleaseLaunchDay(launchDayId);
    const suspendedUntilDay = u32(
      protocol.value.suspendedUntilDay,
      "suspended-until day",
    );
    const paused = boolean(protocol.value.paused, "protocol pause state");

    const today = currentDayId(this.input.nowUnix);
    const firstDay = Math.max(launchDayId, today - KEEPER_RECENT_DAILY_CADENCES);
    // A Daily exists only for a day somebody entered, so most of these
    // addresses are empty. The last is the one day that can be prepared now.
    const dailyIds = [...new Set([...range(firstDay, today), today])];
    const dailies = await this.loadDailies(dailyIds);
    const discover = async (hints: AnchorKeeperAdapterInput["discovery"]) => {
      const { closable, entered } = await this.loadArenaPlayers(dailies, hints);
      return { closable, runs: await this.loadRuns(await this.loadPlayerStates(entered, hints), dailies) };
    };
    let found = await discover(this.input.discovery);
    this.discovered = this.input.discovery ? "read_model" : "scan";
    // A hint is never proof of absence. Each Daily counts its own unresolved
    // paid entries, and each of those is one run in flight: if the hints
    // reach fewer, something was entered out of their sight, and the chain
    // is scanned instead.
    if (this.input.discovery && dailies.some(({ snapshot }) =>
      snapshot.entriesPaid - snapshot.entriesScored - snapshot.entriesExpired >
        BigInt(found.runs.filter((run) => run.reservationActive && run.dayId === snapshot.dayId).length))) {
      found = await discover(undefined);
      this.discovered = "scan";
    }
    const { closable: closedArenaPlayers, runs } = found;
    return {
      paused,
      launchDayId,
      suspendedUntilDay,
      lastPreparedDay: u32(protocol.value.lastPreparedDay, "last prepared day"),
      dailies: dailies.map(({ snapshot }) => snapshot),
      runs,
      closedArenaPlayers,
    };
  }

  /** Read-only verification gate for the paused carrier before launch seed. */
  async inspectLaunchState(): Promise<KeeperLaunchState> {
    const protocol = await this.loadRequired(
      "protocolConfig",
      protocolPda(),
      PROTOCOL_ACCOUNT_VERSION,
    );

    if (u32(protocol.value.launchDayId, "launch day id") > 0) {
      this.requireReleaseLaunchDay(u32(protocol.value.launchDayId, "launch day id"));
      return "active";
    }
    if (!boolean(protocol.value.paused, "protocol pause state") ||
        u32(protocol.value.launchDayId, "launch day id") !== 0) {
      throw new Error("paused launch carrier is incomplete or active");
    }

    // The launch transaction prepares its own Daily: a staged protocol has none.
    if (await this.input.connection.getAccountInfo(arenaDailyPda(this.input.launchDayId), "confirmed")) {
      throw new Error("paused launch carrier is incomplete or active");
    }
    return "staged_launch_ready";
  }

  private requireReleaseLaunchDay(launchDayId: number): void {
    if (launchDayId !== this.input.launchDayId) {
      throw new Error("Arcade launch day does not match keeper release");
    }
  }

  async materialize(input: {
    operation: KeeperOperation; context: KeeperPlanContext; keeper: PublicKey;
  }): Promise<readonly TransactionInstruction[]> {
    const definition = KEEPER_PLAN_INSTRUCTION[input.operation];
    if (!definition) throw new Error("keeper materializer operation is outside the exact allowlist");
    const name = definition.instruction.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    const { context: c, keeper } = input;
    const daily = () => arenaDailyPda(requiredNumber(c.dayId, "day id"));
    const following = () => arenaDailyPda(requiredNumber(c.followingDayId, "following day id"));
    const owner = () => requiredOwner(c.owner);
    const activeRun = () => activeRunPda(owner(), requiredRunId(c.runId));
    const boards = () => ({ arenaDaily: daily(), scoreBoard: arenaBoardPda(daily(), "score"),
      themeBoard: arenaBoardPda(daily(), "theme") });
    const cadenceFunding = cadenceFundingPda(), protocol = protocolPda(), systemProgram = SystemProgram.programId;
    let accounts: Record<string, PublicKey>;
    let args: Record<string, unknown> = {};
    const remaining: RemainingAccountMeta[] = [];
    switch (input.operation) {
      case "prepare_arena_daily":
        accounts = { caller: keeper, protocol, ...boards(), cadenceFunding, systemProgram };
        args = { dayId: c.dayId };
        break;
      case "finish_run":
        accounts = { actor: keeper, activeRun: activeRun(), ownerAuthority: owner(), sessionToken: ZKUBE_PROGRAM_ID };
        args = { reason: { deadline: {} } };
        break;
      case "commit_run":
        accounts = { payer: keeper, activeRun: activeRun(), systemProgram };
        break;
      case "consume_arena_run":
        accounts = { playerState: playerStatePda(owner()), activeRun: activeRun(),
          arenaDaily: c.includeArenaPlayer ? daily() : ZKUBE_PROGRAM_ID,
          arenaPlayer: c.includeArenaPlayer ? arenaPlayerPda(daily(), owner()) : ZKUBE_PROGRAM_ID,
          scoreBoard: c.includeArenaPlayer ? arenaBoardPda(daily(), "score") : ZKUBE_PROGRAM_ID,
          themeBoard: c.includeArenaPlayer ? arenaBoardPda(daily(), "theme") : ZKUBE_PROGRAM_ID,
          rentRecipient: requireRentRecipient(c.rentRecipient) };
        break;
      case "finalize_arena_daily":
        accounts = { caller: keeper, protocol, ...boards(), followingDaily: following(), cadenceFunding };
        args = { dayId: requiredNumber(c.dayId, "day id"), followingDay: requiredNumber(c.followingDayId, "following day id") };
        break;
      case "close_arena_daily":
        // The newest prepared Daily takes what was never claimed; a Daily
        // that paid nothing closes without one.
        accounts = { caller: keeper, protocol, ...boards(), cadenceFunding,
          newestDaily: c.followingDayId === undefined ? ZKUBE_PROGRAM_ID : following() };
        break;
      case "close_arena_player":
        accounts = { caller: keeper, arenaDaily: daily(), arenaPlayer: arenaPlayerPda(daily(), owner()),
          rentRecipient: requireRentRecipient(c.rentRecipient) };
        break;
      default:
        throw new Error("keeper materializer operation is outside the exact allowlist");
    }
    return [this.buildInstruction(name, args, accounts, remaining)];
  }

  private buildInstruction(
    name: string,
    args: Record<string, unknown>,
    accounts: Record<string, PublicKey>,
    remaining: readonly RemainingAccountMeta[] = [],
  ): TransactionInstruction {
    const instruction = instructionRecord(this.idl, name);
    const accountSpecs = instruction.accounts;
    const keys = accountSpecs.map((raw) => {
      if (!isRecord(raw) || typeof raw.name !== "string") {
        throw new Error(`Anchor IDL ${name} contains a nested or malformed account`);
      }
      const staticAddress = typeof raw.address === "string"
        ? new PublicKey(raw.address)
        : undefined;
      const supplied = accounts[raw.name];
      const pubkey = staticAddress ?? supplied;
      if (!pubkey) throw new Error(`Anchor IDL materializer is missing ${name}.${raw.name}`);
      return {
        pubkey,
        isWritable: raw.writable === true,
        isSigner: raw.signer === true,
      };
    });
    keys.push(...remaining.map(({ pubkey, isWritable }) => ({
      pubkey,
      isWritable,
      isSigner: false,
    })));
    return new TransactionInstruction({
      programId: ZKUBE_PROGRAM_ID,
      keys,
      data: this.instructionCoder.encode(name, args),
    });
  }

  private async loadDailies(
    ids: readonly number[],
  ): Promise<LoadedDaily[]> {
    const loaded = await this.loadKnown(
      "arenaDaily",
      ids.map((id) => ({ id, address: arenaDailyPda(id) })),
      PROTOCOL_ACCOUNT_VERSION,
    );
    const output: LoadedDaily[] = [];
    for (const item of loaded) {
      const dayId = u32(item.value.dayId, "ArenaDaily day id");
      const { runsCloseAt, recoveryDeadlineAt } = dailyWindow(dayId);
      const finalizedAt = signedTimestamp(
        item.value.finalizedAt,
        "ArenaDaily finalization",
      );
      const snapshot: DailySnapshot = {
        dayId,
        finalizedAt,
        runsCloseAt,
        recoveryDeadlineAt,
        entriesPaid: bigint(item.value.entriesPaid, "ArenaDaily paid entries"),
        entriesScored: bigint(item.value.entriesScored, "ArenaDaily scored entries"),
        entriesExpired: bigint(item.value.entriesExpired, "ArenaDaily expired entries"),
        predecessorDayId: u32(item.value.predecessorDay, "ArenaDaily predecessor day"),
        predecessorRolloverApplied: boolean(
          item.value.predecessorRolloverApplied,
          "ArenaDaily predecessor flag",
        ),
        payoutLamports: bigint(record(item.value.ledger, "ArenaDaily ledger").payoutLamports, "ArenaDaily payout"),
      };
      output.push({ loaded: item, snapshot });
    }
    return output;
  }

  /**
   * The daily players of the recent window: those holding a paid run, whose
   * profiles are read next, and those whose rent can go back. A daily player
   * closes once its Daily is finalized or closed, because the boards were
   * complete at finalization and never read it again.
   */
  private async loadArenaPlayers(
    dailies: readonly LoadedDaily[],
    hinted: AnchorKeeperAdapterInput["discovery"],
  ): Promise<{ closable: ClosedArenaPlayerSnapshot[]; entered: PublicKey[] }> {
    const closable: ClosedArenaPlayerSnapshot[] = [];
    const entered: PublicKey[] = [];
    const today = currentDayId(this.input.nowUnix);
    const firstDay = Math.max(this.input.launchDayId, today - KEEPER_RECENT_DAILY_CADENCES);
    const dayByAddress = new Map(
      range(firstDay, today)
        .map((dayId) => [arenaDailyPda(dayId).toBase58(), dayId]),
    );
    const liveDaily = new Map(
      dailies.map(({ snapshot }) => [snapshot.dayId, snapshot]),
    );
    const players = hinted
      ? await this.loadHinted("arenaPlayer", hinted.arenaPlayers, PROTOCOL_ACCOUNT_VERSION)
      : await this.scanAccounts("arenaPlayer", PROTOCOL_ACCOUNT_VERSION);
    for (const player of players) {
      const challenge = publicKey(player.value.challenge, "ArenaPlayer challenge");
      const owner = publicKey(player.value.player, "ArenaPlayer owner");
      const dayId = dayByAddress.get(challenge.toBase58());
      if (dayId === undefined) continue;
      // A run in flight is followed until it is closed, whatever its day.
      if (bigint(player.value.activePaidRunId, "ArenaPlayer active run id") !== 0n) entered.push(owner);
      // Once its Daily is finalized (or gone) nothing reads this account again.
      const daily = liveDaily.get(dayId);
      if (!daily || daily.finalizedAt !== 0) {
        closable.push({ dayId, owner,
          rentPayer: publicKey(player.value.rentPayer, "ArenaPlayer rent payer") });
      }
    }
    return { closable, entered };
  }

  private async loadPlayerStates(
    entered: readonly PublicKey[],
    hinted: AnchorKeeperAdapterInput["discovery"],
  ): Promise<PlayerStateRecord[]> {
    const runOwners = hinted?.runOwners ??
      (await this.scanAccounts("activeRun", PROTOCOL_ACCOUNT_VERSION))
        .map(({ value }) => publicKey(value.owner, "ActiveRun owner"));
    const owners = [...new Map([...entered, ...runOwners]
      .map((owner) => [owner.toBase58(), owner])).values()];
    const accounts = await this.loadKnown(
      "playerState",
      owners.map((owner, id) => ({ id, address: playerStatePda(owner) })),
      PLAYER_STATE_ACCOUNT_VERSION,
    );
    return accounts.map((loaded) => {
      const owner = publicKey(loaded.value.owner, "PlayerState owner");
      const activeRunId = bigint(loaded.value.activeRunId, "PlayerState active run id");
      const orphanRunId = bigint(loaded.value.orphanRunId, "PlayerState orphan run id");
      const activeRunDaily = publicKey(
        loaded.value.activeRunDaily,
        "PlayerState active run Daily",
      );
      const activeRunDeadlineAt = signedTimestamp(
        loaded.value.activeRunDeadlineAt,
        "PlayerState active run deadline",
      );
      return {
        address: loaded.address,
        owner,
        activeRunId,
        activeRunDaily,
        activeRunDeadlineAt,
        orphanRunId,
      };
    });
  }

  private async loadRuns(
    players: readonly PlayerStateRecord[],
    dailies: readonly LoadedDaily[],
  ): Promise<RunSnapshot[]> {
    const dailyByAddress = new Map(
      dailies.map(({ loaded, snapshot }) => [loaded.address.toBase58(), snapshot]),
    );
    const output: RunSnapshot[] = [];
    for (const player of players) {
      if (player.activeRunId !== 0n) {
        try {
          output.push(await this.loadRun(
            player,
            player.activeRunId,
            true,
            dailyByAddress,
          ));
        } catch {
          // One unreachable run never stops the pass: it is carried as
          // unavailable, deferred until its recovery deadline, and every
          // other Daily and run is still served.
          const daily = dailyByAddress.get(player.activeRunDaily.toBase58());
          const cadence = daily
            ? { dayId: daily.dayId }
            : arcadeCadenceFromDeadline(
              player.activeRunDeadlineAt,
            );
          const arenaPlayerExists = await this.loadArenaPlayerExists(
            player.activeRunDaily,
            player.owner,
          );
          output.push({
            owner: player.owner,
            runId: player.activeRunId,
            dayId: cadence.dayId,

            arenaPlayerExists,
            lifecycle: "unavailable",
            location: "unavailable",

            runsCloseAt: player.activeRunDeadlineAt,
            recoveryDeadlineAt: dailyWindow(currentDayId(player.activeRunDeadlineAt)).recoveryDeadlineAt,
            reservationActive: true,
          });
        }
      }
      if (player.orphanRunId !== 0n) {
        try {
          output.push(await this.loadRun(
            player,
            player.orphanRunId,
            false,
            dailyByAddress,
          ));
        } catch {
          // The durable orphan remains non-scoreable; retry Router discovery.
        }
      }
    }
    return output;
  }

  private async loadRun(
    player: PlayerStateRecord,
    runId: bigint,
    reservationActive: boolean,
    dailyByAddress: ReadonlyMap<string, DailySnapshot>,
  ): Promise<RunSnapshot> {
    const address = activeRunPda(player.owner, runId);
    const status = await getDelegationStatus(
      address,
      this.input.routerEndpoint,
      this.input.fetcher,
    );
    let connection = this.input.connection;
    let location: "base" | "ephemeral_rollup" = "base";
    if (status.isDelegated) {
      if (!status.fqdn) {
        throw new Error("ActiveRun delegation location is missing");
      }
      connection = this.input.connectionFactory?.(status.fqdn) ??
        new Connection(status.fqdn, "confirmed");
      location = "ephemeral_rollup";
    }
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error("ActiveRun is missing at its resolved location");
    const loaded = this.decodeAccount(
      "activeRun",
      address,
      info,
      PROTOCOL_ACCOUNT_VERSION,
    );
    const owner = publicKey(loaded.value.owner, "ActiveRun owner");
    const rentPayer = publicKey(loaded.value.rentPayer, "ActiveRun rent payer");
    const deadlineAt = signedTimestamp(loaded.value.deadlineAt, "ActiveRun deadline");
    const dailyAddress = publicKey(loaded.value.dailyChallenge, "ActiveRun Daily");
    const daily = dailyByAddress.get(dailyAddress.toBase58());
    const cadence = daily
      ? { dayId: daily.dayId }
      : arcadeCadenceFromDeadline(deadlineAt);
    const arenaPlayerExists = await this.loadArenaPlayerExists(dailyAddress, owner);
    return {
      owner,
      rentPayer,
      runId,
      dayId: cadence.dayId,

      arenaPlayerExists,
      lifecycle: runLifecycle(loaded.value.lifecycle, "ActiveRun lifecycle"),
      location,

      runsCloseAt: deadlineAt,
      recoveryDeadlineAt: dailyWindow(currentDayId(deadlineAt)).recoveryDeadlineAt,
      reservationActive,
    };
  }

  private async loadArenaPlayerExists(daily: PublicKey, owner: PublicKey): Promise<boolean> {
    const address = arenaPlayerPda(daily, owner);
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) return false;
    this.decodeAccount(
      "arenaPlayer",
      address,
      info,
      PROTOCOL_ACCOUNT_VERSION,
    );
    return true;
  }

  private async loadRequired(
    name: string,
    address: PublicKey,
    version: number | readonly number[],
  ): Promise<LoadedAccount> {
    const info = await this.input.connection.getAccountInfo(address, "confirmed");
    if (!info) throw new Error(`${name} account is missing`);
    return this.decodeAccount(name, address, info, version);
  }

  private async loadKnown(
    name: string,
    items: readonly { id: number; address: PublicKey }[],
    version: number | readonly number[],
  ): Promise<LoadedAccount[]> {
    const infos = await this.getMultiple(items.map(({ address }) => address));
    return items.flatMap((item, index) => {
      const info = infos[index];
      return info
        ? [this.decodeAccount(name, item.address, info, version)]
        : [];
    });
  }

  /**
   * Reads addresses a hint named. A hint is not evidence: an address that is
   * closed, foreign or malformed is dropped, never trusted and never fatal.
   */
  private async loadHinted(
    name: string,
    addresses: readonly PublicKey[],
    version: number | readonly number[],
  ): Promise<LoadedAccount[]> {
    const infos = await this.getMultiple(addresses);
    return addresses.flatMap((address, index) => {
      const info = infos[index];
      if (!info) return [];
      try { return [this.decodeAccount(name, address, info, version)]; } catch { return []; }
    });
  }

  private async scanAccounts(
    name: string,
    version: number | readonly number[],
  ): Promise<LoadedAccount[]> {
    const discriminator = this.accountsCoder.accountDiscriminator(name);
    const accounts = await this.input.connection.getProgramAccounts(ZKUBE_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { memcmp: { offset: 0, bytes: base58(discriminator) } },
      ],
    });
    return accounts.map(({ pubkey, account }) => this.decodeAccount(
      name,
      pubkey,
      { ...account, data: Buffer.from(account.data) },
      version,
    ));
  }

  private decodeAccount(
    name: string,
    address: PublicKey,
    info: AccountInfo<Buffer>,
    version: number | readonly number[],
  ): LoadedAccount {
    if (!info.owner.equals(ZKUBE_PROGRAM_ID) || info.executable ||
        info.data.length < 9 || info.data.length >= MAX_PROGRAM_ACCOUNT_BYTES ||
        !info.data.subarray(0, 8).equals(this.accountsCoder.accountDiscriminator(name)) ||
        !(Array.isArray(version)
          ? version.includes(info.data[8]!)
          : info.data[8] === version)) {
      throw new Error(`${name} owner, size, discriminator or version is invalid`);
    }
    let decoded: unknown;
    try {
      decoded = this.accountsCoder.decode(name, info.data);
    } catch {
      throw new Error(`${name} data is malformed`);
    }
    return { address, account: info, value: record(decoded, name) };
  }

  private async getMultiple(
    addresses: readonly PublicKey[],
  ): Promise<Array<AccountInfo<Buffer> | null>> {
    const output: Array<AccountInfo<Buffer> | null> = [];
    for (let start = 0; start < addresses.length; start += MAX_RPC_ACCOUNT_BATCH) {
      const batch = addresses.slice(start, start + MAX_RPC_ACCOUNT_BATCH);
      const infos = await this.input.connection.getMultipleAccountsInfo(batch, "confirmed");
      if (infos.length !== batch.length) {
        throw new Error("RPC returned an incomplete account batch");
      }
      output.push(...infos);
    }
    return output;
  }
}

function arcadeCadenceFromDeadline(
  deadlineAt: number,
): { dayId: number } {
  return { dayId: currentDayId(deadlineAt) };
}

function instructionRecord(idl: Idl, name: string): {
  accounts: readonly unknown[];
} {
  const idlRecord = idl as unknown as Record<string, unknown>;
  const instruction = array(idlRecord.instructions, "Anchor IDL instructions")
    .map((value) => record(value, "Anchor IDL instruction"))
    .find((value) => value.name === name);
  if (!instruction) throw new Error(`Anchor IDL instruction ${name} is missing`);
  return { accounts: array(instruction.accounts, `${name} accounts`) };
}

function runLifecycle(value: unknown, label: string): RunLifecycle {
  const variant = enumVariant(value, label);
  if (variant === "prepared" || variant === "delegated" || variant === "playing") {
    return variant;
  }
  if (variant === "awaitingVrf") return "awaiting_vrf";
  if (variant === "finished") return "terminal";
  throw new Error(`${label} is invalid`);
}

function enumVariant(value: unknown, label: string): string {
  const object = record(value, label);
  const keys = Object.keys(object);
  if (keys.length !== 1) throw new Error(`${label} is malformed`);
  return keys[0]!;
}

function publicKey(value: unknown, label: string): PublicKey {
  if (value instanceof PublicKey) return value;
  if (typeof value === "string") {
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`${label} is not a Solana public key`);
    }
  }
  throw new Error(`${label} is not a Solana public key`);
}

function bigint(value: unknown, label: string): bigint {
  try {
    const parsed = typeof value === "bigint"
      ? value
      : typeof value === "number" && Number.isSafeInteger(value)
        ? BigInt(value)
        : isRecord(value) && typeof value.toString === "function"
          ? BigInt(String(value))
          : typeof value === "string"
            ? BigInt(value)
            : -1n;
    if (parsed < 0n || parsed > 0xffff_ffff_ffff_ffffn) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} is outside u64`);
  }
}

function signedTimestamp(value: unknown, label: string): number {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const number = Number(parsed);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} is invalid`);
  return number;
}

function u32(value: unknown, label: string): number {
  const parsed = safeInteger(value, label);
  assertCadenceId(parsed, label);
  return parsed;
}

function safeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} is invalid`);
  }
  return Number(value);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} is invalid`);
  return value;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} is not an object`);
  return value;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function range(first: number, lastInclusive: number): number[] {
  assertCadenceId(first, "cadence range start");
  assertCadenceId(lastInclusive, "cadence range end");
  if (lastInclusive < first || lastInclusive - first > KEEPER_RECENT_DAILY_CADENCES) {
    throw new Error("cadence discovery range is invalid or unbounded");
  }
  return Array.from({ length: lastInclusive - first + 1 }, (_, index) => first + index);
}

function requiredOwner(value: PublicKey | undefined): PublicKey {
  if (!value) throw new Error("IDL materializer is missing run/player owner");
  return value;
}

function requireRentRecipient(value: PublicKey | undefined): PublicKey {
  if (!value || value.equals(PublicKey.default)) {
    throw new Error("IDL materializer requires the persisted rent recipient");
  }
  return value;
}

function requiredRunId(value: bigint | undefined): bigint {
  if (value === undefined || value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("IDL materializer is missing a valid run id");
  }
  return value;
}

function requiredNumber(value: number | undefined, label: string): number {
  if (value === undefined) throw new Error(`IDL materializer is missing ${label}`);
  assertCadenceId(value, label);
  return value;
}

function base58(bytes: Uint8Array): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = "";
  while (value > 0n) {
    encoded = alphabet[Number(value % 58n)]! + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}
