import { PublicKey, SystemProgram, TransactionInstruction, type Connection } from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID, type KeeperInstructionPlan } from "./arcadeChain.js";

export const SESSION_KEYS_PROGRAM_ID = new PublicKey("KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5");
const SESSION_SEED = Buffer.from("session_token_v2");
const SESSION_BYTES = 144;
const SESSION_DISCRIMINATOR = Buffer.from([178, 3, 85, 254, 13, 116, 128, 41]);
const REVOKE_DISCRIMINATOR = Buffer.from([211, 59, 125, 188, 43, 155, 8, 102]);
const MAX_SESSION_REVOKES = 2;

export async function discoverExpiredSessionPlans(args: {
  connection: Connection;
  keeper: PublicKey;
  nowUnix: number;
}): Promise<KeeperInstructionPlan[]> {
  const accounts = await args.connection.getProgramAccounts(SESSION_KEYS_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ dataSize: SESSION_BYTES }],
  });
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
    if (!Number.isSafeInteger(validUntil) || validUntil > args.nowUnix ||
        !target.equals(ZKUBE_PROGRAM_ID) || !pubkey.equals(expected) || !feePayer.equals(authority)) return [];
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
      context: { owner: session.authority, sessionSigner: session.sessionSigner },
      instruction: new TransactionInstruction({
        programId: SESSION_KEYS_PROGRAM_ID,
        keys: [
          { pubkey: session.address, isSigner: false, isWritable: true },
          { pubkey: session.feePayer, isSigner: false, isWritable: true },
          { pubkey: session.authority, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: REVOKE_DISCRIMINATOR,
      }),
    }));
}

export function deriveSessionPda(owner: PublicKey, sessionSigner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SESSION_SEED, ZKUBE_PROGRAM_ID.toBuffer(), sessionSigner.toBuffer(), owner.toBuffer()],
    SESSION_KEYS_PROGRAM_ID,
  )[0];
}

export function isRevokeSessionData(data: Buffer): boolean {
  return data.equals(REVOKE_DISCRIMINATOR);
}
