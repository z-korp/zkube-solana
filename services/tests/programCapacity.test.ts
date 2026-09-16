// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const program = fileURLToPath(new URL("../../programs/solana", import.meta.url));

function rustSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? rustSources(path) : entry.name.endsWith(".rs") ? [path] : [];
  });
}

it("every_program_capacity_has_an_sbf_test_at_its_maximum", () => {
  const capacities = rustSources(join(program, "src")).flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(/\bconst\s+([A-Z][A-Z_0-9]*)\s*:/g)]
      .map((match) => match[1]!)
      .filter((name) => name.endsWith("_CAPACITY") || name.startsWith("MAX_")),
  ).sort();
  const guards: Record<string, { allocation: string; compute: string }> = {
    ARENA_BOARD_CAPACITY: {
      allocation: "cadence_funding_creates_exact_boards_through_the_full_capacity",
      compute: "full_board_finalization_stays_below_one_million_compute_units",
    },
    ARENA_BOARD_CHUNK_CAPACITY: {
      allocation: "cadence_funding_creates_exact_boards_through_the_full_capacity",
      compute: "cadence_funding_creates_exact_boards_through_the_full_capacity",
    },
    MAX_AUTO_CLAIMS_PER_ENTRY: {
      allocation: "sbf_device_paid_entry_with_two_maximum_boards_stays_below_client_compute_pin",
      compute: "sbf_device_paid_entry_with_two_maximum_boards_stays_below_client_compute_pin",
    },
  };
  expect(capacities).toEqual(Object.keys(guards).sort());
  const contracts = readFileSync(join(program, "tests/sbf_contract.rs"), "utf8");
  for (const [capacity, boundary] of Object.entries(guards)) {
    for (const [kind, test] of Object.entries(boundary)) {
      const body = contracts.match(new RegExp(`#\\[test\\]\\nfn ${test}\\(\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
      expect(body, `${capacity} needs its maximum exercised in ${test}`).toBeDefined();
      expect(body).toContain(capacity);
      if (kind === "compute") expect(body).toContain("compute_units_consumed");
    }
  }
});
