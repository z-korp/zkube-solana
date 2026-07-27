import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";

import type { CompetitionKind } from "./arcadeChain.js";

export const SUPPORTED_ARCHIVE_SCHEMA_VERSIONS = [1, 2] as const;
export const CURRENT_ARCHIVE_SCHEMA_VERSION = 2;
const MAX_ARCHIVE_DATA_BYTES = 10_240;
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
  schemaVersion: 1 | 2;
  account: string;
  accountDataBase64: string;
  accountDataSha256: string;
  competition: CompetitionKind;
  periodId: number;
  programId: string;
  resultDataBase64?: string;
  resultHash: string;
  root: string;
}

export function cadenceResultHash(
  competition: CompetitionKind,
  resultData: Buffer,
): string {
  return createHash("sha256")
    .update(Buffer.from(`zkube-arcade-${competition}-result-v1`, "utf8"))
    .update(resultData)
    .digest("hex");
}

export function canonicalArchiveV2(input: {
  account: PublicKey;
  accountData: Buffer;
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
  });
}

export function parseCanonicalArchive(value: string): {
  contract: CadenceArchiveContract;
  accountData: Buffer;
  resultData?: Buffer;
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
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error("cadence archive schema version is unsupported");
  }
  const expectedFields = schemaVersion === 2
    ? [...COMMON_FIELDS, "resultDataBase64"]
    : [...COMMON_FIELDS];
  const actualFields = Object.keys(parsed).sort();
  if (actualFields.length !== expectedFields.length ||
      actualFields.some((field, index) =>
        field !== [...expectedFields].sort()[index])) {
    throw new Error("cadence archive fields do not match its schema");
  }
  const competition = parsed.competition;
  if (competition !== "daily" &&
      competition !== "weekly" &&
      competition !== "season") {
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
  const resultData = schemaVersion === 2
    ? strictBase64(parsed.resultDataBase64, "result data")
    : undefined;
  if (resultData && (resultData.length === 0 ||
      resultData.length >= MAX_ARCHIVE_DATA_BYTES)) {
    throw new Error("cadence archive result data length is invalid");
  }
  if (resultData && cadenceResultHash(competition, resultData) !== resultHash) {
    throw new Error("cadence archive result data does not match its result hash");
  }
  return {
    contract: {
      schemaVersion,
      account,
      accountDataBase64: parsed.accountDataBase64 as string,
      accountDataSha256,
      competition,
      periodId: Number(periodId),
      programId,
      ...(resultData
        ? { resultDataBase64: parsed.resultDataBase64 as string }
        : {}),
      resultHash,
      root,
    },
    accountData,
    resultData,
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
