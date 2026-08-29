import { CAMPAIGN_CATALOG } from "./campaignCatalog.generated";

export const CANONICAL_CAMPAIGN_MAP_COUNT = CAMPAIGN_CATALOG.maps.length;
export const MAX_CAMPAIGN_MAPS = CANONICAL_CAMPAIGN_MAP_COUNT;
export const CAMPAIGN_CONTENT_VERSION = CAMPAIGN_CATALOG.contentVersion;

interface CampaignConstraintPublication {
  kind: number;
  value: number;
  requiredCount: number;
}

interface CampaignLevelPublication {
  level: number;
  pointsRequired: number;
  maxMoves: number;
  difficulty: number;
  primary: CampaignConstraintPublication;
  secondary: CampaignConstraintPublication;
}

export interface GuardianPublication {
  bonus: number;
  trigger: number;
  threshold: number;
}

interface CampaignMapRulesPublication {
  activeMutatorId: number;
  /**
   * Which boss archetype the guardian level fights, not which guardian. The
   * ids index the roster in `fixtures/game-parity.json`; realm identity comes
   * from the map id and its realm-named guardian instead.
  */
  bossId: number;
  guardian: GuardianPublication;
  startingRows: number;
}

export interface CampaignMapPublication {
  mapId: number;
  themeId: number;
  enabled: boolean;
  mapRules: CampaignMapRulesPublication;
  levels: CampaignLevelPublication[];
}

type EncodedMap = (typeof CAMPAIGN_CATALOG.maps)[number];
type EncodedLevel = EncodedMap["levels"][number];
type ConstraintTuple = EncodedLevel[3] | EncodedLevel[4];

const BOSS_ARCHETYPE_IDS = [1, 2, 3, 4, 6, 7, 5, 8, 9, 10] as const;

export function canonicalCampaignMap(
  contentVersion: number,
  mapId: number,
): CampaignMapPublication {
  assertU32(contentVersion, "contentVersion");
  if (contentVersion !== CAMPAIGN_CONTENT_VERSION) {
    throw new Error(
      `canonical Campaign release is bound to content version ${CAMPAIGN_CONTENT_VERSION}`,
    );
  }
  const authored = CAMPAIGN_CATALOG.maps[mapId - 1];
  if (!authored || authored.mapId !== mapId) {
    throw new Error(
      `mapId must be between 1 and ${CANONICAL_CAMPAIGN_MAP_COUNT}`,
    );
  }
  const bossId = BOSS_ARCHETYPE_IDS[mapId - 1];
  if (bossId === undefined) {
    throw new Error(`map ${mapId} has no boss archetype`);
  }
  return {
    mapId,
    themeId: mapId,
    enabled: true,
    mapRules: publicationRules(authored.rules, mapId, bossId),
    levels: authored.levels.map((tuple, index) => level(index + 1, tuple)),
  };
}

function publicationRules(
  rules: EncodedMap["rules"],
  mapId: number,
  bossId: number,
): CampaignMapRulesPublication {
  const [bonus, trigger, threshold, startingRows] = rules;
  const activeMutatorId = 19 + mapId * 2;
  return {
    activeMutatorId,
    bossId,
    guardian: { bonus, trigger, threshold },
    startingRows,
  };
}

function level(
  levelNumber: number,
  tuple: EncodedLevel,
): CampaignLevelPublication {
  const [pointsRequired, maxMoves, difficulty, primary, secondary] = tuple;
  return {
    level: levelNumber,
    pointsRequired,
    maxMoves,
    difficulty,
    primary: publicationConstraint(primary),
    secondary: publicationConstraint(secondary),
  };
}

function publicationConstraint(
  tuple: ConstraintTuple,
): CampaignConstraintPublication {
  return { kind: tuple[0], value: tuple[1], requiredCount: tuple[2] };
}

function assertU32(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) {
    throw new Error(`${label} must be a positive u32`);
  }
}
