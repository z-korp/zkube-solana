import { getGuardianPortrait, getZoneGuardian } from "@/config/bossCharacters";
import type { ZoneProgressData } from "@/config/profileData";

/**
 * Cosmetic emblem model. This mirrors the on-chain `featuredEmblem` u8 space
 * one-for-one:
 *   0        auto — render the strongest currently unlocked emblem.
 *   1..10    zone guardians (one per Campaign zone).
 *   11       Realm Conqueror — every zone guardian defeated.
 *   12       World Perfect — all 300 Campaign stars.
 * Emblem unlock/gold state is derived purely from Campaign progress; emblems
 * never grant SOL, entries, prize eligibility, or gameplay progression.
 */
export const AUTO_EMBLEM_ID = 0;
export const GUARDIAN_EMBLEM_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const REALM_CONQUEROR_EMBLEM_ID = 11;
export const WORLD_PERFECT_EMBLEM_ID = 12;
export const MAX_EMBLEM_ID = 12;

/** Total stars when every one of the ten zones is perfected (10 × 30). */
export const WORLD_PERFECT_STARS = 300;
/** Stars per zone that mark a guardian as fully mastered (gold). */
export const ZONE_PERFECT_STARS = 30;

export type EmblemKind = "auto" | "guardian" | "realm" | "world";

export interface EmblemDescriptor {
  id: number;
  kind: EmblemKind;
  /** Present only for guardian emblems (1..10). */
  zoneId?: number;
  name: string;
  /** Guardian portrait asset path, or null for non-guardian emblems. */
  portrait: string | null;
}

export interface EmblemState {
  descriptor: EmblemDescriptor;
  unlocked: boolean;
  /** Gold variant: a fully mastered emblem (30/30 zone, all-gold realm, etc.). */
  gold: boolean;
}

/** Minimal Campaign shape the emblem model needs (a subset of ZoneProgressData). */
export type EmblemZoneInput = Pick<
  ZoneProgressData,
  "zoneId" | "stars" | "maxStars" | "cleared"
>;

function guardianDescriptor(zoneId: number): EmblemDescriptor {
  const guardian = getZoneGuardian(zoneId);
  return {
    id: zoneId,
    kind: "guardian",
    zoneId,
    name: guardian.name,
    portrait: getGuardianPortrait(zoneId),
  };
}

/** Canonical descriptor for every emblem id, indexed by id. */
export const EMBLEM_DESCRIPTORS: readonly EmblemDescriptor[] = [
  {
    id: AUTO_EMBLEM_ID,
    kind: "auto",
    name: "Automatic",
    portrait: null,
  },
  ...GUARDIAN_EMBLEM_IDS.map(guardianDescriptor),
  {
    id: REALM_CONQUEROR_EMBLEM_ID,
    kind: "realm",
    name: "Realm Conqueror",
    portrait: null,
  },
  {
    id: WORLD_PERFECT_EMBLEM_ID,
    kind: "world",
    name: "World Perfect",
    portrait: null,
  },
];

export function emblemDescriptor(id: number): EmblemDescriptor {
  return EMBLEM_DESCRIPTORS[id] ?? EMBLEM_DESCRIPTORS[AUTO_EMBLEM_ID]!;
}

function zoneById(
  zones: readonly EmblemZoneInput[],
  zoneId: number,
): EmblemZoneInput | undefined {
  return zones.find((zone) => zone.zoneId === zoneId);
}

function guardianUnlocked(zone: EmblemZoneInput | undefined): boolean {
  return Boolean(zone?.cleared);
}

function guardianGold(zone: EmblemZoneInput | undefined): boolean {
  return Boolean(zone && zone.stars >= (zone.maxStars || ZONE_PERFECT_STARS));
}

function totalStars(zones: readonly EmblemZoneInput[]): number {
  return zones.reduce((sum, zone) => sum + zone.stars, 0);
}

/**
 * Derive the unlocked/gold state of every emblem from Campaign progress. The
 * `auto` emblem is reported unlocked whenever any concrete emblem is unlocked,
 * and gold whenever its resolved target is gold.
 */
