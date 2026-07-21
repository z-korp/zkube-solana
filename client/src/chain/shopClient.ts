import BN from "bn.js";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type Connection,
  type TransactionInstruction,
} from "@solana/web3.js";

import {
  deriveEconomyConfigPda,
  derivePlayerFundingPda,
  derivePlayerStatePda,
  deriveProtocolConfigPda,
  deriveCubeSalesLedgerPda,
  deriveWeeklyChallengePda,
} from "./pdas";
import { zkubeProgram, type TransactionPlan } from "./runPlan";
import type { WalletLike } from "./sessionWallet";

const CUBE_PACK_COUNT = 4;

export interface CubePackQuote {
  index: number;
  cubes: bigint;
  regularPrice: bigint;
  currentPrice: bigint;
  salePrice: bigint;
  enabled: boolean;
  onSale: boolean;
}

export interface CubeShopView {
  economyVersion: 2;
  revision: bigint;
  playerInitialized: boolean;
  cubesBalance: bigint;
  dailyRetryCubes: bigint;
  maxPaidDailyRetries: number;
  protocolPaused: boolean;
  teamDestination: PublicKey;
  rewardVault: PublicKey;
  treasuryDestination: PublicKey;
  saleEnabled: boolean;
  saleStartsAt: bigint;
  saleEndsAt: bigint;
  saleLive: boolean;
  weeklyChallenge: PublicKey | null;
  packs: readonly CubePackQuote[];
}

export async function fetchCubeShopView(args: {
  connection: Connection;
  wallet: WalletLike;
  nowUnix?: bigint;
}): Promise<CubeShopView | null> {
  const program = zkubeProgram(args.connection, args.wallet);
  const owner = args.wallet.publicKey;
  const protocolAddress = deriveProtocolConfigPda();
  const economyAddress = deriveEconomyConfigPda();
  const playerAddress = derivePlayerStatePda(owner);
  const [protocolInfo, economyInfo, playerInfo] =
    await args.connection.getMultipleAccountsInfo(
      [protocolAddress, economyAddress, playerAddress],
      "confirmed",
    );
  if (!protocolInfo || !economyInfo) return null;

  assertProgramAccount(
    protocolInfo,
    program.programId,
    program.account.protocolConfig.size,
    "ProtocolConfig",
  );
  assertProgramAccount(
    economyInfo,
    program.programId,
    program.account.economyConfig.size,
    "EconomyConfig",
  );

  type ProtocolAccount = Awaited<
    ReturnType<typeof program.account.protocolConfig.fetch>
  >;
  type EconomyAccount = Awaited<
    ReturnType<typeof program.account.economyConfig.fetch>
  >;
  type PlayerAccount = Awaited<
    ReturnType<typeof program.account.playerState.fetch>
  >;
  const protocol = program.coder.accounts.decode(
    "protocolConfig",
    protocolInfo.data,
  ) as unknown as ProtocolAccount;
  const economy = program.coder.accounts.decode(
    "economyConfig",
    economyInfo.data,
  ) as unknown as EconomyAccount;

  if (
    Number(protocol.version) !== 2 ||
    Number(economy.version) !== 2 ||
    !economy.protocol.equals(protocolAddress) ||
    Number(economy.contentVersion) !== Number(protocol.contentVersion)
  ) {
    return null;
  }
  const playerInitialized = Boolean(playerInfo);
  let cubesBalance = 0n;
  if (playerInfo) {
    assertProgramAccount(
      playerInfo,
      program.programId,
      program.account.playerState.size,
      "PlayerState",
    );
    const player = program.coder.accounts.decode(
      "playerState",
      playerInfo.data,
    ) as unknown as PlayerAccount;
    if (
      Number(player.version) !== 2 ||
      !player.owner.equals(owner) ||
      player.levelStars.length !== 80
    ) {
      return null;
    }
    cubesBalance = BigInt(player.cubesBalance.toString());
  }

  const now = args.nowUnix ?? BigInt(Math.floor(Date.now() / 1_000));
  const saleStartsAt = BigInt(economy.saleStartsAt.toString());
  const saleEndsAt = BigInt(economy.saleEndsAt.toString());
  const saleEnabled = Boolean(economy.saleEnabled);
  if (saleEnabled && saleStartsAt >= saleEndsAt) {
    throw new Error("Shop sale window is invalid");
  }
  const saleLive = saleEnabled && now >= saleStartsAt && now < saleEndsAt;
  if (BigInt(economy.dailyRetryCubes.toString()) <= 0n) {
    throw new Error("Shop spending rules are invalid");
  }
  const packs = economy.cubePackCubes.map((rawCubes, index) => {
    const cubes = BigInt(rawCubes.toString());
    const regularPrice = BigInt(economy.cubePackPrices[index].toString());
    const salePrice = BigInt(economy.salePrices[index].toString());
    const enabled = Boolean(economy.cubePackEnabled[index]);
    if (
      index >= CUBE_PACK_COUNT ||
      (enabled && (cubes <= 0n || regularPrice <= 0n)) ||
      (saleEnabled && enabled && (salePrice <= 0n || salePrice > regularPrice))
    ) {
      throw new Error(`Cube pack ${index + 1} is invalid`);
    }
    return {
      index,
      cubes,
      regularPrice,
      currentPrice: saleLive ? salePrice : regularPrice,
      salePrice,
      enabled,
      onSale: saleLive && salePrice < regularPrice,
    };
  });
  if (packs.length !== CUBE_PACK_COUNT) {
    throw new Error("Shop must expose exactly four Cube packs");
  }
  const weeklyId = Math.max(0, Math.floor((Number(now) + 259_200) / 1_209_600));
  const weeklyAddress = deriveWeeklyChallengePda(weeklyId);
  const weeklyChallenge = (await args.connection.getAccountInfo(weeklyAddress, "confirmed"))
    ? weeklyAddress
    : null;

  return {
    economyVersion: 2,
    revision: BigInt(economy.revision.toString()),
    playerInitialized,
    cubesBalance,
    dailyRetryCubes: BigInt(economy.dailyRetryCubes.toString()),
    maxPaidDailyRetries: Number(economy.maxPaidDailyRetries),
    protocolPaused: Boolean(protocol.paused),
    teamDestination: protocol.teamDestination,
    rewardVault: protocol.rewardVault,
    treasuryDestination: protocol.treasuryDestination,
    saleEnabled,
    saleStartsAt,
    saleEndsAt,
    saleLive,
    weeklyChallenge,
    packs,
  };
}

