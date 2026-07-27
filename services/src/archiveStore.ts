import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import type {
  CompetitionKind,
  KeeperInstructionPlan,
} from "./arcadeChain.js";
import {
  CURRENT_ARCHIVE_SCHEMA_VERSION,
  cadenceResultHash,
  parseCanonicalArchive,
  type CadenceArchiveContract,
} from "./archiveContract.js";

export const DEFAULT_ARCHIVE_DIRECTORY = "/data/zkube-archives";

export interface KeeperArchiveStore {
  prepare(plan: KeeperInstructionPlan): Promise<void>;
}

export type ArchiveIntegrityCode =
  | "existing_archive_invalid"
  | "immutable_commitment_mismatch"
  | "missing_committed_archive"
  | "projection_mismatch"
  | "reread_verification_failed";

export class ArchiveIntegrityError extends Error {
  readonly name = "ArchiveIntegrityError";

  constructor(
    readonly code: ArchiveIntegrityCode,
    readonly competition: CompetitionKind,
    readonly cadenceId: number,
    message: string,
  ) {
    super(message);
  }
}

export type ArchiveResultProjector = (
  competition: CompetitionKind,
  accountData: Buffer,
) => Buffer;

export class FileKeeperArchiveStore implements KeeperArchiveStore {
  constructor(
    private readonly root: string,
    private readonly projectResultData: ArchiveResultProjector,
  ) {
    if (!root || !isAbsolute(root)) {
      throw new Error("keeper archive directory must be absolute");
    }
    if (typeof projectResultData !== "function") {
      throw new Error("keeper archive result projector is required");
    }
  }

  async prepare(plan: KeeperInstructionPlan): Promise<void> {
    const identity = archiveIdentity(plan);
    const canonicalJson = plan.context?.archiveCanonicalJson;
    if (canonicalJson === undefined) {
      throw new Error("archive plan is missing canonical JSON");
    }
    const expected = parseExpectedArchive(
      canonicalJson,
      identity,
      plan.context?.archiveResultHash,
    );
    await this.preparePath(
      identity.kind,
      identity.id,
      canonicalJson,
      identity.sha256,
      expected,
      isArchiveOperation(plan.operation),
    );
  }

  private async preparePath(
    kind: CompetitionKind,
    id: number,
    canonicalJson: string,
    expectedSha256: string,
    expected: CadenceArchiveContract,
    mayCreate: boolean,
  ): Promise<void> {
    const bytes = Buffer.from(canonicalJson, "utf8");
    if (sha256(bytes) !== expectedSha256) {
      throw new Error("canonical archive bytes do not match the approved SHA-256");
    }
    const target = await this.safePath(kind, id);
    const existing = await readExistingRegularFile(target);
    if (existing) {
      this.verifyStored(kind, id, existing, expected);
      return;
    }
    if (!mayCreate) {
      throw new ArchiveIntegrityError(
        "missing_committed_archive",
        kind,
        id,
        "committed cadence archive file is missing",
      );
    }

    const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
    let temporaryCreated = false;
    try {
      const handle = await open(temporary, "wx", 0o600);
      temporaryCreated = true;
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        // A hard link creates the final name atomically and fails if another
        // pass won the race. Unlike rename, it can never replace an archive.
        await link(temporary, target);
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const raced = await readExistingRegularFile(target);
        if (!raced) throw error;
        this.verifyStored(kind, id, raced, expected);
        return;
      }
      await rm(temporary);
      temporaryCreated = false;
      const directory = await open(dirname(target), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      if (temporaryCreated) await rm(temporary, { force: true });
    }
    const reread = await readExistingRegularFile(target);
    if (!reread || !reread.equals(bytes)) {
      throw new ArchiveIntegrityError(
        "reread_verification_failed",
        kind,
        id,
        "new cadence archive reread verification failed",
      );
    }
    this.verifyStored(kind, id, reread, expected);
  }