export function resolveEmblemStates(
  zones: readonly EmblemZoneInput[],
): EmblemState[] {
  const guardianStates = GUARDIAN_EMBLEM_IDS.map((zoneId) => {
    const zone = zoneById(zones, zoneId);
    return {
      descriptor: emblemDescriptor(zoneId),
      unlocked: guardianUnlocked(zone),
      gold: guardianUnlocked(zone) && guardianGold(zone),
    } satisfies EmblemState;
  });

  const allGuardiansUnlocked = guardianStates.every((state) => state.unlocked);
  const allGuardiansGold = guardianStates.every((state) => state.gold);
  const stars = totalStars(zones);

  const realmState: EmblemState = {
    descriptor: emblemDescriptor(REALM_CONQUEROR_EMBLEM_ID),
    unlocked: allGuardiansUnlocked,
    gold: allGuardiansUnlocked && allGuardiansGold,
  };
  const worldState: EmblemState = {
    descriptor: emblemDescriptor(WORLD_PERFECT_EMBLEM_ID),
    unlocked: stars >= WORLD_PERFECT_STARS,
    gold: stars >= WORLD_PERFECT_STARS,
  };

  const concrete = [...guardianStates, realmState, worldState];
  const strongest = strongestUnlocked(concrete);
  const autoState: EmblemState = {
    descriptor: emblemDescriptor(AUTO_EMBLEM_ID),
    unlocked: strongest !== null,
    gold: strongest?.gold ?? false,
  };

  return [autoState, ...guardianStates, realmState, worldState];
}

/**
 * Strength ordering for the auto emblem: World Perfect, then Realm Conqueror,
 * then the highest-numbered unlocked guardian (gold breaks ties). Returns the
 * chosen state, or null when nothing is unlocked yet.
 */
function strongestUnlocked(
  concrete: readonly EmblemState[],
): EmblemState | null {
  const unlocked = concrete.filter((state) => state.unlocked);
  if (unlocked.length === 0) return null;
  return unlocked.reduce((best, state) =>
    emblemStrength(state) > emblemStrength(best) ? state : best,
  );
}

function emblemStrength(state: EmblemState): number {
  // World (12) and Realm (11) already sort above guardians by id; gold adds a
  // small tiebreak so a mastered guardian outranks an equal-id plain one.
  return state.descriptor.id * 2 + (state.gold ? 1 : 0);
}

/** Resolve the auto emblem to a concrete id (0 when nothing is unlocked). */
export function resolveAutoEmblemId(zones: readonly EmblemZoneInput[]): number {
  const states = resolveEmblemStates(zones).filter(
    (state) => state.descriptor.kind !== "auto",
  );
  const strongest = strongestUnlocked(states);
  return strongest?.descriptor.id ?? AUTO_EMBLEM_ID;
}

/**
 * Resolve a stored `featuredEmblem` id to the concrete descriptor to render
 * (following the auto choice) together with its gold flag, given full
 * per-zone Campaign progress.
 */
export function resolveFeaturedEmblem(
  featuredEmblemId: number,
  zones: readonly EmblemZoneInput[],
): EmblemState {
  const states = resolveEmblemStates(zones);
  if (featuredEmblemId === AUTO_EMBLEM_ID) {
    const resolvedId = resolveAutoEmblemId(zones);
    return (
      states.find((state) => state.descriptor.id === resolvedId) ??
      states[AUTO_EMBLEM_ID]!
    );
  }
  return (
    states.find((state) => state.descriptor.id === featuredEmblemId) ?? {
      descriptor: emblemDescriptor(featuredEmblemId),
      unlocked: false,
      gold: false,
    }
  );
}

/**
 * Lightweight resolver for leaderboard rows, where only the stored emblem id
 * and a player's total star count are known (never per-zone detail). Explicit
 * emblem ids resolve to their descriptor directly. Gold can only be proven at
 * 300/300 (every zone perfected); below that a specific guardian's gold state
 * is unknowable from the total alone, so it is reported false rather than
 * guessed. The auto id cannot be resolved from a total, so it falls back to
 * World Perfect at 300/300 and to the neutral auto descriptor otherwise.
 */
export function resolveLeaderboardEmblem(
  featuredEmblemId: number,
  totalStarCount: number,
): EmblemState {
  const perfectedWorld = totalStarCount >= WORLD_PERFECT_STARS;
  if (featuredEmblemId === AUTO_EMBLEM_ID) {
    return perfectedWorld
      ? {
          descriptor: emblemDescriptor(WORLD_PERFECT_EMBLEM_ID),
          unlocked: true,
          gold: true,
        }
      : { descriptor: emblemDescriptor(AUTO_EMBLEM_ID), unlocked: false, gold: false };
  }
  // A specific guardian, realm, or world emblem is only provably gold once
  // every zone is perfected (300/300); otherwise the total alone cannot tell
  // us which zones reached 30/30, so gold stays false rather than guessed.
  return {
    descriptor: emblemDescriptor(featuredEmblemId),
    unlocked: true,
    gold: perfectedWorld,
  };
}
