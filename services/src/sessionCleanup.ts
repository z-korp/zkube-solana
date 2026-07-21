import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";

import { type KeeperInstructionPlan } from "./arcadeChain.js";

export const SESSION_KEYS_PROGRAM_ID = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const SESSION_SEED = Buffer.from("session_token_v2");
const SESSION_BYTES = 144;
const SESSION_DISCRIMINATOR = Buffer.from([178, 3, 85, 254, 13, 116, 128, 41]);
const REVOKE_DISCRIMINATOR = Buffer.from([211, 59, 125, 188, 43, 155, 8, 102]);
const MAX_SESSION_REVOKES = 2;
const MAX_DISCOVERED_SESSION_ACCOUNTS = 10_000;

export async function discoverExpiredSessionPlans(args: {
  connection: Connection;
  keeper: PublicKey;
  targetProgramId: PublicKey;
  nowUnix: number;
}): Promise<KeeperInstructionPlan[]> {
  void args.keeper;
  if (!Number.isSafeInteger(args.nowUnix) || args.nowUnix < 0) {
    throw new Error("session cleanup time is invalid");
  }
  const accounts = await args.connection.getProgramAccounts(SESSION_KEYS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: SESSION_BYTES }],
  });
  if (accounts.length > MAX_DISCOVERED_SESSION_ACCOUNTS) {
    throw new Error("session discovery exceeded its fail-closed account bound");
  }
  const candidates = accounts.flatMap(({ pubkey, account }) => {
    const data = Buffer.from(account.data);
    if (!account.owner.equals(SESSION_KEYS_PROGRAM_ID) || account.executable ||
        data.length !== SESSION_BYTES || !data.subarray(0, 8).equals(SESSION_DISCRIMINATOR)) return [];
    const authority = new PublicKey(data.subarray(8, 40));
    const target = new PublicKey(data.subarray(40, 72));
    const sessionSigner = new PublicKey(data.subarray(72, 104));
    const feePayer = new PublicKey(data.subarray(104, 136));
    const validUntilBig = data.readBigInt64LE(136);
    const validUntil = Number(validUntilBig);
    const expected = PublicKey.findProgramAddressSync(
      [SESSION_SEED, target.toBuffer(), sessionSigner.toBuffer(), authority.toBuffer()],
      SESSION_KEYS_PROGRAM_ID,
    )[0];
    if (!Number.isSafeInteger(validUntil) || validUntil < 0 || validUntil > args.nowUnix ||
        !target.equals(args.targetProgramId) || !pubkey.equals(expected) ||
        !feePayer.equals(authority)) return [];
    return [{ address: pubkey, authority, sessionSigner, feePayer, validUntil }];
  });
  const owners = [...new Map(candidates.map((value) => [value.authority.toBase58(), value.authority])).values()];
  const ownerInfos = owners.length ? await args.connection.getMultipleAccountsInfo(owners, "confirmed") : [];
  const validOwners = new Set(owners.filter((_, index) => {
    const info = ownerInfos[index];
    return !!info && !info.executable && info.owner.equals(SystemProgram.programId) && info.data.length === 0;
  }).map((owner) => owner.toBase58()));
  return candidates.filter((value) => validOwners.has(value.authority.toBase58()))
    .sort((left, right) => left.validUntil - right.validUntil || left.address.toBuffer().compare(right.address.toBuffer()))
    .slice(0, MAX_SESSION_REVOKES)
    .map((session) => ({
      operation: "revoke_expired_session",
      execution: "validation_only",
      context: {
        owner: session.authority,
        sessionSigner: session.sessionSigner,
        sessionAddress: session.address,
        sessionValidUntil: session.validUntil,
      },
    }));
}

export function deriveSessionPda(
  targetProgramId: PublicKey,
  owner: PublicKey,
  sessionSigner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SESSION_SEED, targetProgramId.toBuffer(), sessionSigner.toBuffer(), owner.toBuffer()],
    SESSION_KEYS_PROGRAM_ID,
  )[0];
}

export const REVOKE_SESSION_V2_DISCRIMINATOR = REVOKE_DISCRIMINATOR;
