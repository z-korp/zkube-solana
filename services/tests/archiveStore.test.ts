// @vitest-environment node

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  cadenceRoot,
  cadenceResultHash,
  canonicalArchiveV2,
  parseCanonicalArchive,
} from "../src/archiveContract";
import {
  ArchiveIntegrityError,
  FileKeeperArchiveStore,
  archiveSha256,
} from "../src/archiveStore";
import {
  ZKUBE_PROGRAM_ID,
  arenaDailyPda,
  validationOnlyPlan,
  type CompetitionKind,
  type KeeperInstructionPlan,
} from "../src/arcadeChain";

const roots: string[] = [];
const ZERO_ROOT = "00".repeat(32);
const projectResult = (_competition: CompetitionKind, data: Buffer) =>
  Buffer.from(data.subarray(0, 4));

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("keeper cadence archive storage", () => {
  it("writes schema v2 atomically with an explicit immutable result projection", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const plan = archivePlan("daily", 7, accountData(1));

    await store.prepare(plan);

    const written = await readFile(join(root, "daily", "7.json"), "utf8");
    const parsed = parseCanonicalArchive(written);
    expect(parsed.contract).toMatchObject({
      schemaVersion: 2,
      competition: "daily",
      periodId: 7,
      resultDataBase64: projectResult("daily", accountData(1)).toString("base64"),
    });
    await expect(store.prepare(closePlan(plan))).resolves.toBeUndefined();
  });

  it("verifies an older committed Daily through the current archive root", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const first = archivePlan("daily", 12, accountData(2));
    const second = archivePlan(
      "daily",
      13,
      accountData(3),
      planRoot(first),
      12,
      12,
    );
    await store.prepare(first);
    await store.prepare(second);

    await expect(store.prepare(
      closePlan(first, 13, planRoot(second)),
    )).resolves.toBeUndefined();
  });

  it("preserves and verifies a legacy v1 file after permitted raw metadata drift", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const archivedData = accountData(2);
    const currentData = Buffer.from(archivedData);
    currentData[10] = 99;
    const expected = archivePlan("daily", 8, currentData);
    const legacy = legacyArchiveJson("daily", 8, archivedData);
    await mkdir(join(root, "daily"), { recursive: true });
    await writeFile(join(root, "daily", "8.json"), legacy);

    await expect(store.prepare(closePlan(expected))).resolves.toBeUndefined();
    expect(await readFile(join(root, "daily", "8.json"), "utf8")).toBe(legacy);
  });

  it("accepts mutable raw drift for v2 while retaining the original evidence bytes", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const archived = archivePlan("daily", 9, accountData(3));
    await store.prepare(archived);
    const original = await readFile(join(root, "daily", "9.json"), "utf8");
    const currentData = accountData(3);
    currentData[12] = 77;

    await expect(store.prepare(closePlan(
      archivePlan("daily", 9, currentData),
    ))).resolves.toBeUndefined();
    expect(await readFile(join(root, "daily", "9.json"), "utf8")).toBe(original);
  });

  it("rejects immutable commitment and stored projection tampering", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const plan = archivePlan("daily", 3, accountData(4));
    await store.prepare(plan);
    const path = join(root, "daily", "3.json");
    const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    parsed.root = "55".repeat(32);
    await writeFile(path, canonicalJson(parsed));

    await expect(store.prepare(closePlan(plan))).rejects.toMatchObject({
      name: "ArchiveIntegrityError",
      code: "immutable_commitment_mismatch",
      competition: "daily",
      cadenceId: 3,
    });

    const projectedTamper = accountData(4);
    projectedTamper[0] = 42;
    parsed.root = planRoot(plan);
    parsed.accountDataBase64 = projectedTamper.toString("base64");
    parsed.accountDataSha256 = sha256(projectedTamper);
    await writeFile(path, canonicalJson(parsed));
    await expect(store.prepare(closePlan(plan))).rejects.toMatchObject({
      code: "projection_mismatch",
    });
  });

  it("quarantines a missing committed archive without re-materializing it", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const plan = closePlan(archivePlan("daily", 2_950, accountData(5)));

    await expect(store.prepare(plan)).rejects.toEqual(expect.objectContaining({
      name: "ArchiveIntegrityError",
      code: "missing_committed_archive",
      competition: "daily",
      cadenceId: 2_950,
    } satisfies Partial<ArchiveIntegrityError>));
    await expect(readFile(join(root, "daily", "2950.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps malformed plan/configuration errors outside the integrity quarantine", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const plan = archivePlan("daily", 10, accountData(6));
    plan.context!.archiveCanonicalJson = '{"schemaVersion":2}';
    plan.context!.archiveFileSha256 = archiveSha256('{"schemaVersion":2}');

    await expect(store.prepare(plan)).rejects.not.toBeInstanceOf(ArchiveIntegrityError);
  });

  it("allows one concurrent append winner without replacing its bytes", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root, projectResult);
    const first = archivePlan("daily", 11, accountData(7));
    const second = archivePlan("daily", 11, accountData(8));

    const outcomes = await Promise.allSettled([
      store.prepare(first),
      store.prepare(second),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(outcomes.find(({ status }) => status === "rejected")).toMatchObject({
      reason: expect.objectContaining({
        name: "ArchiveIntegrityError",
        competition: "daily",
        cadenceId: 11,
      }),
    });
    const stored = await readFile(join(root, "daily", "11.json"), "utf8");
    expect([
      first.context!.archiveCanonicalJson,
      second.context!.archiveCanonicalJson,
    ]).toContain(stored);
    await expect(store.prepare(
      stored === first.context!.archiveCanonicalJson ? first : second,
    )).resolves.toBeUndefined();
  });
});

