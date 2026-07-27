// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BorshAccountsCoder,
  convertIdlToCamelCase,
  type Idl,
} from "@anchor-lang/core";
import {
  Connection,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import BN from "bn.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AnchorKeeperAdapter,
  MAX_CADENCE_RESULT_BYTES,
  canonicalCadenceResultData,
} from "../src/anchorIdlAdapter";
import {
  ARCADE_ACCOUNT_VERSION,
  DAILY_RECOVERY_DEADLINE_OFFSET,
  DAILY_RUN_CLOSE_OFFSET,
  SECONDS_PER_DAY,
  ZKUBE_PROGRAM_ID,
  arcadeArchivePda,
  arenaDailyPda,
  cadenceFundingPda,
  rulesCatalogPda,
  seasonIdForDay,
  seasonPda,
  seasonStartDay,
  validationOnlyPlan,
  weekStartDay,
  weeklyJackpotPda,
  type CompetitionKind,
  type KeeperInstructionPlan,
  type KeeperPlanContext,
} from "../src/arcadeChain";
import {
  cadenceResultHash,
  canonicalArchiveV2,
  parseCanonicalArchive,
} from "../src/archiveContract";
import { FileKeeperArchiveStore, archiveSha256 } from "../src/archiveStore";
import type {
  CadenceArchiveCandidate,
  ProtocolSnapshot,
  WeeklySnapshot,
  WinnerSnapshot,
} from "../src/arcadeReconciliation";
import { runKeeperPass } from "../src/keeper";

interface SnapshotAccount {
  competition: CompetitionKind;
  cadenceId: number;
  address: string;
  owner: string;
  dataLength: number;
  trimmedLength: number;
  dataSha256: string;
  trimmedDataBase64Chunks: string[];
}

interface DevnetFixture {
  schema: string;
  schemaVersion: number;
  observedAt: string;
  slot: number;
  genesisHash: string;
  programId: string;
  accounts: SnapshotAccount[];
}

const DEVNET_GENESIS_HASH =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const WEEKLY_2950_RESULT_HASH =
  "641e2bb329880ca38755cc540e204e43acfbb187b83b60d3a58193f85030fb47";
const WEEKLY_2950_RESULT_DATA_SHA256 =
  "da837c566d1230121cf373aee9645434c11715cbc8d87dd73dcfeccab21d63d2";
const ROOT_HASH = "44".repeat(32);
const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/devnet-cadence-snapshots.json", import.meta.url),
  "utf8",
)) as DevnetFixture;
const idl = convertIdlToCamelCase(JSON.parse(readFileSync(
  new URL("../../client/src/chain/idl/solana.json", import.meta.url),
  "utf8",
)) as Idl);
const accountsCoder = new BorshAccountsCoder(idl);
const temporaryRoots: string[] = [];
let adapter: AnchorKeeperAdapter;

