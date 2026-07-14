import { type Connection, type PublicKey } from "@solana/web3.js";

import { deriveEconomyConfigPda, deriveProtocolConfigPda } from "./pdas";
import { zkubeProgram } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

export interface EconomyRuntime {
  address: PublicKey;
  protocol: PublicKey;
  contentVersion: number;
  dailyRulesVersion: number;
  dailyEntryStars: bigint;
  zoneUnlockStars: bigint;
  paymentMint: PublicKey;
  paymentTokenProgram: PublicKey;
  rewardVault: PublicKey;
}

export async function fetchEconomyRuntime(args: {
  connection: Connection;
  wallet: WalletLike;
}): Promise<EconomyRuntime | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const [protocol, economy] = await Promise.all([
    program.account.protocolConfig.fetchNullable(deriveProtocolConfigPda()),
    program.account.economyConfig.fetchNullable(deriveEconomyConfigPda()),
  ]);
  if (
    !protocol ||
    !economy?.active ||
    Number(economy.contentVersion) !== Number(protocol.contentVersion)
  ) {
    return null;
  }
  return {
    address: deriveEconomyConfigPda(),
    protocol: deriveProtocolConfigPda(),
    contentVersion: Number(economy.contentVersion),
    dailyRulesVersion: Number(economy.dailyRulesVersion),
    dailyEntryStars: BigInt(economy.dailyEntryStars.toString()),
    zoneUnlockStars: BigInt(economy.zoneUnlockStars.toString()),
    paymentMint: protocol.paymentMint,
    paymentTokenProgram: protocol.paymentTokenProgram,
    rewardVault: protocol.rewardVault,
  };
}
