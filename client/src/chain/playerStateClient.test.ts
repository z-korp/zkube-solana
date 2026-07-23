// @vitest-environment node
import {
  Keypair,
  type AccountInfo,
  type Connection,
} from "@solana/web3.js";
import { describe, expect, it } from "vitest";

import { decodePlayerStateAccount } from "./campaignClient";
import { ZKUBE_PROGRAM_ID } from "./constants";
import { derivePlayerStatePda } from "./pdas";
import {
  fetchPlayerEmblems,
  fetchPlayerStateView,
} from "./playerStateClient";
import {
  PLAYER_STATE_ACCOUNT_VERSION,
  PROTOCOL_ACCOUNT_VERSION,
} from "./protocolVersions.generated";
import { zkubeProgram } from "./runPlan";
import { SessionWallet } from "./sessionWallet";

// The IDL playerState account discriminator (BorshAccountsCoder rejects any
// buffer whose first eight bytes do not match, so the fixture must carry it).
const PLAYER_STATE_DISCRIMINATOR = [56, 3, 60, 86, 174, 16, 244, 195];

// Exact byte offsets of the IDL PlayerState struct after the 8-byte
// discriminator. Kept explicit so a layout change breaks this test loudly.
const OFFSET = {
  version: 8,
  owner: 9,
  nextRunId: 41,
  activeRunId: 49,
  activeRunDaily: 57,
  activeRunMode: 89,
  activeRunDeadlineAt: 90,
  orphanRunId: 98,
  campaignStars: 106,
  featuredEmblem: 131,
  lifetimePaidEntries: 132,
  dailyRecord: 140,
  weeklyRecord: 158,
  seasonRecord: 176,
  campaignActiveRunId: 194,
  reserved: 202,
  bump: 226,
} as const;

const PLAYER_STATE_SIZE = 227;

function program() {
  return zkubeProgram(
    {} as Connection,
    new SessionWallet(Keypair.generate()),
  );
}

function writeRecord(
  data: Buffer,
  offset: number,
  bestPrizeRank: number,
  podiums: number,
  wins: number,
  rewardsLamports: bigint,
): void {
  data.writeUInt16LE(bestPrizeRank, offset);
  data.writeUInt32LE(podiums, offset + 2);
  data.writeUInt32LE(wins, offset + 6);
  data.writeBigUInt64LE(rewardsLamports, offset + 10);
}

/**
 * Build a canonical PlayerState account buffer for `owner`. `campaignStars`
 * seeds the first bytes of the compact star bitmap (rest zeroed).
 */
function playerStateBuffer(
  owner: Keypair,
  campaignStars: readonly number[] = [],
  version = PROTOCOL_ACCOUNT_VERSION,
): Buffer {
  const data = Buffer.alloc(PLAYER_STATE_SIZE);
  for (let i = 0; i < PLAYER_STATE_DISCRIMINATOR.length; i += 1) {
    data[i] = PLAYER_STATE_DISCRIMINATOR[i]!;
  }
  data.writeUInt8(version, OFFSET.version);
  owner.publicKey.toBuffer().copy(data, OFFSET.owner);
  data.writeBigUInt64LE(7n, OFFSET.nextRunId);
  data.writeBigUInt64LE(0n, OFFSET.activeRunId);
  data.writeUInt8(0, OFFSET.activeRunMode);
  data.writeBigInt64LE(0n, OFFSET.activeRunDeadlineAt);
  data.writeBigUInt64LE(0n, OFFSET.orphanRunId);
  data.writeBigUInt64LE(0n, OFFSET.campaignActiveRunId);
  campaignStars.forEach((byte, index) => {
    data[OFFSET.campaignStars + index] = byte;
  });
  data.writeUInt8(5, OFFSET.featuredEmblem);
  data.writeBigUInt64LE(42n, OFFSET.lifetimePaidEntries);
  writeRecord(data, OFFSET.dailyRecord, 1, 2, 3, 1_000n);
  writeRecord(data, OFFSET.weeklyRecord, 2, 5, 7, 2_000n);
  writeRecord(data, OFFSET.seasonRecord, 3, 11, 13, 3_000n);
  data.writeUInt8(254, OFFSET.bump);
  return data;
}

function accountInfo(data: Buffer): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports: 1,
    owner: ZKUBE_PROGRAM_ID,
    rentEpoch: 0,
  };
}

