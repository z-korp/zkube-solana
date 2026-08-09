import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import type { CompetitionKind } from "./arcadeChain.js";

export const CURRENT_ARCHIVE_SCHEMA_VERSION = 1;
const MAX_ARCHIVE_DATA_BYTES = 130_000;
const MAX_ARCHIVE_RESULT_BYTES = 300_000;
const COMMON_FIELDS = [
  "account",
  "accountDataBase64",
  "accountDataSha256",
  "competition",
  "periodId",
  "programId",
  "resultHash",
  "root",
  "schemaVersion",
] as const;

export interface CadenceArchiveContract {
  schemaVersion: 1;
  account: string;
  accountDataBase64: string;
  accountDataSha256: string;
  competition: CompetitionKind;
  periodId: number;
  programId: string;
  resultDataBase64: string;
  scoreBoard: string;
  scoreBoardDataBase64: string;
  scoreBoardDataSha256: string;
  themeBoard: string;
  themeBoardDataBase64: string;
  themeBoardDataSha256: string;
  resultHash: string;
  root: string;
}

export function cadenceResultHash(
  competition: CompetitionKind,
  resultData: Buffer,
): string {
  return createHash("sha256")
    .update(Buffer.from(`zkube-arcade-${competition}-result-v4`, "utf8"))
    .update(resultData)
    .digest("hex");
}

export function cadenceRoot(
  competition: CompetitionKind,
  priorRoot: string,
  cadenceId: number,
  resultHash: string,
): string {
  const id = Buffer.alloc(4);
  id.writeUInt32LE(cadenceId);
  return createHash("sha256")
    .update(Buffer.from(`zkube-arcade-${competition}-root-v1`, "utf8"))
    .update(Buffer.from(priorRoot, "hex"))
    .update(id)
    .update(Buffer.from(resultHash, "hex"))
    .digest("hex");
}

export function canonicalArchive(input: {
  account: PublicKey;
  accountData: Buffer;
  scoreBoard: PublicKey;
  scoreBoardData: Buffer;
  themeBoard: PublicKey;
  themeBoardData: Buffer;
  competition: CompetitionKind;
  periodId: number;
  programId: PublicKey;
  resultData: Buffer;
  root: string;
}): string {
  return canonicalJson({
    account: input.account.toBase58(),
    accountDataBase64: input.accountData.toString("base64"),
    accountDataSha256: sha256(input.accountData),
    competition: input.competition,
    periodId: input.periodId,
    programId: input.programId.toBase58(),
    resultDataBase64: input.resultData.toString("base64"),
    resultHash: cadenceResultHash(input.competition, input.resultData),
    root: input.root,
    schemaVersion: CURRENT_ARCHIVE_SCHEMA_VERSION,
    scoreBoard: input.scoreBoard.toBase58(),
    scoreBoardDataBase64: input.scoreBoardData.toString("base64"),
    scoreBoardDataSha256: sha256(input.scoreBoardData),
    themeBoard: input.themeBoard.toBase58(),
    themeBoardDataBase64: input.themeBoardData.toString("base64"),
    themeBoardDataSha256: sha256(input.themeBoardData),
  });
}

