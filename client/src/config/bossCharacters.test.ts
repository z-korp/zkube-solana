// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ZONE_GUARDIANS } from "./bossCharacters";

describe("guardian character copy", () => {
  it("authored_guardian_copy_carries_no_mechanics", () => {
    const violations = Object.values(ZONE_GUARDIANS).flatMap((guardian) =>
      Object.entries(guardian)
        .filter(([, value]) => typeof value === "string")
        .filter(([, value]) => /[0-9×]|\b(?:Hammer|Totem|Wave)\b/.test(value))
        .map(([field]) => `${guardian.zoneId}.${field}`),
    );
    expect(violations).toEqual([]);
  });

  it("keeps the owner-authored greeting rewrites verbatim", () => {
    expect(ZONE_GUARDIANS[4].greeting).toBe(
      "The temple is quiet. Marble is carved one steady strike at a time.",
    );
    expect(ZONE_GUARDIANS[7].greeting).toBe(
      "Catch me if you can. Foxfire burns the careless.",
    );
    expect(ZONE_GUARDIANS[8].greeting).toBe(
      "Three heads, one hunt. Feed us whole rows, not scraps.",
    );
  });
});