beforeAll(async () => {
  adapter = await AnchorKeeperAdapter.create({
    connection: new Connection("http://127.0.0.1:8899", "confirmed"),
    nowUnix: 0,
  });
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("schema-v11 bounded cadence result encoding", () => {
  it("pins the populated Weekly 2950 Rust/TypeScript golden projection", () => {
    const raw = fixtureAccount("weekly");
    const result = adapter.projectArchiveResultData("weekly", raw);

    expect(result).toHaveLength(1_592);
    expect(sha256(result)).toBe(WEEKLY_2950_RESULT_DATA_SHA256);
    expect(cadenceResultHash("weekly", result)).toBe(
      WEEKLY_2950_RESULT_HASH,
    );
    const decoded = decodeAccount("weekly", raw);
    expect([
      decoded.comboEntries,
      decoded.actionEntries,
      decoded.runEntries,
    ].map((entries) => (entries as unknown[]).length)).toEqual([4, 4, 4]);
  });

  it("crosses every former 1,000-byte cliff and reaches legal maxima", () => {
    const daily = decodeFixture("daily");
    expect(project("daily", {
      ...daily,
      entries: dailyEntries(4),
    })).toHaveLength(961);
    expect(project("daily", {
      ...daily,
      entries: dailyEntries(5),
    })).toHaveLength(1_101);
    expect(project("daily", {
      ...daily,
      entries: dailyEntries(50),
    })).toHaveLength(7_401);

    const weekly = decodeFixture("weekly");
    expect(project("weekly", {
      ...weekly,
      comboEntries: metricEntries(7),
      actionEntries: [],
      runEntries: [],
    })).toHaveLength(992);
    expect(project("weekly", {
      ...weekly,
      comboEntries: metricEntries(8),
      actionEntries: [],
      runEntries: [],
    })).toHaveLength(1_112);
    expect(project("weekly", {
      ...weekly,
      comboEntries: metricEntries(16, 0),
      actionEntries: metricEntries(16, 16),
      runEntries: metricEntries(16, 32),
    })).toHaveLength(5_912);

    const season = decodeFixture("season");
    expect(project("season", {
      ...season,
      entries: seasonEntries(21),
    })).toHaveLength(991);
    expect(project("season", {
      ...season,
      entries: seasonEntries(22),
    })).toHaveLength(1_033);
    expect(project("season", {
      ...season,
      entries: seasonEntries(50),
    })).toHaveLength(2_209);
  });

  it("returns only encoded bytes and fails closed before crossing 10,240 bytes", () => {
    const daily = decodeFixture("daily");
    const belowBound = project("daily", {
      ...daily,
      entries: dailyEntries(70),
    });
    expect(belowBound).toHaveLength(10_201);
    expect(belowBound.length).toBeLessThan(MAX_CADENCE_RESULT_BYTES);

    const exactBoundIdl = structuredClone(idl) as Idl;
    const dailyDefinition = exactBoundIdl.types?.find(({ name }) =>
      name === "arenaDaily"
    );
    if (dailyDefinition?.type.kind !== "struct" ||
        !Array.isArray(dailyDefinition.type.fields)) {
      throw new Error("test IDL is missing ArenaDaily entries");
    }
    const entriesField = dailyDefinition.type.fields.find((field) =>
      "name" in field && field.name === "entries"
    );
    if (!entriesField || !("name" in entriesField)) {
      throw new Error("test IDL is missing ArenaDaily.entries");
    }
    entriesField.type = "bytes";
    expect(() => canonicalCadenceResultData(
      exactBoundIdl,
      "daily",
      {
        ...daily,
        entries: Buffer.alloc(MAX_CADENCE_RESULT_BYTES - 401),
      },
    )).toThrow("reached or exceeded");

    expect(() => project("daily", {
      ...daily,
      entries: dailyEntries(71),
    })).toThrow("10240-byte bound");
  });

  it("validates committed raw snapshot identity before projecting", () => {
    expect(fixture).toMatchObject({
      schema: "zkube-keeper-devnet-cadence-snapshot",
      schemaVersion: 1,
      genesisHash: DEVNET_GENESIS_HASH,
      programId: ZKUBE_PROGRAM_ID.toBase58(),
    });
    expect(Number.isSafeInteger(fixture.slot) && fixture.slot > 0).toBe(true);

    const expectedHashes: Record<CompetitionKind, [number, string]> = {
      daily: [
        401,
        "92d25bb37319772051577f49e232a52d550c0b7b41d18c713d984983e10bedd2",
      ],
      weekly: [1_592, WEEKLY_2950_RESULT_HASH],
      season: [
        277,
        "34cf1f7bb6e827301633183a03f64d30bfabf263a31e22bec619e79a99dcd37c",
      ],
    };
    for (const snapshot of fixture.accounts) {
      const data = materializeSnapshot(snapshot);
      expect(snapshot.owner).toBe(ZKUBE_PROGRAM_ID.toBase58());
      expect(snapshot.address).toBe(cadencePda(
        snapshot.competition,
        snapshot.cadenceId,
      ).toBase58());
      expect(data).toHaveLength(snapshot.dataLength);
      expect(sha256(data)).toBe(snapshot.dataSha256);
      const projection = adapter.projectArchiveResultData(
        snapshot.competition,
        data,
      );
      expect([
        projection.length,
        cadenceResultHash(snapshot.competition, projection),
      ]).toEqual(expectedHashes[snapshot.competition]);
    }

    const weekly = fixtureAccount("weekly");
    const badDiscriminator = Buffer.from(weekly);
    badDiscriminator[0] ^= 0xff;
    expect(() => adapter.projectArchiveResultData(
      "weekly",
      badDiscriminator,
    )).toThrow("discriminator or version");
    const badVersion = Buffer.from(weekly);
    badVersion[8] = ARCADE_ACCOUNT_VERSION + 1;
    expect(() => adapter.projectArchiveResultData(
      "weekly",
      badVersion,
    )).toThrow("discriminator or version");
    expect(() => adapter.projectArchiveResultData(
      "weekly",
      weekly.subarray(0, 100),
    )).toThrow("malformed");
    const oversized = Buffer.alloc(MAX_CADENCE_RESULT_BYTES);
    weekly.subarray(0, 9).copy(oversized);
    expect(() => adapter.projectArchiveResultData(
      "weekly",
      oversized,
    )).toThrow("discriminator or version");
  });

  it("writes and re-reads archive v2 for every type with the real projector", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(
      root,
      (competition, data) =>
        adapter.projectArchiveResultData(competition, data),
    );

    for (const snapshot of fixture.accounts) {
      const data = materializeSnapshot(snapshot);
      const resultData = adapter.projectArchiveResultData(
        snapshot.competition,
        data,
      );
      const plan = archivePlan(snapshot, data, resultData);
      await store.prepare(plan);

      const stored = parseCanonicalArchive(await readFile(
        join(root, snapshot.competition, `${snapshot.cadenceId}.json`),
        "utf8",
      ));
      expect(stored.contract.schemaVersion).toBe(2);
      expect(stored.resultData).toEqual(resultData);
      expect(stored.contract.resultHash).toBe(cadenceResultHash(
        snapshot.competition,
        resultData,
      ));
      await expect(store.prepare(closePlan(plan))).resolves.toBeUndefined();
    }
  });

  it("runs the current Weekly through repeated archive, sync, and close shadow passes", async () => {
    const root = await temporaryRoot();
    const raw = fixtureAccount("weekly");
    const resultData = adapter.projectArchiveResultData("weekly", raw);
    const weeklyFixture = fixtureRecord("weekly");
    const candidate = archiveCandidate(weeklyFixture, raw, resultData);
    const weekly = productionWeeklySnapshot(raw);
    const snapshot = productionBacklogSnapshot(weekly, candidate);
    const keeper = Keypair.generate();
    const materialized: Array<{
      operation: string;
      context: KeeperPlanContext;
    }> = [];
    const store = new FileKeeperArchiveStore(
      root,
      (competition, data) =>
        adapter.projectArchiveResultData(competition, data),
    );
    const nowUnix = 20_661 * SECONDS_PER_DAY + 12 * 60 * 60;
    const passes: string[][] = [];

    for (let pass = 0; pass < 3; pass += 1) {
      materialized.length = 0;
      const result = await runKeeperPass({
        connection: readOnlyConnection(),
        keeper,
        writeEnabled: false,
        now: () => nowUnix * 1_000,
        protocolSnapshot: snapshot,
        protocolMaterializer: {
          materialize: async (input) => {
            materialized.push({
              operation: input.operation,
              context: input.context,
            });
            return adapter.materialize(input);
          },
        },
        archiveStore: store,
      });
      expect(result.operationFailures).toBe(0);
      passes.push(materialized.map(({ operation }) => operation));
      applyShadowPass(snapshot, materialized);
    }

    expect(passes).toEqual([
      [
        ...Array<string>(7).fill("consume_campaign_run"),
        "archive_weekly_jackpot",
      ],
      Array<string>(3).fill("sync_weekly_profile"),
      ["close_weekly_jackpot"],
    ]);
    expect(snapshot.weeklies[0]?.profileSyncMask).toBe(0x01ff);
    expect(snapshot.archiveCandidates?.[0]).toMatchObject({
      competition: "weekly",
      cadenceId: 2_950,
      committed: true,
      closeEligible: true,
      resultHash: WEEKLY_2950_RESULT_HASH,
    });
    expect(await readFile(join(root, "weekly", "2950.json"), "utf8"))
      .toBe(candidate.canonicalJson);
  });
});

function project(
  competition: CompetitionKind,
  value: Record<string, unknown>,
): Buffer {
  return canonicalCadenceResultData(idl, competition, value);
}

function fixtureRecord(competition: CompetitionKind): SnapshotAccount {
  const snapshot = fixture.accounts.find((value) =>
    value.competition === competition
  );
  if (!snapshot) throw new Error(`fixture is missing ${competition}`);
  return snapshot;
}

function fixtureAccount(competition: CompetitionKind): Buffer {
  return materializeSnapshot(fixtureRecord(competition));
}

function materializeSnapshot(snapshot: SnapshotAccount): Buffer {
  const encoded = snapshot.trimmedDataBase64Chunks.join("");
  if (Buffer.from(encoded, "base64").toString("base64") !== encoded) {
    throw new Error("snapshot base64 is not canonical");
  }
  const trimmed = Buffer.from(encoded, "base64");
  if (trimmed.length !== snapshot.trimmedLength ||
      snapshot.trimmedLength > snapshot.dataLength) {
    throw new Error("snapshot trimmed length is invalid");
  }
  const data = Buffer.alloc(snapshot.dataLength);
  trimmed.copy(data);
  return data;
}

function decodeFixture(competition: CompetitionKind): Record<string, unknown> {
  return decodeAccount(competition, fixtureAccount(competition));
}

function decodeAccount(
  competition: CompetitionKind,
  data: Buffer,
): Record<string, unknown> {
  const name = competition === "daily"
    ? "arenaDaily"
    : competition === "weekly"
      ? "weeklyJackpot"
      : "season";
  return accountsCoder.decode(name, data) as Record<string, unknown>;
}

function deterministicPublicKey(seed: number): PublicKey {
  return new PublicKey(Uint8Array.from(
    { length: 32 },
    (_, index) => (seed + index) & 0xff,
  ));
}

function dailyEntries(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    player: deterministicPublicKey(index + 1),
    runId: new BN(index + 1),
    score: 10_000 - index,
    attempts: index + 1,
    finalizedAt: new BN(1_800_000_000 + index),
    replayHash: Array(32).fill((index + 3) & 0xff),
    metrics: {
      maxCombo: index,
      comboScoringActions: index + 1,
      comboDerivedScore: new BN(index + 2),
      highestActionScore: new BN(index + 3),
      mostLinesSingleAction: index + 4,
      mostBlocksSingleAction: index + 5,
      totalLines: new BN(index + 6),
      totalBlocks: new BN(index + 7),
      perfectClears: index + 8,
    },
  }));
}

