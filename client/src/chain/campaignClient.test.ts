// @vitest-environment node

import { Keypair, type AccountInfo, type Connection } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCampaignView } from "./campaignClient";
import { ZKUBE_PROGRAM_ID } from "./constants";

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
}));

vi.mock("./runPlan", async () => ({
  mapLevelRuleSnapshot: (value: unknown) => value,
  zkubeProgram: () => ({
    programId: ZKUBE_PROGRAM_ID,
    account: {
      protocolConfig: { size: 10 },
      playerState: { size: 11 },
      mapCatalog: { size: 13 },
    },
    coder: { accounts: { decode: mocks.decode } },
  }),
}));

function account(size: number, marker: number): AccountInfo<Buffer> {
  const data = Buffer.alloc(size);
  data[0] = marker;
  return {
    data,
    executable: false,
    lamports: 1,
    owner: ZKUBE_PROGRAM_ID,
    rentEpoch: 0,
  };
}

describe("fetchCampaignView", () => {
  beforeEach(() => {
    mocks.decode.mockReset();
  });

  it("builds fresh-player progress from the verified live catalog", async () => {
    const owner = Keypair.generate().publicKey;
    mocks.decode.mockImplementation((name: string, data: Buffer) => {
      if (name === "protocolConfig") {
        return { version: 3, contentVersion: 2, campaignMapCount: 10 };
      }
      const mapId = data[0] - 20;
      return {
        version: 3,
        contentVersion: 2,
        mapId,
        themeId: mapId,
        enabled: true,
        mapRules: {
          activeMutatorId: 20 + mapId * 2 - 1,
          passiveMutatorId: 20 + mapId * 2,
          bossId: mapId,
        },
        levels: Array.from({ length: 10 }, (_, index) => ({
          level: index + 1,
        })),
      };
    });
    const getMultipleAccountsInfo = vi
      .fn()
      .mockResolvedValueOnce([account(10, 1), null])
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, index) => account(13, 21 + index)),
      );

    const campaign = await fetchCampaignView({
      connection: { getMultipleAccountsInfo } as unknown as Connection,
      wallet: { publicKey: owner },
    });

    expect(campaign).not.toBeNull();
    expect(campaign?.contentVersion).toBe(2);
    expect(campaign?.maps).toHaveLength(10);
    expect(campaign?.maps[0]).toMatchObject({
      mapId: 1,
      unlocked: true,
      cleared: false,
      perfected: false,
      levelStars: Array.from({ length: 10 }, () => 0),
    });
    expect(campaign?.maps.slice(1).every((map) => !map.unlocked)).toBe(true);
  });
});
