import { type Connection, type PublicKey } from "@solana/web3.js";

import { deriveEconomyConfigPda, deriveProtocolConfigPda } from "./pdas.js";
import { zkubeProgram } from "./runPlan.js";
import type { WalletLike } from "./sessionWallet.js";

export interface EconomyRuntime {
  address: PublicKey;
  protocol: PublicKey;
  contentVersion: number;
  dailyRulesVersion: number;
  dailyRetryCubes: bigint;
  maxPaidDailyRetries: number;
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
    !economy ||
    Number(protocol.version) !== 2 ||
    Number(economy.version) !== 2 ||
    !economy.protocol.equals(deriveProtocolConfigPda()) ||
    Number(economy.contentVersion) !== Number(protocol.contentVersion)
  ) {
    return null;
  }
  return {
    address: deriveEconomyConfigPda(),
    protocol: deriveProtocolConfigPda(),
    contentVersion: Number(economy.contentVersion),
    dailyRulesVersion: Number(economy.dailyRulesVersion),
    dailyRetryCubes: BigInt(economy.dailyRetryCubes.toString()),
    maxPaidDailyRetries: Number(economy.maxPaidDailyRetries),
    rewardVault: protocol.rewardVault,
  };
}
