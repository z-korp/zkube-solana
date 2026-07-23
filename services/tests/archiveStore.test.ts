// @vitest-environment node

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FileKeeperArchiveStore,
  archiveSha256,
} from "../src/archiveStore";
import { validationOnlyPlan } from "../src/arcadeChain";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("keeper cadence archive storage", () => {
  it("atomically persists and rereads canonical bytes before archive/close", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root);
    const json = '{"periodId":7,"schemaVersion":1}';
    const context = {
      competition: "daily" as const,
      dayId: 7,
      archiveCanonicalJson: json,
      archiveFileSha256: archiveSha256(json),
      archiveResultHash: "11".repeat(32),
    };
    await store.prepare(validationOnlyPlan("archive_arena_daily", context));
    expect(await readFile(join(root, "daily", "7.json"), "utf8")).toBe(json);
    await expect(store.prepare(validationOnlyPlan("close_arena_daily", {
      ...context,
      archiveCommitted: true,
    }))).resolves.toBeUndefined();
  });

  it("is idempotent for identical bytes and rejects an existing mismatch", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root);
    const json = '{"periodId":8,"schemaVersion":1}';
    const plan = validationOnlyPlan("archive_arena_daily", {
      competition: "daily",
      dayId: 8,
      archiveCanonicalJson: json,
      archiveFileSha256: archiveSha256(json),
      archiveResultHash: "22".repeat(32),
    });
    await store.prepare(plan);
    await expect(store.prepare(plan)).resolves.toBeUndefined();
    await writeFile(join(root, "daily", "8.json"), "{}");
    await expect(store.prepare(plan)).rejects.toThrow("does not match");
  });

  it("rejects noncanonical JSON and a mismatched approved digest", async () => {
    const root = await temporaryRoot();
    const store = new FileKeeperArchiveStore(root);
    await expect(store.prepare(validationOnlyPlan("archive_season", {
      competition: "season",
      seasonId: 3,
      archiveCanonicalJson: '{"z":1,"a":2}',
      archiveFileSha256: archiveSha256('{"z":1,"a":2}'),
      archiveResultHash: "33".repeat(32),
    }))).rejects.toThrow("not canonical");
    await expect(store.prepare(validationOnlyPlan("archive_season", {
      competition: "season",
      seasonId: 3,
      archiveCanonicalJson: '{"a":2,"z":1}',
      archiveFileSha256: "44".repeat(32),
      archiveResultHash: "33".repeat(32),
    }))).rejects.toThrow("approved SHA-256");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zkube-archive-"));
  roots.push(root);
  return root;
}