function metricEntries(
  count: number,
  offset = 0,
): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + offset + 1;
    return {
      player: deterministicPublicKey(seed),
      daily: deterministicPublicKey(seed + 64),
      runId: new BN(seed),
      value: new BN(1_000 - seed),
      finalizedAt: new BN(1_800_000_000 + seed),
      replayHash: Array(32).fill((seed + 5) & 0xff),
    };
  });
}

function seasonEntries(count: number): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, index) => ({
    player: deterministicPublicKey(index + 1),
    points: 1_000 - index,
    finalizedAt: new BN(1_800_000_000 + index),
  }));
}

function cadencePda(
  competition: CompetitionKind,
  cadenceId: number,
): PublicKey {
  return competition === "daily"
    ? arenaDailyPda(cadenceId)
    : competition === "weekly"
      ? weeklyJackpotPda(cadenceId)
      : seasonPda(cadenceId);
}

function archivePlan(
  snapshot: SnapshotAccount,
  data: Buffer,
  resultData: Buffer,
): KeeperInstructionPlan {
  const canonicalJson = canonicalArchiveV2({
    account: new PublicKey(snapshot.address),
    accountData: data,
    competition: snapshot.competition,
    periodId: snapshot.cadenceId,
    programId: ZKUBE_PROGRAM_ID,
    resultData,
    root: ROOT_HASH,
  });
  const identity = snapshot.competition === "daily"
    ? { dayId: snapshot.cadenceId }
    : snapshot.competition === "weekly"
      ? { weekId: snapshot.cadenceId }
      : { seasonId: snapshot.cadenceId };
  const operation = snapshot.competition === "daily"
    ? "archive_arena_daily"
    : snapshot.competition === "weekly"
      ? "archive_weekly_jackpot"
      : "archive_season";
  return validationOnlyPlan(operation, {
    competition: snapshot.competition,
    ...identity,
    archiveCanonicalJson: canonicalJson,
    archiveFileSha256: archiveSha256(canonicalJson),
    archiveResultHash: cadenceResultHash(snapshot.competition, resultData),
  });
}

