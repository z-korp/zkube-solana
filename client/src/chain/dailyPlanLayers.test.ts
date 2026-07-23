// @vitest-environment node

import { BorshAccountsCoder, convertIdlToCamelCase } from "@anchor-lang/core";
import { Buffer } from "buffer";
import {
  Connection,
  Keypair,
  type AccountInfo,
  type PublicKey,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  assertRankedEntryDependencies,
  buildFinalizeDailyChallengePlan,
  buildPrepareDailyRunPlan,
  buildPreparePracticeRunPlan,
  isPracticeEntryWindowOpen,
  practiceEntriesCloseAt,
  practiceRunsCloseAt,
  type DailyView,
} from "./dailyClient";
import { ZKUBE_PROGRAM_ID } from "./constants";
import { IDL } from "./idl";
import {
  deriveArcadeConfigPda,
  deriveArenaDailyPda,
  deriveOperatorRevenueVaultPda,
  derivePlayerFundingPda,
  deriveProtocolConfigPda,
  deriveSeasonPda,
  deriveWeeklyJackpotPda,
} from "./pdas";
import {
  ARCADE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
} from "./protocolVersions.generated";
import { SessionWallet } from "./sessionWallet";

const coder = new BorshAccountsCoder(convertIdlToCamelCase(IDL));

function account(
  name: string,
  size: number,
  initialize: (data: Buffer) => void = () => undefined,
  version = ARCADE_ACCOUNT_VERSION,
): AccountInfo<Buffer> {
  const data = Buffer.alloc(size);
  coder.accountDiscriminator(name).copy(data);
  data.writeUInt8(version, 8);
  initialize(data);
  return {
    data,
    executable: false,
    lamports: 1,
    owner: ZKUBE_PROGRAM_ID,
    rentEpoch: 0,
  };
}

function writePublicKey(data: Buffer, offset: number, value: PublicKey): void {
  value.toBuffer().copy(data, offset);
}

function rankedDependencyInfos(
  daily: DailyView,
): Array<AccountInfo<Buffer> | null> {
  const protocol = deriveProtocolConfigPda();
  const arcadeConfig = deriveArcadeConfigPda();
  const dailyAccount = (dayId: number, current: boolean) =>
    account("arenaDaily", 7_426, (data) => {
      data.writeUInt32LE(dayId, 9);
      if (current) {
        data.writeUInt32LE(daily.weeklyId, 13);
        data.writeUInt32LE(daily.seasonId, 17);
      }
      writePublicKey(data, 21, arcadeConfig);
    });
  const cadenceAccount = (
    name: "weeklyJackpot" | "season",
    size: number,
    id: number,
  ) =>
    account(name, size, (data) => {
      data.writeUInt32LE(id, 9);
      writePublicKey(data, 17, arcadeConfig);
    });

  return [
    account("protocolConfig", 156, () => undefined, PROTOCOL_ACCOUNT_VERSION),
    account("arcadeConfig", 119, (data) => {
      writePublicKey(data, 9, protocol);
      data.writeBigUInt64LE(daily.entryLamports, 73);
    }),
    dailyAccount(daily.dayId, true),
    cadenceAccount("weeklyJackpot", 5_925, daily.weeklyId),
    cadenceAccount("season", 2_222, daily.seasonId),
    dailyAccount(daily.dayId + 1, false),
    cadenceAccount("weeklyJackpot", 5_925, daily.weeklyId + 1),
    cadenceAccount("season", 2_222, daily.seasonId + 1),
    account("operatorRevenueVault", 58, (data) =>
      writePublicKey(data, 9, protocol),
    ),
  ];
}