describe("decodePlayerStateAccount", () => {
  it("agrees with the IDL on the account size", () => {
    expect(program().account.playerState.size).toBe(PLAYER_STATE_SIZE);
  });

  it("reads every competitive field at its IDL byte offset", () => {
    const owner = Keypair.generate();
    // Zone 1 fully three-starred (10 levels × 3 = 30 total stars).
    const stars = [0xff, 0xff, 0x0f];
    const address = derivePlayerStatePda(owner.publicKey);
    const view = decodePlayerStateAccount(
      program(),
      address,
      owner.publicKey,
      accountInfo(playerStateBuffer(owner, stars)),
    );

    expect(view.owner.equals(owner.publicKey)).toBe(true);
    expect(view.version).toBe(PROTOCOL_ACCOUNT_VERSION);
    expect(view.campaignStars).toHaveLength(25);
    expect(view.campaignStars.slice(0, 3)).toEqual([255, 255, 15]);
    expect(view.featuredEmblem).toBe(5);
    expect(view.lifetimePaidEntries).toBe(42n);
    expect(view.dailyRecord).toEqual({
      bestPrizeRank: 1,
      podiums: 2,
      wins: 3,
      rewardsLamports: 1_000n,
    });
    expect(view.weeklyRecord).toEqual({
      bestPrizeRank: 2,
      podiums: 5,
      wins: 7,
      rewardsLamports: 2_000n,
    });
    expect(view.seasonRecord).toEqual({
      bestPrizeRank: 3,
      podiums: 11,
      wins: 13,
      rewardsLamports: 3_000n,
    });
  });

  it("accepts the byte-compatible v3 dual-slot PlayerState", () => {
    const owner = Keypair.generate();
    const view = decodePlayerStateAccount(
      program(),
      derivePlayerStatePda(owner.publicKey),
      owner.publicKey,
      accountInfo(
        playerStateBuffer(owner, [0x03], PLAYER_STATE_ACCOUNT_VERSION),
      ),
    );

    expect(view.version).toBe(PLAYER_STATE_ACCOUNT_VERSION);
    expect(view.campaignStars[0]).toBe(0x03);
  });

  it("rejects an account whose embedded owner is not the expected wallet", () => {
    const owner = Keypair.generate();
    const other = Keypair.generate();
    expect(() =>
      decodePlayerStateAccount(
        program(),
        derivePlayerStatePda(other.publicKey),
        other.publicKey,
        accountInfo(playerStateBuffer(owner)),
      ),
    ).toThrow(/relationship is invalid/);
  });

  it("rejects an account of the wrong size", () => {
    const owner = Keypair.generate();
    const truncated = playerStateBuffer(owner).subarray(0, PLAYER_STATE_SIZE - 1);
    expect(() =>
      decodePlayerStateAccount(
        program(),
        derivePlayerStatePda(owner.publicKey),
        owner.publicKey,
        accountInfo(Buffer.from(truncated)),
      ),
    ).toThrow(/invalid data length/);
  });

  it("rejects an account owned by another program", () => {
    const owner = Keypair.generate();
    const info = accountInfo(playerStateBuffer(owner));
    expect(() =>
      decodePlayerStateAccount(
        program(),
        derivePlayerStatePda(owner.publicKey),
        owner.publicKey,
        { ...info, owner: Keypair.generate().publicKey },
      ),
    ).toThrow(/wrong owner/);
  });
});

describe("fetchPlayerStateView", () => {
  it("decodes the connected player's account directly", async () => {
    const owner = Keypair.generate();
    const info = accountInfo(playerStateBuffer(owner));
    const getAccountInfo = () => Promise.resolve(info);
    const view = await fetchPlayerStateView({
      connection: {
        rpcEndpoint: "http://localhost",
        getAccountInfo,
      } as unknown as Connection,
      wallet: new SessionWallet(Keypair.generate()),
      owner: owner.publicKey,
    });
    expect(view?.featuredEmblem).toBe(5);
    expect(view?.lifetimePaidEntries).toBe(42n);
  });

  it("returns null when the account is missing", async () => {
    const view = await fetchPlayerStateView({
      connection: {
        rpcEndpoint: "http://localhost",
        getAccountInfo: () => Promise.resolve(null),
      } as unknown as Connection,
      wallet: new SessionWallet(Keypair.generate()),
      owner: Keypair.generate().publicKey,
    });
    expect(view).toBeNull();
  });
});

describe("fetchPlayerEmblems", () => {
  it("projects emblem id and total stars from a batched read", async () => {
    const owner = Keypair.generate();
    // Zone 1 fully three-starred → 30 total stars.
    const info = accountInfo(playerStateBuffer(owner, [0xff, 0xff, 0x0f]));
    const emblems = await fetchPlayerEmblems({
      connection: {
        // Unique endpoint keeps this test isolated from the module cache.
        rpcEndpoint: `http://emblems-${owner.publicKey.toBase58()}`,
        getMultipleAccountsInfo: () => Promise.resolve([info]),
      } as unknown as Connection,
      wallet: new SessionWallet(Keypair.generate()),
      owners: [owner.publicKey],
    });
    expect(emblems).toHaveLength(1);
    expect(emblems[0]!.address.equals(owner.publicKey)).toBe(true);
    expect(emblems[0]!.featuredEmblem).toBe(5);
    expect(emblems[0]!.totalStars).toBe(30);
  });

  it("omits wallets with no account rather than fabricating an emblem", async () => {
    const owner = Keypair.generate();
    const emblems = await fetchPlayerEmblems({
      connection: {
        rpcEndpoint: `http://emblems-missing-${owner.publicKey.toBase58()}`,
        getMultipleAccountsInfo: () => Promise.resolve([null]),
      } as unknown as Connection,
      wallet: new SessionWallet(Keypair.generate()),
      owners: [owner.publicKey],
    });
    expect(emblems).toHaveLength(0);
  });
});
