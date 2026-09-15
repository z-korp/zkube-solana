// @vitest-environment node

import { BorshAccountsCoder, convertIdlToCamelCase, type IdlType } from "@anchor-lang/core";
import BN from "bn.js";
import { Buffer } from "buffer";
import {
  Connection,
  Keypair,
  type AccountInfo,
  PublicKey,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  assertRankedEntryDependencies,
  buildFinalizeDailyChallengePlan,
  buildPrepareDailyRunPlan,
  buildPurchaseKreditsPlan,
  type DailyView,
} from "./dailyClient";
import { ZKUBE_PROGRAM_ID } from "../constants";
import { IDL } from "../idl";
import {
  deriveArcadeConfigPda,
  deriveArenaBoardPda,
  deriveArenaDailyPda,
  deriveCreditVaultPda,
  deriveOperatorRevenueVaultPda,
  deriveProtocolConfigPda,
} from "../pdas";
import {
  ARCADE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
} from "../../../core/protocolVersions.generated";
import { SessionWallet } from "../session/sessionWallet";

const idl = convertIdlToCamelCase(IDL);
const coder = new BorshAccountsCoder(idl);

function zero(type: IdlType): unknown {
  if (typeof type === "string") {
    if (type === "pubkey") return PublicKey.default;
    if (type === "bool") return false;
    return ["u64", "i64", "u128"].includes(type) ? new BN(0) : 0;
  }
  if ("array" in type) return Array.from({ length: Number(type.array[1]) }, () => zero(type.array[0]));
  if ("option" in type) return null;
  if ("defined" in type) {
    const definition = idl.types.find(item => item.name === type.defined.name)?.type;
    if (definition?.kind === "struct") return Object.fromEntries((definition.fields ?? []).map(field => {
      if (!("name" in field)) throw new Error("Unsupported tuple fixture");
      return [field.name, zero(field.type)];
    }));
    if (definition?.kind === "enum") return { [definition.variants[0].name]: {} };
  }
  throw new Error("Unsupported fixed account fixture");
}