function closePlan(plan: KeeperInstructionPlan): KeeperInstructionPlan {
  const operation = plan.context?.competition === "daily"
    ? "close_arena_daily"
    : plan.context?.competition === "weekly"
      ? "close_weekly_jackpot"
      : "close_season";
  return validationOnlyPlan(operation, {
    ...plan.context!,
    archiveCommitted: true,
  });
}

function archiveCandidate(
  snapshot: SnapshotAccount,
  data: Buffer,
  resultData: Buffer,
): CadenceArchiveCandidate {
  const canonicalJson = canonicalArchiveV2({
    account: new PublicKey(snapshot.address),
    accountData: data,
    competition: snapshot.competition,
    periodId: snapshot.cadenceId,
    programId: ZKUBE_PROGRAM_ID,
    resultData,
    root: ROOT_HASH,
  });
  return {
    competition: snapshot.competition,
    cadenceId: snapshot.cadenceId,
    canonicalJson,
    fileSha256: archiveSha256(canonicalJson),
    resultHash: cadenceResultHash(snapshot.competition, resultData),
    requiredProfileSyncMask: 0x01ff,
    committed: false,
    closeEligible: false,
    closeEligibleAt: (weekStartDay(snapshot.cadenceId) + 7) *
      SECONDS_PER_DAY,
  };
}

