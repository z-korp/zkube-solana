// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  AUTO_EMBLEM_ID,
  REALM_CONQUEROR_EMBLEM_ID,
  WORLD_PERFECT_EMBLEM_ID,
  type EmblemZoneInput,
  resolveAutoEmblemId,
  resolveEmblemStates,
  resolveFeaturedEmblem,
  resolveLeaderboardEmblem,
} from "./emblems";

function zone(zoneId: number, stars: number, cleared: boolean): EmblemZoneInput {
  return { zoneId, stars, maxStars: 30, cleared };
}

function zones(
  overrides: Partial<Record<number, EmblemZoneInput>> = {},
): EmblemZoneInput[] {
  return Array.from({ length: 10 }, (_, index) => {
    const zoneId = index + 1;
    return overrides[zoneId] ?? zone(zoneId, 0, false);
  });
}

function stateById(id: number, input: readonly EmblemZoneInput[]) {
  return resolveEmblemStates(input).find(
    (state) => state.descriptor.id === id,
  )!;
}

describe("emblem unlock and gold derivation", () => {
  it("unlocks a guardian on clear and turns it gold at 30/30", () => {
    const input = zones({
      1: zone(1, 15, true),
      2: zone(2, 30, true),
    });
    expect(stateById(1, input)).toMatchObject({ unlocked: true, gold: false });
    expect(stateById(2, input)).toMatchObject({ unlocked: true, gold: true });
    expect(stateById(3, input)).toMatchObject({ unlocked: false, gold: false });
  });

  it("keeps Realm Conqueror and World Perfect locked until earned", () => {
    const input = zones({ 1: zone(1, 30, true) });
    expect(stateById(REALM_CONQUEROR_EMBLEM_ID, input).unlocked).toBe(false);
    expect(stateById(WORLD_PERFECT_EMBLEM_ID, input).unlocked).toBe(false);
  });

  it("unlocks Realm Conqueror once every guardian is defeated", () => {
    const cleared = zones(
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index + 1,
          zone(index + 1, 15, true),
        ]),
      ),
    );
    const realm = stateById(REALM_CONQUEROR_EMBLEM_ID, cleared);
    expect(realm.unlocked).toBe(true);
    expect(realm.gold).toBe(false); // not every zone perfected yet
    expect(stateById(WORLD_PERFECT_EMBLEM_ID, cleared).unlocked).toBe(false);
  });

  it("unlocks and golds World Perfect at 300/300", () => {
    const perfect = zones(
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index + 1,
          zone(index + 1, 30, true),
        ]),
      ),
    );
    expect(stateById(WORLD_PERFECT_EMBLEM_ID, perfect)).toMatchObject({
      unlocked: true,
      gold: true,
    });
    expect(stateById(REALM_CONQUEROR_EMBLEM_ID, perfect).gold).toBe(true);
  });
});

describe("auto emblem resolution", () => {
  it("returns nothing unlocked for a fresh player", () => {
    const input = zones();
    expect(resolveAutoEmblemId(input)).toBe(AUTO_EMBLEM_ID);
    expect(stateById(AUTO_EMBLEM_ID, input).unlocked).toBe(false);
  });

  it("picks the highest-numbered unlocked guardian", () => {
    const input = zones({
      1: zone(1, 15, true),
      2: zone(2, 30, true),
    });
    expect(resolveAutoEmblemId(input)).toBe(2);
  });

  it("prefers Realm Conqueror over any guardian", () => {
    const cleared = zones(
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index + 1,
          zone(index + 1, 15, true),
        ]),
      ),
    );
    expect(resolveAutoEmblemId(cleared)).toBe(REALM_CONQUEROR_EMBLEM_ID);
  });

  it("prefers World Perfect once fully mastered", () => {
    const perfect = zones(
      Object.fromEntries(
        Array.from({ length: 10 }, (_, index) => [
          index + 1,
          zone(index + 1, 30, true),
        ]),
      ),
    );
    expect(resolveAutoEmblemId(perfect)).toBe(WORLD_PERFECT_EMBLEM_ID);
  });

  it("resolveFeaturedEmblem follows auto and reports explicit lock state", () => {
    const input = zones({ 1: zone(1, 15, true), 2: zone(2, 30, true) });
    const auto = resolveFeaturedEmblem(AUTO_EMBLEM_ID, input);
    expect(auto.descriptor.id).toBe(2);
    expect(auto.unlocked).toBe(true);

    const lockedGuardian = resolveFeaturedEmblem(9, input);
    expect(lockedGuardian.descriptor.id).toBe(9);
    expect(lockedGuardian.unlocked).toBe(false);
  });
});

describe("leaderboard emblem resolution", () => {
  it("renders an explicit emblem, gold only when a player is 300/300", () => {
    expect(resolveLeaderboardEmblem(3, 120)).toMatchObject({
      unlocked: true,
      gold: false,
    });
    expect(resolveLeaderboardEmblem(3, 300)).toMatchObject({
      unlocked: true,
      gold: true,
    });
  });

  it("cannot resolve auto below 300, but promotes to World Perfect at 300", () => {
    expect(resolveLeaderboardEmblem(AUTO_EMBLEM_ID, 150)).toMatchObject({
      descriptor: { id: AUTO_EMBLEM_ID },
      unlocked: false,
    });
    expect(resolveLeaderboardEmblem(AUTO_EMBLEM_ID, 300)).toMatchObject({
      descriptor: { id: WORLD_PERFECT_EMBLEM_ID },
      unlocked: true,
      gold: true,
    });
  });
});
