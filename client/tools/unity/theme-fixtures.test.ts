import { describe, expect, it } from "vitest";
import { themeFixtures } from "./theme-fixtures";
import { CAMPAIGN_CATALOG } from "../../src/core/campaignCatalog.generated";
import { canonicalCampaignMap } from "../../src/core/campaignCatalog";
import { getZoneGuardian } from "../../src/config/bossCharacters";
import { getThemeId, THEME_IDS, THEME_MUSIC, getThemeColors } from "../../src/config/themes";

describe("Unity realm presentation publication", () => {
  it("binds every authored realm to the actual theme and guardian sources", () => {
    const themes = themeFixtures().themes;
    expect(themes.map(theme => theme.id)).toEqual(THEME_IDS);
    expect(new Set(themes.map(theme => theme.realmId)).size).toBe(CAMPAIGN_CATALOG.maps.length);
    for (const { mapId } of CAMPAIGN_CATALOG.maps) {
      const map = canonicalCampaignMap(CAMPAIGN_CATALOG.contentVersion, mapId);
      const theme = themes.find(value => value.realmId === mapId)!;
      expect(theme.id).toBe(getThemeId(map.themeId));
      expect(theme.guardianName).toBe(getZoneGuardian(mapId).name);
      expect(theme.colors).toEqual(getThemeColors(getThemeId(map.themeId)));
      expect(theme.music.level).toBe(THEME_MUSIC[getThemeId(map.themeId)].level);
    }
  });
  it("keeps Balam's existing assets and palette while exposing his explicit identity", () => {
    const balam = themeFixtures().themes.find(theme => theme.realmId === 8)!;
    expect(balam.id).toBe("theme-8"); expect(balam.guardianName).toBe("Balam");
    expect(balam.colors).toEqual(getThemeColors("theme-8"));
    expect(balam.music).toEqual(THEME_MUSIC["theme-8"]);
  });
});
