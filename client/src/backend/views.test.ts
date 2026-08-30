// @vitest-environment node
import { describe, expect, it } from "vitest";

import { PUBLIC_VIEW_SCHEMAS } from "./views";

describe("backend views", () => {
  it("backend_views_are_chain_neutral", () => {
    const forbidden =
      /PublicKey|AccountInfo|Connection|Transaction|Pda|PDA|Ephemeral|MagicBlock|ER placement/;
    for (const [name, schema] of Object.entries(PUBLIC_VIEW_SCHEMAS)) {
      expect(JSON.stringify(schema.ast), name).not.toMatch(forbidden);
    }
  });
});
