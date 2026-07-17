import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type Connection,
} from "@solana/web3.js";

import { ZKUBE_PROGRAM_ID } from "./constants.js";
import type { TransactionPlan } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";
import {
  decodeSessionTokenV2Account,
  deriveSessionTokenV2Pda,
  SESSION_KEYS_PROGRAM_ID,
  SESSION_TOKEN_V2_ACCOUNT_BYTES,
  type SessionTokenV2View,
} from "./sessionV2.js";

export const REVOKE_SESSION_V2_DISCRIMINATOR = [
  211, 59, 125, 188, 43, 155, 8, 102,
] as const;

export interface ExpiredZkubeSession extends SessionTokenV2View {
  address: PublicKey;
}

/**
 * Returns only expired, internally consistent zKube sessions whose authority
 * and rent recipient are valid system accounts. RPC results are treated as
 * untrusted and decoded again before an instruction is constructed.
 */
export async function fetchExpiredZkubeSessions(args: {
  connection: Connection;
  nowUnix: number;
  maximum?: number;
}): Promise<ExpiredZkubeSession[]> {
  if (!Number.isSafeInteger(args.nowUnix)) {
    throw new Error("session cleanup time must be a safe integer");
  }
  const maximum = args.maximum ?? 32;
  if (!Number.isSafeInteger(maximum) || maximum < 0) {
    throw new Error("session cleanup maximum must be a nonnegative integer");
  }

  const accounts = await args.connection.getProgramAccounts(
    SESSION_KEYS_PROGRAM_ID,
    {
      commitment: "confirmed",
      filters: [{ dataSize: SESSION_TOKEN_V2_ACCOUNT_BYTES }],
    },
  );
  const decoded = accounts.flatMap(({ pubkey, account }) => {
    try {
      const token = decodeSessionTokenV2Account(pubkey, account);
      if (
        !token.targetProgram.equals(ZKUBE_PROGRAM_ID) ||
        token.validUntil > args.nowUnix
      ) {
        return [];
      }
      return [{ address: pubkey, ...token }];
    } catch {
      return [];
    }
  });

  const systemAddresses = new Map<string, PublicKey>();
  for (const candidate of decoded) {
    systemAddresses.set(candidate.authority.toBase58(), candidate.authority);
    systemAddresses.set(candidate.feePayer.toBase58(), candidate.feePayer);
  }
  const addresses = [...systemAddresses.values()];
  const infos = addresses.length
    ? await args.connection.getMultipleAccountsInfo(addresses, "confirmed")
    : [];
  const validSystemAccounts = new Set<string>();
  for (let index = 0; index < addresses.length; index += 1) {
    const info = infos[index];
    if (
      info &&
      !info.executable &&
      info.owner.equals(SystemProgram.programId) &&
      info.data.length === 0
    ) {
      validSystemAccounts.add(addresses[index]!.toBase58());
    }
  }

  return decoded
    .filter(
      (candidate) =>
        validSystemAccounts.has(candidate.authority.toBase58()) &&
        validSystemAccounts.has(candidate.feePayer.toBase58()),
    )
    .sort(
      (left, right) =>
        left.validUntil - right.validUntil ||
        left.address.toBuffer().compare(right.address.toBuffer()),
    )
    .slice(0, maximum);
}

export function buildRevokeExpiredSessionPlan(args: {
  connection: Connection;
  wallet: WalletLike;
  session: ExpiredZkubeSession;
  nowUnix: number;
}): TransactionPlan {
  const instruction = buildRevokeExpiredSessionInstruction(
    args.session,
    args.nowUnix,
  );
  return {
    layer: "solana-base",
    label: "Revoke expired zKube session",
    connection: args.connection,
    transaction: new Transaction().add(instruction),
    feePayer: args.wallet.publicKey,
    signers: [],
  };
}

export function buildRevokeExpiredSessionInstruction(
  session: ExpiredZkubeSession,
  nowUnix: number,
): TransactionInstruction {
  validateExpiredZkubeSession(session, nowUnix);
  return new TransactionInstruction({
    programId: SESSION_KEYS_PROGRAM_ID,
    keys: [
      meta(session.address, false, true),
      meta(session.feePayer, false, true),
      meta(session.authority, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.from(REVOKE_SESSION_V2_DISCRIMINATOR),
  });
}

function validateExpiredZkubeSession(
  session: ExpiredZkubeSession,
  nowUnix: number,
): void {
  if (!Number.isSafeInteger(nowUnix) || session.validUntil > nowUnix) {
    throw new Error("session is still active");
  }
  if (!session.targetProgram.equals(ZKUBE_PROGRAM_ID)) {
    throw new Error("session targets a different program");
  }
  const expected = deriveSessionTokenV2Pda({
    authority: session.authority,
    sessionSigner: session.sessionSigner,
    targetProgram: session.targetProgram,
  }).sessionToken;
  if (!session.address.equals(expected)) {
    throw new Error("session token PDA does not match its fields");
  }
}

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}