function productionWeeklySnapshot(raw: Buffer): WeeklySnapshot {
  const decoded = decodeAccount("weekly", raw);
  const payouts = [18_000_000n, 7_000_000n, 4_000_000n] as const;
  const winners: WinnerSnapshot[] = [];
  for (const [bountyIndex, field] of [
    [0, "comboEntries"],
    [1, "actionEntries"],
    [2, "runEntries"],
  ] as const) {
    const entries = decoded[field] as Array<{ player: PublicKey }>;
    for (let index = 0; index < 3; index += 1) {
      winners.push({
        owner: entries[index]!.player,
        payoutLamports: payouts[index]!,
        rank: index + 1,
        bountyIndex,
        destinationValid: true,
      });
    }
  }
  return {
    weekId: 2_950,
    qualificationStartDay: 20_656,
    status: "finalized",
    closesAt: (weekStartDay(2_950) + 7) * SECONDS_PER_DAY,
    potLamports: 90_000_000n,
    predecessorRolloverRequired: false,
    predecessorRolloverApplied: false,
    qualificationDailiesComplete: true,
    profileSyncMask: 0,
    settlement: {
      winners,
      rolloverLamports: 3_000_000n,
    },
  };
}

function productionBacklogSnapshot(
  weekly: WeeklySnapshot,
  candidate: CadenceArchiveCandidate,
): ProtocolSnapshot {
  const currentDay = 20_661;
  const currentSeason = seasonIdForDay(currentDay);
  const nextSeason = currentSeason + 1;
  return {
    paused: true,
    launchDayId: 20_656,
    rulesCatalog: rulesCatalogPda(1),
    dailies: [
      dailySnapshot(currentDay, "open"),
      dailySnapshot(currentDay + 1, "funding"),
    ],
    weeklies: [
      weekly,
      {
        weekId: 2_951,
        qualificationStartDay: weekStartDay(2_951),
        status: "funding",
        closesAt: (weekStartDay(2_951) + 7) * SECONDS_PER_DAY,
        potLamports: 0n,
        predecessorRolloverRequired: true,
        predecessorRolloverApplied: false,
        qualificationDailiesComplete: false,
        profileSyncMask: 0,
      },
      {
        weekId: 2_952,
        qualificationStartDay: weekStartDay(2_952),
        status: "funding",
        closesAt: (weekStartDay(2_952) + 7) * SECONDS_PER_DAY,
        potLamports: 0n,
        predecessorRolloverRequired: true,
        predecessorRolloverApplied: false,
        qualificationDailiesComplete: false,
        profileSyncMask: 0,
      },
    ],
    seasons: [
      {
        seasonId: currentSeason,
        qualificationStartDay: 20_656,
        status: "open",
        closesAt: (seasonStartDay(currentSeason) + 28) * SECONDS_PER_DAY,
        potLamports: 0n,
        predecessorRolloverRequired: false,
        predecessorRolloverApplied: false,
        sealedDailies: 5,
        profileSyncMask: 0,
      },
      {
        seasonId: nextSeason,
        qualificationStartDay: seasonStartDay(nextSeason),
        status: "funding",
        closesAt: (seasonStartDay(nextSeason) + 28) * SECONDS_PER_DAY,
        potLamports: 0n,
        predecessorRolloverRequired: true,
        predecessorRolloverApplied: false,
        sealedDailies: 0,
        profileSyncMask: 0,
      },
    ],
    runs: Array.from({ length: 7 }, (_, index) => ({
      owner: deterministicPublicKey(160 + index),
      runId: BigInt(index + 1),
      mode: "campaign" as const,
      arenaPlayerExists: false,
      lifecycle: "terminal" as const,
      location: "base" as const,
      acceptedActions: 1,
      reservationActive: true,
    })),
    dailySeasonPlayers: [],
    playerStateOwners: [...new Map(
      weekly.settlement!.winners.map(({ owner }) => [
        owner.toBase58(),
        owner,
      ]),
    ).values()],
    arenaPlayerClosures: [],
    seasonPlayerClosures: [],
    archiveState: {
      address: arcadeArchivePda(),
      cadenceFunding: cadenceFundingPda(),
      lastDailyId: 20_660,
      lastWeeklyId: 2_949,
      lastSeasonId: currentSeason - 1,
    },
    archiveCandidates: [candidate],
  };
}

