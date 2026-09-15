/** Export live theme functions; Unity never reimplements lighten/darken or map colors. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CAMPAIGN_CATALOG } from "../../src/core/campaignCatalog.generated";
import { CAMPAIGN_PATHS } from "../../src/hooks/useMapLayout";
import { ZONE_NAMES } from "../../src/config/profileData";
import { DAILY_THEMES } from "../../src/core/dailyRules.generated";
import { dailyThemeName } from "../../src/core/dailyRules";
import { dailyThemeDescription } from "../../src/game/constraint";
import { canonicalCampaignMap } from "../../src/core/campaignCatalog";
import { getZoneGuardian, getGuardianPortrait } from "../../src/config/bossCharacters";
import { guardianSentence } from "../../src/config/guardianSentence";
import { buildTriggerDescription } from "../../src/ui/components/actionbar/bonusDescription";
import {
  getMapPathTheme,
  getThemeId,
  getThemeColors,
  getThemeImages,
  SFX_PATHS,
  THEME_IDS,
  THEME_MUSIC,
} from "../../src/config/themes";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sha256 = (relative: string) => createHash("sha256")
  .update(readFileSync(path.join(root, relative))).digest("hex");

// This parses the already computed CSS value, not the authored color transforms.
function rgba(css: string): number[] {
  if (/^#[\da-f]{6}$/i.test(css)) {
    return [1, 3, 5].map((offset) => Number.parseInt(css.slice(offset, offset + 2), 16) / 255).concat(1);
  }
  const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(css);
  if (!match) throw new Error(`Unsupported generated theme color: ${css}`);
  return [Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255, Number(match[4])];
}

export function themeFixtures() {
  return {
    schema: 1,
    sources: ["client/src/config/themes.ts", "client/src/utils/colour.ts", "client/src/core/campaignCatalog.generated.ts", "client/src/core/campaignCatalog.ts", "client/src/config/bossCharacters.ts",
      "client/src/hooks/useMapLayout.ts", "client/src/config/profileData.ts",
      "client/src/core/dailyRules.generated.ts", "client/src/core/dailyRules.ts", "client/src/game/constraint.ts",
      "client/src/config/guardianSentence.ts", "client/src/ui/components/actionbar/bonusDescription.ts"].map((file) => ({ file, sha256: sha256(file) })),
    guardianRules: CAMPAIGN_CATALOG.maps.map(({ rules }) => {
      const rule = { bonus: rules[0], trigger: rules[1], threshold: rules[2] };
      return { ...rule, description: buildTriggerDescription(rule.trigger, rule.threshold), sentence: guardianSentence(rule) };
    }),
    dailyThemes: DAILY_THEMES.map(theme => ({ ...theme, name: dailyThemeName(theme), description: dailyThemeDescription(theme) })),
    themes: THEME_IDS.map((id) => {
      const realm = CAMPAIGN_CATALOG.maps.map(({ mapId }) => canonicalCampaignMap(CAMPAIGN_CATALOG.contentVersion, mapId))
        .find(({ themeId }) => getThemeId(themeId) === id);
      if (!realm) throw new Error(`Theme ${id} has no canonical realm`);
      const colors = getThemeColors(id);
      const map = getMapPathTheme(id);
      return {
        id,
        realmId: realm.mapId,
        guardianName: getZoneGuardian(realm.mapId).name,
        guardianGreeting: getZoneGuardian(realm.mapId).dailyGreeting,
        guardianPortrait: getGuardianPortrait(realm.mapId),
        realmName: ZONE_NAMES[realm.mapId],
        campaignPath: CAMPAIGN_PATHS[realm.mapId - 1],
        colors,
        // Arrays are also consumable through JsonUtility without dictionary support.
        rgba: Object.entries(colors)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^(#|rgba\()/.test(entry[1]))
          .map(([name, value]) => ({ name, value: rgba(value) })),
        blocks: Object.entries(colors.blocks).map(([width, block]) => ({
          width: Number(width), fill: rgba(block.fill), glow: rgba(block.glow), highlight: rgba(block.highlight),
        })),
        particles: { primary: colors.particles.primary.map(rgba), explosion: colors.particles.explosion.map(rgba) },
        map: { ...map, clearedRgba: rgba(map.clearedColor), activeRgba: rgba(map.activeColor), lockedRgba: rgba(map.lockedColor) },
        images: getThemeImages(id),
        music: THEME_MUSIC[id],
      };
    }),
    effects: SFX_PATHS,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(themeFixtures(), null, 2)}\n`);
}