async function account(
  name: string,
  fields: Record<string, unknown> = {},
  version = ARCADE_ACCOUNT_VERSION,
): Promise<AccountInfo<Buffer>> {
  const data = Buffer.alloc(coder.size(name));
  (await coder.encode(name, { ...(zero({ defined: { name } }) as object), version, ...fields })).copy(data);
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

async function rankedDependencyInfos(
  daily: DailyView,
): Promise<Array<AccountInfo<Buffer> | null>> {
  const protocol = deriveProtocolConfigPda();
  const arcadeConfig = deriveArcadeConfigPda();
  const dailyAccount = (dayId: number) =>
    account("arenaDaily", { dayId, arcadeConfig });

  return Promise.all([
    account("protocolConfig", {}, PROTOCOL_ACCOUNT_VERSION),
    account("arcadeConfig", { protocol }),
    dailyAccount(daily.dayId),
    dailyAccount(daily.dayId + 1),
    account("creditVault", { protocol }),
  ]);
}

function claimableBoard(
  daily: PublicKey,
  dayId: number,
  owner: PublicKey,
): AccountInfo<Buffer> {
  const data = Buffer.alloc(125 + 84 + 1);
  coder.accountDiscriminator("arenaBoard").copy(data);
  data.writeUInt8(ARCADE_ACCOUNT_VERSION, 8);
  writePublicKey(data, 9, daily);
  data.writeUInt32LE(dayId, 41);
  data.writeUInt8(0, 45);
  data.writeUInt32LE(1, 46);
  data.writeUInt32LE(1, 50);
  data.writeUInt32LE(1, 54);
  // A sealed board carries the pool and denominator its payouts were computed
  // from; without them the row is not payable and is correctly skipped.
  data.writeBigUInt64LE(0xffff_ffff_ffff_ffffn, 58);
  data.writeBigUInt64LE(0n, 66);
  data.writeBigUInt64LE(1_000_000_000n, 74);
  data.writeUInt32LE(1, 99);
  data.writeUInt8(1, 103);
  data.writeBigInt64LE(BigInt(Math.floor(Date.now() / 1_000)), 104);
  writePublicKey(data, 125, owner);
  return {
    data,
    executable: false,
    lamports: 1,
    owner: ZKUBE_PROGRAM_ID,
    rentEpoch: 0,
  };
}

describe("Daily transaction layer boundaries", () => {
  it("uses current IDL allocations and protocol economics for entry dependencies", async () => {
    const owner = Keypair.generate();
    const daily = { address: deriveArenaDailyPda(20), dayId: 20, followingDayId: 21,
      entryLamports: 10_000_000n } as DailyView;
    const infos = await rankedDependencyInfos(daily);
    const connection = { getMultipleAccountsInfo: vi.fn().mockResolvedValue(infos) } as unknown as Connection;
    const args = { connection, wallet: new SessionWallet(owner), daily };
    await expect(assertRankedEntryDependencies(args)).resolves.toHaveProperty("currentDaily", daily.address);
    await expect(assertRankedEntryDependencies({ ...args, daily: { ...daily, entryLamports: 1n } }))
      .rejects.toThrow("entry price does not match the protocol");
    // A valid older-sized envelope cannot masquerade as the current account.
    infos[1] = { ...infos[1]!, data: Buffer.concat([infos[1]!.data, Buffer.from([0])]) };
    await expect(assertRankedEntryDependencies(args)).rejects.toThrow("Arcade config owner or allocation is invalid");
  });

  it("keeps Daily preparation and challenge finalization on Solana base", async () => {
    const owner = Keypair.generate();
    const device = Keypair.generate();
    const wallet = new SessionWallet(device);
    const connection = new Connection(
      "https://api.devnet.solana.com",
      "confirmed",
    );
    const daily = {
      address: deriveArenaDailyPda(20),
      nextRunId: 7n,
      activeRunId: 0n,
      entryLamports: 10_000_000n,
      dailyPotLamports: 0n,
      kreditBalance: 1n,
      dayId: 20,
      followingDayId: 21,
      leaderboard: [],
      themeLeaderboard: [],
      scoreQualifiedPlayers: 0,
      themeQualifiedPlayers: 0,
    } as DailyView;
    const claimDaily = deriveArenaDailyPda(19);
    const claimBoards = Array<AccountInfo<Buffer> | null>(40).fill(null);
    claimBoards[38] = claimableBoard(claimDaily, 19, owner.publicKey);
    vi.spyOn(connection, "getMultipleAccountsInfo")
      .mockResolvedValueOnce(await rankedDependencyInfos(daily))
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce(claimBoards);

    const prepared = await buildPrepareDailyRunPlan({
      connection,
      wallet,
      ownerAuthority: owner.publicKey,
      sessionToken: Keypair.generate().publicKey,
      daily,
      sessionValidUntil: 1_800_000_000,
    });
    expect(prepared.transactionPlan.layer).toBe("solana-base");
    expect(prepared.transactionPlan.connection).toBe(connection);
    expect(prepared.transactionPlan.label).toContain("spend 1 Kredit");
    const enterAccounts =
      prepared.transactionPlan.transaction.instructions[0].keys;
    const ownerAccount = enterAccounts.find(({ pubkey }) =>
      pubkey.equals(owner.publicKey),
    );
    const actor = enterAccounts.find(({ pubkey }) =>
      pubkey.equals(device.publicKey),
    );
    expect(ownerAccount).toMatchObject({ isWritable: true, isSigner: false });
    expect(actor).toMatchObject({ isSigner: true, isWritable: true });
    expect(enterAccounts.find(({ pubkey }) => pubkey.equals(claimDaily)))
      .toMatchObject({ isWritable: true, isSigner: false });
    expect(enterAccounts.find(({ pubkey }) =>
      pubkey.equals(deriveArenaBoardPda(claimDaily, "score"))))
      .toMatchObject({ isWritable: true, isSigner: false });
    expect(prepared.transactionPlan.feePayer.equals(device.publicKey)).toBe(true);

    const finalized = await buildFinalizeDailyChallengePlan({
      connection,
      wallet,
      daily,
      scorePayoutCount: 0,
      themePayoutCount: 0,
    });
    expect(finalized.layer).toBe("solana-base");
    expect(finalized.connection).toBe(connection);
  });

  it("requires the owner signature only when buying Kredits", async () => {
    const owner = Keypair.generate();
    const plan = await buildPurchaseKreditsPlan({
      connection: {} as Connection,
      ownerWallet: new SessionWallet(owner),
      kreditCount: 3,
    });
    const accounts = plan.transaction.instructions[0]!.keys;

    expect(plan.label).toContain("Buy 3 Kredits");
    expect(plan.feePayer.equals(owner.publicKey)).toBe(true);
    expect(accounts.find(({ pubkey }) => pubkey.equals(owner.publicKey)))
      .toMatchObject({ isSigner: true, isWritable: true });
    expect(accounts.some(({ pubkey }) => pubkey.equals(deriveCreditVaultPda())))
      .toBe(true);
    expect(accounts.some(({ pubkey }) =>
      pubkey.equals(deriveOperatorRevenueVaultPda())))
      .toBe(true);
  });

  it("refuses entry when no following paid Daily is scheduled", async () => {
    const owner = Keypair.generate();
    const connection = {
      getMultipleAccountsInfo: vi.fn(),
    } as unknown as Connection;
    await expect(buildPrepareDailyRunPlan({
      connection,
      wallet: new SessionWallet(Keypair.generate()),
      ownerAuthority: owner.publicKey,
      sessionToken: Keypair.generate().publicKey,
      daily: {
        address: deriveArenaDailyPda(88),
        dayId: 88,
        followingDayId: null,
        kreditBalance: 1n,
      } as DailyView,
      sessionValidUntil: 1_800_000_000,
    })).rejects.toThrow("DailyNotScheduled");
    expect(connection.getMultipleAccountsInfo).not.toHaveBeenCalled();
  });

  it("rejects a missing following Daily before constructing a ranked entry", async () => {
    const owner = Keypair.generate();
    const daily = {
      address: deriveArenaDailyPda(20),
      dayId: 20,
      followingDayId: 21,
      entryLamports: 10_000_000n,
    } as DailyView;
    const infos = await rankedDependencyInfos(daily);
    infos[3] = null;
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
        deriveArenaDailyPda(21),
        deriveCreditVaultPda(),
      ],
      "confirmed",
    );
  });
});