function archivePlan(
  competition: CompetitionKind,
  id: number,
  data: Buffer,
  previousRoot = ZERO_ROOT,
  firstCadenceId = id,
  previousCadenceId = id - 1,
): KeeperInstructionPlan {
  const resultData = projectResult(competition, data);
  const resultHash = cadenceResultHash(competition, resultData);
  const root = cadenceRoot(competition, previousRoot, id, resultHash);
  const canonicalJson = canonicalArchiveV2({
    account: arenaDailyPda(id),
    accountData: data,
    competition,
    periodId: id,
    programId: ZKUBE_PROGRAM_ID,
    resultData,
    root,
  });
  return validationOnlyPlan("archive_arena_daily", {
    competition,
    dayId: id,
    archiveFirstCadenceId: firstCadenceId,
    previousCadenceId,
    archiveCurrentRoot: previousRoot,
    archiveCanonicalJson: canonicalJson,
    archiveFileSha256: archiveSha256(canonicalJson),
    archiveResultHash: resultHash,
  });
}

function closePlan(
  plan: KeeperInstructionPlan,
  lastCadenceId = plan.context!.dayId!,
  currentRoot = planRoot(plan),
): KeeperInstructionPlan {
  const {
    archiveCanonicalJson,
    archiveFileSha256,
    ...context
  } = plan.context!;
  void archiveCanonicalJson;
  void archiveFileSha256;
  return validationOnlyPlan("close_arena_daily", {
    ...context,
    previousCadenceId: lastCadenceId,
    archiveCurrentRoot: currentRoot,
    archiveCommitted: true,
    claimsExpired: true,
  });
}

function legacyArchiveJson(
  competition: CompetitionKind,
  id: number,
  data: Buffer,
): string {
  const resultHash = cadenceResultHash(competition, projectResult(competition, data));
  return canonicalJson({
    account: arenaDailyPda(id).toBase58(),
    accountDataBase64: data.toString("base64"),
    accountDataSha256: sha256(data),
    competition,
    periodId: id,
    programId: ZKUBE_PROGRAM_ID.toBase58(),
    resultHash,
    root: cadenceRoot(competition, ZERO_ROOT, id, resultHash),
    schemaVersion: 1,
  });
}

function planRoot(plan: KeeperInstructionPlan): string {
  return parseCanonicalArchive(plan.context!.archiveCanonicalJson!).contract.root;
}

function accountData(seed: number): Buffer {
  return Buffer.from([
    seed,
    seed + 1,
    seed + 2,
    seed + 3,
    0,
    0,
    0,
    0,
    2,
    10,
    11,
    12,
    13,
    14,
    15,
    16,
  ]);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zkube-archive-"));
  roots.push(root);
  return root;
}
