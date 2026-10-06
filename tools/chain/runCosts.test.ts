import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseOperatorArgs } from "./cli.js";
import { measureRun, requireRunCosts, type RecordedRun, type RecordedTransaction } from "./runCosts.js";

// One real run on Devnet after the delegation program's upgrade of 2026-10-06, and a first entry of a day,
// trimmed to what the check reads.
const recorded = JSON.parse(readFileSync(new URL("./runCosts.devnet.json", import.meta.url), "utf8")) as
  RecordedRun & { firstEntryOfADay: RecordedTransaction };
const copy = (): typeof recorded => structuredClone(recorded);

it("every_stated_run_cost_figure_is_what_devnet_charged_a_recorded_run", () => {
  const figures = requireRunCosts(recorded);
  expect(figures.map(({ figure, measured }) => [figure, measured])).toEqual([
    ["rent, lamports a byte", 5080], ["run rent", 2_357_120], ["delegation buffer lamports", 0],
    ["delegation accounts", 2], ["delegation funding", 3_271_200], ["delegation session fee", 3_000_000],
    ["run cost besides its transaction fees", 3_000_000]]);
  // A first entry of a day also creates the daily player, at the cluster's rent: the account that recorded
  // first entry created, added to this run's entry with the lamports it took from the device.
  const first = copy();
  const player = (recorded.firstEntryOfADay.meta!.innerInstructions!.flatMap(inner => inner.instructions) as
    { parsed: { info: { space: number; lamports: number } } }[]).find(instruction => instruction.parsed.info.space === 226)!;
  first.entry.meta!.innerInstructions![0]!.instructions.push(player);
  first.entry.meta!.preBalances[0]! += player.parsed.info.lamports;
  expect(requireRunCosts(first).find(({ figure }) => figure === "daily player rent")).toMatchObject({ measured: 1_798_320 });
  // That recording predates the upgrade, when the delegation accounts held the cluster's rent: its own entry
  // is not this run's, and the check refuses to read the two as one.
  expect(() => measureRun({ ...copy(), entry: { ...recorded.firstEntryOfADay, slot: recorded.entry.slot } })).toThrow("are not one run");
  expect(parseOperatorArgs(["check-run-costs"])).toEqual({ help: false, mode: "check-run-costs" });
});

it("a_run_cost_figure_the_cluster_no_longer_charges_fails_the_check_by_name", () => {
  // The cluster's rent moves.
  expect(() => requireRunCosts({ ...copy(), rentLamportsPerByte: 6960 }))
    .toThrow("rent, lamports a byte is stated 5080 and measured 6960");
  // The delegation program keeps more: the device gets less back at undelegation.
  const dearer = copy();
  const device = dearer.undelegation.transaction.message.accountKeys.findIndex(key =>
    key.pubkey === recorded.entry.transaction.message.accountKeys[0]!.pubkey);
  dearer.undelegation.meta!.postBalances[device]! -= 100_000;
  expect(() => requireRunCosts(dearer)).toThrow(/delegation session fee is stated 3000000 and measured 3100000; run cost besides its transaction fees is stated 3000000 and measured 3100000/);
  // It funds its accounts differently, or the buffer starts to hold rent.
  const funded = copy();
  for (const inner of funded.entry.meta!.innerInstructions!) {
    for (const instruction of inner.instructions as { parsed: { info: { lamports: number; space: number } } }[]) {
      if (instruction.parsed.info.space === 96) instruction.parsed.info.lamports = 1_137_920;
      if (instruction.parsed.info.lamports === 0) instruction.parsed.info.lamports = 2_357_120;
    }
  }
  expect(() => requireRunCosts(funded)).toThrow(/delegation buffer lamports is stated 0 and measured 2 run accounts|delegation buffer lamports is stated 0 and measured 0 buffer accounts/);
  expect(() => requireRunCosts(funded)).toThrow("delegation funding is stated 3271200 and measured 2850080");
  // An account changes size: it is no longer found, and that is named too.
  const resized = copy();
  for (const inner of resized.entry.meta!.innerInstructions!) {
    for (const instruction of inner.instructions as { parsed: { info: { space: number } } }[]) {
      if (instruction.parsed.info.space === 118) instruction.parsed.info.space = 150;
    }
  }
  expect(() => requireRunCosts(resized)).toThrow("delegation funding is stated 3271200 and measured 0 delegation metadata accounts");
});

it("a_run_from_before_the_delegation_programs_last_upgrade_proves_nothing", () => {
  expect(() => requireRunCosts({ ...copy(), delegationDeploySlot: recorded.entry.slot }))
    .toThrow(`No run has been measured since the delegation program was deployed at slot ${recorded.entry.slot}`);
  // Three transactions that are not one run are refused, not read as one.
  const other = copy();
  other.consume.transaction.message.accountKeys = other.consume.transaction.message.accountKeys.map(key =>
    ({ ...key, pubkey: key.pubkey === recorded.entry.transaction.message.accountKeys[0]!.pubkey ? key.pubkey : "11111111111111111111111111111111" }));
  expect(() => requireRunCosts(other)).toThrow("are not one run");
  const failed = copy(); failed.undelegation.meta!.err = { InstructionError: [0, "Custom"] };
  expect(() => requireRunCosts(failed)).toThrow("The recorded undelegation did not succeed");
});
