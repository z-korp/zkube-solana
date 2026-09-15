// @vitest-environment node

import { Keypair, type Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  campaignMapCleared,
  campaignMapPerfected,
  campaignMapUnlocked,
  campaignTotalStars,
  fetchCampaignView,
  unpackCompactLevelStars,
} from "./campaignClient";
import { CAMPAIGN_CONTENT_VERSION } from "@/core/campaignCatalog";

describe("fetchCampaignView", () => {
  it("builds fresh-player progress from the compiled catalog without chain content", async () => {
    const owner = Keypair.generate().publicKey;
    const getAccountInfo = vi.fn().mockResolvedValue(null);
    const campaign = await fetchCampaignView({
      connection: { getAccountInfo } as unknown as Connection,
      wallet: { publicKey: owner },
    });

    expect(campaign).not.toBeNull();
    expect(campaign?.contentVersion).toBe(CAMPAIGN_CONTENT_VERSION);
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

  it("derives zone gates and completion from the compact 100-level star array", () => {
    const stars = Array.from({ length: 25 }, () => 0);
    for (let level = 0; level < 10; level += 1) {
      setPackedStars(stars, level, level === 9 ? 1 : 3);
    }

    expect(unpackCompactLevelStars(stars, 0)).toEqual([
      3, 3, 3, 3, 3, 3, 3, 3, 3, 1,
    ]);
    expect(campaignMapUnlocked(stars, 0)).toBe(true);
    expect(campaignMapUnlocked(stars, 1)).toBe(true);
    expect(campaignMapUnlocked(stars, 2)).toBe(false);
    expect(campaignMapCleared(stars, 0)).toBe(true);
    expect(campaignMapPerfected(stars, 0)).toBe(false);
    expect(campaignTotalStars(stars)).toBe(28);

    setPackedStars(stars, 9, 3);
    expect(campaignMapPerfected(stars, 0)).toBe(true);
    expect(campaignTotalStars(stars)).toBe(30);
  });
});

function setPackedStars(
  bytes: number[],
  levelIndex: number,
  stars: number,
): void {
  const bit = levelIndex * 2;
  const byteIndex = bit >> 3;
  const shift = bit & 7;
  bytes[byteIndex] =
    ((bytes[byteIndex] ?? 0) & ~(0x3 << shift)) | ((stars & 0x3) << shift);
}
