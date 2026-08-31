// @vitest-environment node
import { describe, expect, it } from "vitest";

import { CAMPAIGN_CATALOG } from "@/core/campaignCatalog.generated";
import { getGuardianDef } from "./mutatorConfig";
import { guardianBonusName, guardianSentence } from "./guardianSentence";

describe("guardianSentence", () => {
  it("binds every guardian sentence to its published threshold and bonus", () => {
    for (const realm of CAMPAIGN_CATALOG.maps) {
      const [bonus, trigger, threshold] = realm.rules;
      const sentence = guardianSentence({ bonus, trigger, threshold });
      expect(sentence).toContain(guardianBonusName(bonus));
      if (trigger === 6) {
        expect(threshold).toBe(0);
        expect(sentence).not.toMatch(/[0-9]/);
      } else {
        expect(sentence).toContain(String(threshold));
      }
      expect(getGuardianDef(realm.mapId).description).toBe(sentence);
    }
  });

  it("rejects unknown trigger and bonus tags", () => {
    expect(() =>
      guardianSentence({ bonus: 1, trigger: 255, threshold: 1 }),
    ).toThrow("Unknown guardian trigger 255");
    expect(() =>
      guardianSentence({ bonus: 255, trigger: 1, threshold: 1 }),
    ).toThrow("Unknown guardian bonus 255");
  });
});
