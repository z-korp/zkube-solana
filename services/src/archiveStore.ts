import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  link,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import {
  ZKUBE_PROGRAM_ID,
  arenaBoardPda,
  arenaDailyPda,
  type CompetitionKind,
  type KeeperInstructionPlan,
} from "./arcadeChain.js";
import {
  cadenceRoot,
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
  scoreBoardData?: Buffer,
  themeBoardData?: Buffer,
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
    if (!isArchiveOperation(plan.operation)) {
      await this.verifyCommittedChain(plan, identity.kind, identity.id);
      return;
    }
    if (identity.sha256 === undefined) {
      throw new Error("archive plan identity or SHA-256 is invalid");
    }
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
      true,
    );
  }

  private async verifyCommittedChain(
    plan: KeeperInstructionPlan,
    kind: CompetitionKind,
    id: number,
  ): Promise<void> {
    const first = plan.context?.archiveFirstCadenceId;
    const last = plan.context?.previousCadenceId;
    const currentRoot = plan.context?.archiveCurrentRoot;
    const expectedResultHash = plan.context?.archiveResultHash;
    if (!Number.isSafeInteger(first) || first === undefined || first < 0 || first > id ||
        !Number.isSafeInteger(last) || last === undefined || last < id ||
        !/^[0-9a-f]{64}$/.test(currentRoot ?? "") ||
        !/^[0-9a-f]{64}$/.test(expectedResultHash ?? "")) {
      throw new Error("committed archive checkpoint is invalid");
    }
    const target = await this.safePath(kind, id);
    const directory = dirname(target);
    const ids = (await readdir(directory))
      .map((name) => /^(0|[1-9][0-9]*)\.json$/.exec(name)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number)
      .filter((cadenceId) =>
        Number.isSafeInteger(cadenceId) && cadenceId >= first && cadenceId <= last
      )
      .sort((left, right) => left - right);
    if (ids[0] !== first || !ids.includes(id) || ids.at(-1) !== last) {
      throw new ArchiveIntegrityError(
        "missing_committed_archive",
        kind,
        id,
        "committed cadence archive chain is incomplete",
      );
    }
    let root = "00".repeat(32);
    for (const cadenceId of ids) {
      const stored = await this.readStored(kind, cadenceId);
      this.verifyStoredIdentity(kind, cadenceId, stored);
      this.verifyProjection(kind, cadenceId, stored);
      root = cadenceRoot(kind, root, cadenceId, stored.contract.resultHash);
      if (stored.contract.root !== root) {
        throw new ArchiveIntegrityError(
          "immutable_commitment_mismatch",
          kind,
          cadenceId,
          "stored cadence archive root does not match its chain",
        );
      }
      if (cadenceId === id && stored.contract.resultHash !== expectedResultHash) {
        throw new ArchiveIntegrityError(
          "immutable_commitment_mismatch",
          kind,
          id,
          "stored cadence result does not match the live finalized result",
        );
      }
    }
    if (root !== currentRoot) {
      throw new ArchiveIntegrityError(
        "immutable_commitment_mismatch",
        kind,
        id,
        "stored cadence archive chain does not reach the on-chain root",
      );
    }
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
    const stored = this.parseStored(kind, id, bytes);
    const actual = stored.contract;
    if (actual.account !== expected.account ||
        actual.competition !== expected.competition ||
        actual.periodId !== expected.periodId ||
        actual.programId !== expected.programId ||
        actual.resultHash !== expected.resultHash ||
        actual.root !== expected.root ||
        actual.scoreBoard !== expected.scoreBoard ||
        actual.themeBoard !== expected.themeBoard) {
      throw new ArchiveIntegrityError(
        "immutable_commitment_mismatch",
        kind,
        id,
        "stored cadence archive immutable commitment does not match",
      );
    }
    this.verifyProjection(
      kind,
      id,
      stored,
      Buffer.from(expected.resultDataBase64, "base64"),
    );
  }

  private parseStored(
    kind: CompetitionKind,
    id: number,
    bytes: Buffer,
  ): ReturnType<typeof parseCanonicalArchive> {
    try {
      return parseCanonicalArchive(bytes.toString("utf8"));
    } catch (error) {
      throw new ArchiveIntegrityError(
        "existing_archive_invalid",
        kind,
        id,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async readStored(
    kind: CompetitionKind,
    id: number,
  ): Promise<ReturnType<typeof parseCanonicalArchive>> {
    const bytes = await readExistingRegularFile(await this.safePath(kind, id));
    if (!bytes) {
      throw new ArchiveIntegrityError(
        "missing_committed_archive",
        kind,
        id,
        "committed cadence archive file is missing",
      );
    }
    return this.parseStored(kind, id, bytes);
  }

  private verifyStoredIdentity(
    kind: CompetitionKind,
    id: number,
    stored: ReturnType<typeof parseCanonicalArchive>,
  ): void {
    const actual = stored.contract;
    if (actual.competition !== kind || actual.periodId !== id ||
        actual.programId !== ZKUBE_PROGRAM_ID.toBase58() ||
        actual.account !== arenaDailyPda(id).toBase58() ||
        actual.scoreBoard !== arenaBoardPda(arenaDailyPda(id), "score").toBase58() ||
        actual.themeBoard !== arenaBoardPda(arenaDailyPda(id), "theme").toBase58()) {
      throw new ArchiveIntegrityError(
        "immutable_commitment_mismatch",
        kind,
        id,
        "stored cadence archive identity does not match",
      );
    }
  }

  private verifyProjection(
    kind: CompetitionKind,
    id: number,
    stored: ReturnType<typeof parseCanonicalArchive>,
    expectedResultData?: Buffer,
  ): void {
    const actual = stored.contract;
    let projected: Buffer;
    try {
      projected = this.projectResultData(
        kind,
        stored.accountData,
        stored.scoreBoardData,
        stored.themeBoardData,
      );
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
    if ((expectedResultData && !projected.equals(expectedResultData)) ||
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
    if (kind !== "daily" || !Number.isSafeInteger(id) ||
        id < 0 || id > 0xffff_ffff) {
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
  sha256?: string;
} {
  const kind = archiveKind(plan.operation);
  const context = plan.context;
  const id = context?.dayId;
  const hash = context?.archiveFileSha256;
  if (id === undefined || !Number.isSafeInteger(id) || id < 0 || id > 0xffff_ffff) {
    throw new Error("archive plan identity is invalid");
  }
  if (isArchiveOperation(plan.operation) && !/^[0-9a-f]{64}$/.test(hash ?? "")) {
    throw new Error("archive plan identity or SHA-256 is invalid");
  }
  return { kind, id, ...(hash === undefined ? {} : { sha256: hash }) };
}

function archiveKind(operation: string): CompetitionKind {
  if (operation === "archive_arena_daily" ||
      operation === "expire_daily_claims" ||
      operation === "close_arena_daily") {
    return "daily";
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
  const { contract } = parseCanonicalArchive(canonicalJson);
  if (
      contract.competition !== identity.kind ||
      contract.periodId !== identity.id ||
      contract.resultHash !== contextResultHash) {
    throw new Error("archive plan does not carry the canonical commitment");
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
