// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BorshAccountsCoder, convertIdlToCamelCase, type Idl } from "@anchor-lang/core";
import { Connection, PublicKey } from "@solana/web3.js";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AnchorKeeperAdapter,
  MAX_CADENCE_RESULT_BYTES,
  canonicalCadenceResultData,
} from "../src/anchorIdlAdapter";
import {
  ARCADE_ACCOUNT_VERSION,
  ZKUBE_PROGRAM_ID,
  arenaBoardPda,
  validationOnlyPlan,
} from "../src/arcadeChain";
import {
  cadenceRoot,
  cadenceResultHash,
  canonicalArchive,
} from "../src/archiveContract";
import { FileKeeperArchiveStore, archiveSha256 } from "../src/archiveStore";

interface DailyFixture {
  competition: "daily";
  cadenceId: number;
  address: string;
  owner: string;
  dailyDataBase64: string;
  dailyDataSha256: string;
  scoreBoardDataBase64: string;
  scoreBoardDataSha256: string;
  themeBoardDataBase64: string;
  themeBoardDataSha256: string;
}

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/devnet-cadence-snapshots.json", import.meta.url),
  "utf8",
)) as {
  schema: string;
  schemaVersion: number;
  source: string;
  programId: string;
  accounts: DailyFixture[];
};
const idl = convertIdlToCamelCase(JSON.parse(readFileSync(
  new URL("../../client/src/chain/idl/solana.json", import.meta.url),
  "utf8",
)) as Idl);
const coder = new BorshAccountsCoder(idl);
const temporaryRoots: string[] = [];
const SOURCE_IDL_SHA256 =
  "d5e0cb79a52ee06cc38c91593fe4bcd000d743ac5ddfa76ec5e0c1db2f142eee";
let adapter: AnchorKeeperAdapter;

beforeAll(async () => {
  adapter = await AnchorKeeperAdapter.create({
    connection: new Connection("http://127.0.0.1:8899", "confirmed"),
    nowUnix: 0,
    testExpectedIdlSha256: SOURCE_IDL_SHA256,
  });
});

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