function dailySnapshot(
  dayId: number,
  status: "funding" | "open",
) {
  return {
    dayId,
    status,
    runsCloseAt: dayId * SECONDS_PER_DAY + DAILY_RUN_CLOSE_OFFSET,
    recoveryDeadlineAt:
      dayId * SECONDS_PER_DAY + DAILY_RECOVERY_DEADLINE_OFFSET,
    entriesPaid: 0n,
    entriesScored: 0n,
    entriesExpired: 0n,
    potLamports: 0n,
    predecessorRolloverRequired: true,
    predecessorRolloverApplied: false,
    seasonEligiblePlayers: 0,
    seasonRollups: 0,
    seasonRollupSealed: false,
    profileSyncMask: 0,
  } as const;
}

function applyShadowPass(
  snapshot: ProtocolSnapshot,
  materialized: readonly {
    operation: string;
    context: KeeperPlanContext;
  }[],
): void {
  const weekly = snapshot.weeklies[0] as WeeklySnapshot;
  const candidate = snapshot.archiveCandidates?.[0] as CadenceArchiveCandidate;
  for (const plan of materialized) {
    if (plan.operation === "archive_weekly_jackpot") {
      candidate.committed = true;
      snapshot.archiveState!.lastWeeklyId = 2_950;
    }
    if (plan.operation === "sync_weekly_profile") {
      const mask = plan.context.winnerPositionMask;
      if (mask === undefined) {
        throw new Error("Weekly sync plan omitted its payout mask");
      }
      weekly.profileSyncMask |= mask;
    }
    if (plan.operation === "consume_campaign_run") {
      snapshot.runs = snapshot.runs.filter(({ owner, runId }) =>
        !owner.equals(plan.context.owner) || runId !== plan.context.runId
      );
    }
  }
  candidate.closeEligible =
    candidate.committed &&
    weekly.profileSyncMask === candidate.requiredProfileSyncMask;
}

function readOnlyConnection() {
  return {
    getBalance: async () => 0,
    getProgramAccounts: async () => [],
    getMultipleAccountsInfo: async () => [],
  } as never;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zkube-schema-v11-"));
  temporaryRoots.push(root);
  await mkdir(root, { recursive: true });
  return root;
}