export function hasCubePackQuoteChanged(
  quoted: CubePackQuote,
  fresh: CubePackQuote | undefined,
): boolean {
  return (
    !fresh ||
    quoted.index !== fresh.index ||
    quoted.cubes !== fresh.cubes ||
    quoted.currentPrice !== fresh.currentPrice ||
    quoted.enabled !== fresh.enabled
  );
}

export async function buildCubePurchasePlan(args: {
  connection: Connection;
  wallet: WalletLike;
  shop: CubeShopView;
  packIndex: number;
}): Promise<TransactionPlan> {
  if (
    !Number.isInteger(args.packIndex) ||
    args.packIndex < 0 ||
    args.packIndex >= args.shop.packs.length
  ) {
    throw new Error("Unknown Cube pack");
  }
  if (args.shop.protocolPaused) throw new Error("The Shop is temporarily paused");
  const pack = args.shop.packs[args.packIndex];
  if (!pack.enabled) throw new Error("Cube pack is disabled");

  const owner = args.wallet.publicKey;
  const program = zkubeProgram(args.connection, args.wallet);
  const instructions: TransactionInstruction[] = [];
  if (!args.shop.playerInitialized) {
    instructions.push(
      await program.methods
        .initializePlayer()
        .accountsPartial({
          playerState: derivePlayerStatePda(owner),
          playerFunding: derivePlayerFundingPda(owner),
          payer: owner,
          ownerAuthority: owner,
          sessionToken: null,
          actor: owner,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    );
  }
  instructions.push(
    await program.methods
      .purchaseCubes(
        args.packIndex,
        new BN(pack.cubes.toString()),
        new BN(pack.currentPrice.toString()),
      )
      .accountsPartial({
        protocol: deriveProtocolConfigPda(),
        economyConfig: deriveEconomyConfigPda(),
        cubeSalesLedger: deriveCubeSalesLedgerPda(),
        playerState: derivePlayerStatePda(owner),
        teamDestination: args.shop.teamDestination,
        rewardVault: args.shop.rewardVault,
        weeklyChallenge: args.shop.weeklyChallenge,
        treasuryDestination: args.shop.treasuryDestination,
        owner,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  );
  return {
    layer: "solana-base",
    label: args.shop.playerInitialized
      ? "Purchase Cubes"
      : "Initialize player and purchase Cubes",
    connection: args.connection,
    transaction: new Transaction().add(...instructions),
    feePayer: owner,
    signers: [],
  };
}

function assertProgramAccount(
  info: AccountInfo<Buffer>,
  programId: PublicKey,
  expectedSize: number,
  label: string,
): void {
  if (!info.owner.equals(programId)) {
    throw new Error(`${label} has the wrong owner`);
  }
  if (info.executable) throw new Error(`${label} must not be executable`);
  if (info.data.length !== expectedSize) {
    throw new Error(`${label} has invalid data length ${info.data.length}`);
  }
}
