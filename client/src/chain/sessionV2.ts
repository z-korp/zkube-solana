import {
  type AccountInfo,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { ZKUBE_PROGRAM_ID } from "./constants.js";

export const SESSION_KEYS_PROGRAM_ID = new PublicKey(
  "KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5",
);
export const SESSION_TOKEN_V2_SEED = "session_token_v2";
export const CREATE_SESSION_V2_DISCRIMINATOR = [223, 233, 108, 7, 65, 194, 235, 38] as const;
export const SESSION_TOKEN_V2_DISCRIMINATOR = [178, 3, 85, 254, 13, 116, 128, 41] as const;
export const SESSION_TOKEN_V2_ACCOUNT_BYTES = 144;

export interface SessionTokenV2View {
  authority: PublicKey;
  targetProgram: PublicKey;
  sessionSigner: PublicKey;
  feePayer: PublicKey;
  validUntil: number;
}

export interface CreateSessionV2Args {
  authority: PublicKey;
  sessionSigner: PublicKey;
  feePayer: PublicKey;
  targetProgram?: PublicKey;
  topUp?: boolean | null;
  validUntil?: bigint | number | null;
  lamports?: bigint | number | null;
}

export function deriveSessionTokenV2Pda(args: {
  authority: PublicKey;
  sessionSigner: PublicKey;
  targetProgram?: PublicKey;
}): { sessionToken: PublicKey; bump: number } {
  const [sessionToken, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(SESSION_TOKEN_V2_SEED),
      (args.targetProgram ?? ZKUBE_PROGRAM_ID).toBuffer(),
      args.sessionSigner.toBuffer(),
      args.authority.toBuffer(),
    ],
    SESSION_KEYS_PROGRAM_ID,
  );
  return { sessionToken, bump };
}

export function buildCreateSessionV2Instruction(args: CreateSessionV2Args): TransactionInstruction {
  const targetProgram = args.targetProgram ?? ZKUBE_PROGRAM_ID;
  const { sessionToken } = deriveSessionTokenV2Pda({
    authority: args.authority,
    sessionSigner: args.sessionSigner,
    targetProgram,
  });
  return new TransactionInstruction({
    programId: SESSION_KEYS_PROGRAM_ID,
    keys: [
      meta(sessionToken, false, true),
      meta(args.sessionSigner, true, true),
      meta(args.feePayer, true, true),
      meta(args.authority, true, false),
      meta(targetProgram, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: Uint8Array.from([
      ...CREATE_SESSION_V2_DISCRIMINATOR,
      ...optionBool(args.topUp),
      ...optionI64(args.validUntil),
      ...optionU64(args.lamports),
    ]) as TransactionInstruction["data"],
  });
}

export function decodeSessionTokenV2Account(
  address: PublicKey,
  info: AccountInfo<Buffer>,
): SessionTokenV2View {
  if (!info.owner.equals(SESSION_KEYS_PROGRAM_ID) || info.executable) {
    throw new Error("Session token has the wrong account owner");
  }
  if (info.data.length !== SESSION_TOKEN_V2_ACCOUNT_BYTES) {
    throw new Error("Session token has an invalid data length");
  }
  if (
    !SESSION_TOKEN_V2_DISCRIMINATOR.every(
      (byte, index) => info.data[index] === byte,
    )
  ) {
    throw new Error("Session token discriminator is invalid");
  }
  const authority = new PublicKey(info.data.subarray(8, 40));
  const targetProgram = new PublicKey(info.data.subarray(40, 72));
  const sessionSigner = new PublicKey(info.data.subarray(72, 104));
  const feePayer = new PublicKey(info.data.subarray(104, 136));
  const validUntilBig = info.data.readBigInt64LE(136);
  if (
    validUntilBig < BigInt(Number.MIN_SAFE_INTEGER) ||
    validUntilBig > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error("Session token expiry is outside the safe integer range");
  }
  const expected = deriveSessionTokenV2Pda({
    authority,
    sessionSigner,
    targetProgram,
  }).sessionToken;
  if (!address.equals(expected)) {
    throw new Error("Session token PDA does not match its serialized fields");
  }
  return {
    authority,
    targetProgram,
    sessionSigner,
    feePayer,
    validUntil: Number(validUntilBig),
  };
}

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}

function optionBool(value: boolean | null | undefined): number[] {
  return value == null ? [0] : [1, value ? 1 : 0];
}

function optionI64(value: bigint | number | null | undefined): number[] {
  if (value == null) return [0];
  const integer = BigInt(value);
  if (integer < -(1n << 63n) || integer > (1n << 63n) - 1n) {
    throw new Error("validUntil must fit in i64");
  }
  return [1, ...u64(integer < 0 ? (1n << 64n) + integer : integer)];
}

function optionU64(value: bigint | number | null | undefined): number[] {
  return value == null ? [0] : [1, ...u64(BigInt(value))];
}

function u64(value: bigint): number[] {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new Error("lamports must fit in u64");
  }
  const bytes: number[] = [];
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    bytes.push(Number(remaining & 0xffn));
    remaining >>= 8n;
  }
  return bytes;
}