export function parseCanonicalArchive(value: string): {
  contract: CadenceArchiveContract;
  accountData: Buffer;
  resultData: Buffer;
  scoreBoardData: Buffer;
  themeBoardData: Buffer;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("cadence archive is not valid JSON");
  }
  if (!isRecord(parsed) || canonicalJson(parsed) !== value) {
    throw new Error("cadence archive JSON is not canonical");
  }
  const schemaVersion = parsed.schemaVersion;
  if (schemaVersion !== CURRENT_ARCHIVE_SCHEMA_VERSION) {
    throw new Error("cadence archive schema version is unsupported");
  }
  const expectedFields = [
    ...COMMON_FIELDS,
    "resultDataBase64",
    "scoreBoard",
    "scoreBoardDataBase64",
    "scoreBoardDataSha256",
    "themeBoard",
    "themeBoardDataBase64",
    "themeBoardDataSha256",
  ];
  const actualFields = Object.keys(parsed).sort();
  if (actualFields.length !== expectedFields.length ||
      actualFields.some((field, index) =>
        field !== [...expectedFields].sort()[index])) {
    throw new Error("cadence archive fields do not match its schema");
  }
  const competition = parsed.competition;
  if (competition !== "daily") {
    throw new Error("cadence archive competition is invalid");
  }
  const periodId = parsed.periodId;
  if (!Number.isSafeInteger(periodId) || Number(periodId) < 0 ||
      Number(periodId) > 0xffff_ffff) {
    throw new Error("cadence archive period id is invalid");
  }
  const account = canonicalPublicKey(parsed.account, "account");
  const programId = canonicalPublicKey(parsed.programId, "program");
  const accountData = strictBase64(
    parsed.accountDataBase64,
    "account data",
  );
  if (accountData.length < 9 || accountData.length >= MAX_ARCHIVE_DATA_BYTES) {
    throw new Error("cadence archive account data length is invalid");
  }
  const accountDataSha256 = lowerHex(parsed.accountDataSha256, "account data SHA-256");
  if (sha256(accountData) !== accountDataSha256) {
    throw new Error("cadence archive account data SHA-256 does not match");
  }
  const resultHash = lowerHex(parsed.resultHash, "result hash");
  const root = lowerHex(parsed.root, "root");
  const resultData = strictBase64(parsed.resultDataBase64, "result data");
  if (resultData.length === 0 ||
      resultData.length >= MAX_ARCHIVE_RESULT_BYTES) {
    throw new Error("cadence archive result data length is invalid");
  }
  if (cadenceResultHash(competition, resultData) !== resultHash) {
    throw new Error("cadence archive result data does not match its result hash");
  }
  const scoreBoard = canonicalPublicKey(parsed.scoreBoard, "Score board");
  const themeBoard = canonicalPublicKey(parsed.themeBoard, "Theme board");
  const scoreBoardData = strictBase64(parsed.scoreBoardDataBase64, "Score board data");
  const themeBoardData = strictBase64(parsed.themeBoardDataBase64, "Theme board data");
  const scoreBoardDataSha256 = lowerHex(
    parsed.scoreBoardDataSha256,
    "Score board data SHA-256",
  );
  const themeBoardDataSha256 = lowerHex(
    parsed.themeBoardDataSha256,
    "Theme board data SHA-256",
  );
  if ((scoreBoardData.length < 9 ||
      scoreBoardData.length >= MAX_ARCHIVE_DATA_BYTES ||
      sha256(scoreBoardData) !== scoreBoardDataSha256) ||
      (themeBoardData.length < 9 ||
        themeBoardData.length >= MAX_ARCHIVE_DATA_BYTES ||
        sha256(themeBoardData) !== themeBoardDataSha256)) {
    throw new Error("cadence archive board data is invalid");
  }
  return {
    contract: {
      schemaVersion,
      account,
      accountDataBase64: parsed.accountDataBase64 as string,
      accountDataSha256,
      competition: "daily",
      periodId: Number(periodId),
      programId,
      resultDataBase64: parsed.resultDataBase64 as string,
      scoreBoard,
      scoreBoardDataBase64: parsed.scoreBoardDataBase64 as string,
      scoreBoardDataSha256,
      themeBoard,
      themeBoardDataBase64: parsed.themeBoardDataBase64 as string,
      themeBoardDataSha256,
      resultHash,
      root,
    },
    accountData,
    resultData,
    scoreBoardData,
    themeBoardData,
  };
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

function strictBase64(value: unknown, label: string): Buffer {
  if (typeof value !== "string" || value.length === 0 ||
      value.length % 4 !== 0 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        value,
      )) {
    throw new Error(`cadence archive ${label} is not canonical base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new Error(`cadence archive ${label} is not canonical base64`);
  }
  return bytes;
}

function canonicalPublicKey(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`cadence archive ${label} is not a public key`);
  }
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) throw new Error("noncanonical");
    return value;
  } catch {
    throw new Error(`cadence archive ${label} is not a canonical public key`);
  }
}

function lowerHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`cadence archive ${label} is invalid`);
  }
  return value;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
