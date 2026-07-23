import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import type {
  CompetitionKind,
  KeeperInstructionPlan,
} from "./arcadeChain.js";

export const DEFAULT_ARCHIVE_DIRECTORY = "/data/zkube-archives";

export interface KeeperArchiveStore {
  prepare(plan: KeeperInstructionPlan): Promise<void>;
}

export class FileKeeperArchiveStore implements KeeperArchiveStore {
  constructor(private readonly root: string) {
    if (!root || !resolve(root).startsWith(sep)) {
      throw new Error("keeper archive directory must be absolute");
    }
  }

  async prepare(plan: KeeperInstructionPlan): Promise<void> {
    const identity = archiveIdentity(plan);
    if (isArchiveOperation(plan.operation)) {
      const canonicalJson = plan.context?.archiveCanonicalJson;
      if (canonicalJson === undefined) {
        throw new Error("archive plan is missing canonical JSON");
      }
      assertCanonicalJson(canonicalJson);
      await this.writeAtomicVerified(
        identity.kind,
        identity.id,
        canonicalJson,
        identity.sha256,
      );
      return;
    }
    await this.verifyExisting(
      identity.kind,
      identity.id,
      identity.sha256,
    );
  }

  private async writeAtomicVerified(
    kind: CompetitionKind,
    id: number,
    canonicalJson: string,
    expectedSha256: string,
  ): Promise<void> {
    const bytes = Buffer.from(canonicalJson, "utf8");
    if (sha256(bytes) !== expectedSha256) {
      throw new Error("canonical archive bytes do not match the approved SHA-256");
    }
    const target = await this.safePath(kind, id);
    const existing = await readExistingRegularFile(target);
    if (existing) {
      if (!existing.equals(bytes) || sha256(existing) !== expectedSha256) {
        throw new Error("existing cadence archive does not match canonical bytes");
      }
      return;
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
      await rename(temporary, target);
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
    await this.verifyExisting(kind, id, expectedSha256, bytes);
  }

  private async verifyExisting(
    kind: CompetitionKind,
    id: number,
    expectedSha256: string,
    expectedBytes?: Buffer,
  ): Promise<void> {
    const target = await this.safePath(kind, id);
    const bytes = await readExistingRegularFile(target);
    if (!bytes || sha256(bytes) !== expectedSha256 ||
        (expectedBytes && !bytes.equals(expectedBytes))) {
      throw new Error("cadence archive reread verification failed");
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

function assertCanonicalJson(value: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("cadence archive is not valid JSON");
  }
  if (JSON.stringify(sortJson(parsed)) !== value) {
    throw new Error("cadence archive JSON is not canonical");
  }
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