describe("v5 bounded Daily result encoding", () => {
  it("pins the regenerated fresh-bootstrap Daily projection", () => {
    expect(fixture).toMatchObject({
      schema: "zkube-keeper-v5-cadence-fixture",
      schemaVersion: 1,
      source: "synthetic-fresh-bootstrap",
      programId: ZKUBE_PROGRAM_ID.toBase58(),
    });
    expect(fixture.accounts).toHaveLength(1);
    const { daily, score, theme } = fixtureAccounts();
    const result = adapter.projectArchiveResultData("daily", daily, score, theme);
    expect(result).toHaveLength(583);
    expect(sha256(result)).toBe(
      "d1b6598df1fa1f9a6877f83ec0ea2ca4546029adea1e9b3e1c653356c7c13718",
    );
    expect(cadenceResultHash("daily", result)).toBe(
      "2420be70616c0f4fa85885a7fb0c90b7eac3b90fcf3d63ac251b6fd5bb1192e5",
    );
  });

  it("archives two maximum boards below the explicit result bound", () => {
    const fixture = fixtureAccounts();
    const daily = coder.decode("arenaDaily", fixture.daily) as Record<string, unknown>;
    const score = maximumBoard(fixture.score, 1_536);
    const theme = maximumBoard(fixture.theme, 1_536);
    const result = canonicalCadenceResultData(idl, "daily", daily, { score, theme });
    expect(result).toHaveLength(258_631);
    expect(result.length).toBeLessThan(MAX_CADENCE_RESULT_BYTES);
    expect(() => canonicalCadenceResultData(idl, "daily", daily, {
      score: maximumBoard(fixture.score, 2_000),
      theme: maximumBoard(fixture.theme, 2_000),
    })).toThrow("300000-byte bound");
  });

  it("rejects the removed or wrong account ABI before projection", () => {
    const { daily: raw, score, theme } = fixtureAccounts();
    const badDiscriminator = Buffer.from(raw);
    badDiscriminator[0] ^= 0xff;
    expect(() => adapter.projectArchiveResultData("daily", badDiscriminator, score, theme))
      .toThrow("discriminator or version");
    const badVersion = Buffer.from(raw);
    badVersion[8] = ARCADE_ACCOUNT_VERSION - 1;
    expect(() => adapter.projectArchiveResultData("daily", badVersion, score, theme))
      .toThrow("discriminator or version");
  });

  it("writes and re-reads the Daily archive with the real projector", async () => {
    const root = await mkdtemp(join(tmpdir(), "zkube-v5-archive-"));
    temporaryRoots.push(root);
    const { daily: raw, score, theme } = fixtureAccounts();
    const resultData = adapter.projectArchiveResultData("daily", raw, score, theme);
    const account = fixture.accounts[0]!;
    const resultHash = cadenceResultHash("daily", resultData);
    const rootHash = cadenceRoot(
      "daily",
      "00".repeat(32),
      account.cadenceId,
      resultHash,
    );
    const dailyAddress = new PublicKey(account.address);
    const canonicalJson = canonicalArchive({
      account: dailyAddress,
      accountData: raw,
      scoreBoard: arenaBoardPda(dailyAddress, "score"),
      scoreBoardData: score,
      themeBoard: arenaBoardPda(dailyAddress, "theme"),
      themeBoardData: theme,
      competition: "daily",
      periodId: account.cadenceId,
      programId: ZKUBE_PROGRAM_ID,
      resultData,
      root: rootHash,
    });
    const store = new FileKeeperArchiveStore(
      root,
      (competition, data, scoreData, themeData) =>
        adapter.projectArchiveResultData(competition, data, scoreData, themeData),
    );
    const context = {
      competition: "daily" as const,
      dayId: account.cadenceId,
      archiveFirstCadenceId: account.cadenceId,
      previousCadenceId: account.cadenceId - 1,
      archiveCurrentRoot: "00".repeat(32),
      archiveCanonicalJson: canonicalJson,
      archiveFileSha256: archiveSha256(canonicalJson),
      archiveResultHash: resultHash,
    };
    await store.prepare(validationOnlyPlan("archive_arena_daily", context));
    await store.prepare(validationOnlyPlan("expire_daily_claims", {
      competition: context.competition,
      dayId: context.dayId,
      archiveFirstCadenceId: context.archiveFirstCadenceId,
      previousCadenceId: account.cadenceId,
      archiveCurrentRoot: rootHash,
      archiveResultHash: resultHash,
      archiveCommitted: true,
    }));
    await store.prepare(validationOnlyPlan("close_arena_daily", {
      competition: context.competition,
      dayId: context.dayId,
      archiveFirstCadenceId: context.archiveFirstCadenceId,
      previousCadenceId: account.cadenceId,
      archiveCurrentRoot: rootHash,
      archiveResultHash: resultHash,
      archiveCommitted: true,
    }));
    expect(await readFile(join(root, "daily", `${account.cadenceId}.json`), "utf8"))
      .toBe(canonicalJson);
  });
});

function fixtureAccounts(): { daily: Buffer; score: Buffer; theme: Buffer } {
  const snapshot = fixture.accounts[0]!;
  const daily = Buffer.from(snapshot.dailyDataBase64, "base64");
  const score = Buffer.from(snapshot.scoreBoardDataBase64, "base64");
  const theme = Buffer.from(snapshot.themeBoardDataBase64, "base64");
  expect(sha256(daily)).toBe(snapshot.dailyDataSha256);
  expect(sha256(score)).toBe(snapshot.scoreBoardDataSha256);
  expect(sha256(theme)).toBe(snapshot.themeBoardDataSha256);
  return { daily, score, theme };
}

function maximumBoard(header: Buffer, payoutCount: number) {
  const value = coder.decode("arenaBoard", header) as Record<string, unknown>;
  value.payoutCount = payoutCount;
  value.widthCount = payoutCount;
  value.qualifiedCount = payoutCount;
  value.cursor = payoutCount;
  value.sealed = true;
  return {
    value,
    data: Buffer.alloc(129 + payoutCount * 84 + 2 * Math.ceil(payoutCount / 8)),
  };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
