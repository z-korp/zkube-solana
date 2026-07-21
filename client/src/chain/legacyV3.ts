import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";

import { derivePlayerFundingPda } from "./pdas";

export const LEGACY_ZKUBE_V3_PROGRAM_ID = new PublicKey(
  "Apyuy9VZvg7DLcQhe6KGv3sw2MNzriMjtCx2q7zac1QR",
);
const LEGACY_WITHDRAW_PLAYER_FUNDING_DISCRIMINATOR = Buffer.from([
  186, 115, 58, 115, 207, 128, 127, 224,
]);

export function legacyV3PlayerFundingPda(owner: PublicKey): PublicKey {
  return derivePlayerFundingPda(owner, LEGACY_ZKUBE_V3_PROGRAM_ID);
}

/** Builds the owner-signed, exact legacy-v3 funding reclaim used during v4 enablement. */
export function buildLegacyV3FundingReclaimInstruction(args: {
  owner: PublicKey;
  fundingInfo: AccountInfo<Buffer>;
}): TransactionInstruction | null {
  if (
    args.fundingInfo.executable ||
    !args.fundingInfo.owner.equals(SystemProgram.programId) ||
    args.fundingInfo.data.length !== 0
  ) {
    throw new Error("Legacy v3 player funding has an invalid account layout");
  }
  if (args.fundingInfo.lamports === 0) return null;
  const lamports = new BN(args.fundingInfo.lamports);
  return new TransactionInstruction({
    programId: LEGACY_ZKUBE_V3_PROGRAM_ID,
    keys: [
      {
        pubkey: legacyV3PlayerFundingPda(args.owner),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: args.owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([
      LEGACY_WITHDRAW_PLAYER_FUNDING_DISCRIMINATOR,
      lamports.toArrayLike(Buffer, "le", 8),
    ]),
  });
}