describe("Daily transaction layer boundaries", () => {
  it("keeps Daily preparation and challenge finalization on Solana base", async () => {
    const signer = Keypair.generate();
    const wallet = new SessionWallet(signer);
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "confirmed",
    );
    const daily = {
      address: deriveArenaDailyPda(20),
      nextRunId: 7n,
      activeRunId: 0n,
      entryLamports: 20_000_000n,
      dayId: 20,
      weeklyId: 1,
      seasonId: 1,
      leaderboard: [],
    } as DailyView;
    vi.spyOn(connection, "getMultipleAccountsInfo")
      .mockResolvedValueOnce(rankedDependencyInfos(daily))
      .mockResolvedValueOnce([null]);

    const prepared = await buildPrepareDailyRunPlan({
      connection,
      wallet,
      ownerAuthority: signer.publicKey,
      sessionToken: Keypair.generate().publicKey,
      daily,
      sessionValidUntil: 1_800_000_000,
    });
    expect(prepared.transactionPlan.layer).toBe("solana-base");
    expect(prepared.transactionPlan.connection).toBe(connection);
    expect(prepared.transactionPlan.label).toContain("exact 0.02 SOL");
    const enterAccounts =
      prepared.transactionPlan.transaction.instructions[0].keys;
    const playerFunding = enterAccounts.find(({ pubkey }) =>
      pubkey.equals(derivePlayerFundingPda(signer.publicKey)),
    );
    const owner = enterAccounts.find(({ pubkey }) =>
      pubkey.equals(signer.publicKey),
    );
    expect(playerFunding).toMatchObject({ isWritable: true, isSigner: false });
    expect(owner).toMatchObject({ isWritable: true, isSigner: true });

    const finalized = await buildFinalizeDailyChallengePlan({
      connection,
      wallet,
      daily,
    });
    expect(finalized.layer).toBe("solana-base");
    expect(finalized.connection).toBe(connection);
  });

  it("uses the narrow player-funding PDA for free Practice rent", async () => {
    const owner = Keypair.generate();
    const session = Keypair.generate();
    const wallet = new SessionWallet(session);
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "confirmed",
    );
    vi.spyOn(connection, "getMultipleAccountsInfo").mockResolvedValue([null]);
    const daily = {
      address: Keypair.generate().publicKey,
      dayId: 20,
      status: "finalized",
      nextRunId: 8n,
    } as DailyView;

    const prepared = await buildPreparePracticeRunPlan({
      connection,
      wallet,
      ownerAuthority: owner.publicKey,
      sessionToken: Keypair.generate().publicKey,
      daily,
      sessionValidUntil: 1_800_000_000,
      nowUnix: 20 * 86_400 + 1,
    });

    expect(prepared.transactionPlan.label).toBe("Prepare free Practice run");
    expect(prepared.transactionPlan.feePayer.equals(session.publicKey)).toBe(
      true,
    );
    const accounts = prepared.transactionPlan.transaction.instructions[0].keys;
    expect(
      accounts.find(({ pubkey }) =>
        pubkey.equals(derivePlayerFundingPda(owner.publicKey)),
      ),
    ).toMatchObject({ isWritable: true, isSigner: false });
    expect(
      accounts.find(({ pubkey }) => pubkey.equals(owner.publicKey)),
    ).toMatchObject({ isSigner: false });
    expect(
      accounts.find(({ pubkey }) => pubkey.equals(session.publicKey)),
    ).toMatchObject({ isSigner: true });
  });

  it("closes new Practice preparation exactly at 23:45 UTC", async () => {
    const dayStart = 20 * 86_400;
    expect(practiceEntriesCloseAt(dayStart)).toBe(dayStart + 85_500);
    expect(practiceRunsCloseAt(dayStart)).toBe(dayStart + 86_340);
    expect(isPracticeEntryWindowOpen(dayStart + 85_499)).toBe(true);
    expect(isPracticeEntryWindowOpen(dayStart + 85_500)).toBe(false);
    const owner = Keypair.generate();
    await expect(
      buildPreparePracticeRunPlan({
        connection: {} as Connection,
        wallet: new SessionWallet(Keypair.generate()),
        ownerAuthority: owner.publicKey,
        sessionToken: Keypair.generate().publicKey,
        daily: {
          status: "finalized",
          nextRunId: 9n,
        } as DailyView,
        sessionValidUntil: 1_800_000_000,
        nowUnix: dayStart + 85_500,
      }),
    ).rejects.toThrow("closes at 23:45 UTC");
  });

  it("rejects a missing following Daily before constructing a ranked entry", async () => {
    const owner = Keypair.generate();
    const daily = {
      address: deriveArenaDailyPda(20),
      dayId: 20,
      weeklyId: 1,
      seasonId: 1,
      entryLamports: 20_000_000n,
    } as DailyView;
    const infos = rankedDependencyInfos(daily);
    infos[5] = null;
    const connection = {
      getMultipleAccountsInfo: vi.fn().mockResolvedValue(infos),
    } as unknown as Connection;

    await expect(
      assertRankedEntryDependencies({
        connection,
        wallet: new SessionWallet(owner),
        daily,
      }),
    ).rejects.toThrow(
      "following Daily is not prepared. Your wallet was not prompted and no entry was charged",
    );
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith(
      [
        deriveProtocolConfigPda(),
        deriveArcadeConfigPda(),
        deriveArenaDailyPda(20),
        deriveWeeklyJackpotPda(1),
        deriveSeasonPda(1),
        deriveArenaDailyPda(21),
        deriveWeeklyJackpotPda(2),
        deriveSeasonPda(2),
        deriveOperatorRevenueVaultPda(),
      ],
      "confirmed",
    );
  });
});