  private verifyStored(
    kind: CompetitionKind,
    id: number,
    bytes: Buffer,
    expected: CadenceArchiveContract,
  ): void {
    let stored: ReturnType<typeof parseCanonicalArchive>;
    try {
      stored = parseCanonicalArchive(bytes.toString("utf8"));
    } catch (error) {
      throw new ArchiveIntegrityError(
        "existing_archive_invalid",
        kind,
        id,
        error instanceof Error ? error.message : String(error),
      );
    }
    const actual = stored.contract;
    if (actual.account !== expected.account ||
        actual.competition !== expected.competition ||
        actual.periodId !== expected.periodId ||
        actual.programId !== expected.programId ||
        actual.resultHash !== expected.resultHash ||
        actual.root !== expected.root) {
      throw new ArchiveIntegrityError(
        "immutable_commitment_mismatch",
        kind,
        id,
        "stored cadence archive immutable commitment does not match",
      );
    }

    let projected: Buffer;
    try {
      projected = this.projectResultData(kind, stored.accountData);
    } catch (error) {
      throw new ArchiveIntegrityError(
        "existing_archive_invalid",
        kind,
        id,
        `stored cadence archive account evidence is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const expectedResultData = Buffer.from(expected.resultDataBase64!, "base64");
    if (!projected.equals(expectedResultData) ||
        cadenceResultHash(kind, projected) !== actual.resultHash ||
        (stored.resultData && !stored.resultData.equals(projected))) {
      throw new ArchiveIntegrityError(
        "projection_mismatch",
        kind,
        id,
        "stored cadence archive result projection does not match",
      );
    }
  }

  private async safePath(kind: CompetitionKind, id: number): Promise<string> {
    if (!["daily", "weekly", "season"].includes(kind) ||
        !Number.isSafeInteger(id) || id < 0 || id > 0xffff_ffff) {
      throw new Error("cadence archive identity is invalid");
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const resolvedRoot = await realpath(this.root);
    const directory = join(resolvedRoot, kind);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const resolvedDirectory = await realpath(directory);
    if (dirname(resolvedDirectory) !== resolvedRoot) {
      throw new Error("cadence archive directory escaped its root");
    }
    return join(resolvedDirectory, `${id}.json`);
  }
}

export function archiveDirectoryFromEnv(
  env: Record<string, string | undefined>,
): string {
  return env.ZKUBE_ARCHIVE_DIRECTORY || DEFAULT_ARCHIVE_DIRECTORY;
}

export function archiveSha256(canonicalJson: string): string {
  return sha256(Buffer.from(canonicalJson, "utf8"));
}

function archiveIdentity(plan: KeeperInstructionPlan): {
  kind: CompetitionKind;
  id: number;
  sha256: string;
} {
  const kind = archiveKind(plan.operation);
  const context = plan.context;
  const id = kind === "daily"
    ? context?.dayId
    : kind === "weekly"
      ? context?.weekId
      : context?.seasonId;
  const hash = context?.archiveFileSha256;
  if (id === undefined || !/^[0-9a-f]{64}$/.test(hash ?? "")) {
    throw new Error("archive plan identity or SHA-256 is invalid");
  }
  return { kind, id, sha256: hash! };
}

function archiveKind(operation: string): CompetitionKind {
  if (operation === "archive_arena_daily" || operation === "close_arena_daily") {
    return "daily";
  }
  if (operation === "archive_weekly_jackpot" ||
      operation === "close_weekly_jackpot") {
    return "weekly";
  }
  if (operation === "archive_season" || operation === "close_season") {
    return "season";
  }
  throw new Error("operation does not use cadence archive storage");
}

function isArchiveOperation(operation: string): boolean {
  return operation.startsWith("archive_");
}

function parseExpectedArchive(
  canonicalJson: string,
  identity: { kind: CompetitionKind; id: number },
  contextResultHash: string | undefined,
): CadenceArchiveContract {
  const { contract, resultData } = parseCanonicalArchive(canonicalJson);
  if (contract.schemaVersion !== CURRENT_ARCHIVE_SCHEMA_VERSION || !resultData ||
      contract.competition !== identity.kind ||
      contract.periodId !== identity.id ||
      contract.resultHash !== contextResultHash) {
    throw new Error("archive plan does not carry the canonical v2 commitment");
  }
  return contract;
}

async function readExistingRegularFile(path: string): Promise<Buffer | undefined> {
  try {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw new Error("cadence archive target is not a regular file");
    }
    return await readFile(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
