import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Effect, ManagedRuntime } from "effect";
import { Content, Runs, StoreEconomy } from "@/backend/services";
import type { RunAction, RunView } from "@/backend/views";
import { makeLocalBackendLive } from "@/backend/local/LocalBackendLive";
import { emptyLocalProductState } from "@/backend/local/localPersistence";
import { coreBuildRunConfig, corePlayRunMove, coreRunSummary, initializeZkubeCoreSync } from "@/core/zkubeCore";

export interface Command { kind: string; realm?: number; level?: number; id?: string; action?: RunAction; now?: number; owned?: boolean; price?: string; fail?: boolean }
const view = (value: RunView | null | undefined) => value ? { id: value.runId, mode: value.mode, tokenHex: Buffer.from(value.token).toString("hex") } : null;
export async function scenario(name: string, initial: ReturnType<typeof emptyLocalProductState>, commands: Command[], make = makeLocalBackendLive) {
  let now = 20705 * 86400 + 123, persisted: string | null = JSON.stringify(initial), failWrites = false;
  let owned = false, price = "€0.99", billingFails = true, writes = 0;
  const storage = { getItem: () => persisted, setItem: (_key: string, value: string) => { if (failWrites) throw new Error("disk-full"); persisted = value; writes++; }, removeItem: () => {} };
  const create = () => ManagedRuntime.make(make({ target: "store", seed: new Uint8Array(32).fill(0x5a), nowUnix: () => now, storage,
    campaignBilling: { queryCampaign: async () => { if (billingFails) throw new Error("billing-offline"); return { campaignOwned: owned, price }; }, purchaseCampaign: async () => {}, restorePurchases: async () => {} } }));
  let runtime = create();
  async function ready() { await runtime.runPromise(Effect.flatMap(Content, content => content.today())); await new Promise<void>(done => setImmediate(done)); }
  await ready();
  const steps: unknown[] = [];
  async function execute(command: Command) {
    let result: RunView | null = null, rejected = false;
    try {
      if (command.kind === "campaign") result = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.startCampaign(command.realm!, command.level!)));
      else if (command.kind === "daily") result = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.enterDaily()));
      else if (command.kind === "act") result = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.act(command.id!, command.action!)));
      else if (command.kind === "time") now = command.now!;
      else if (command.kind === "storage") failWrites = command.fail!;
      else if (command.kind === "billing") { owned = command.owned!; price = command.price!; billingFails = command.fail!; await runtime.runPromise(Effect.flatMap(StoreEconomy, store => store.restorePurchases())); }
      else if (command.kind === "restart") { await runtime.dispose(); billingFails = true; runtime = create(); await ready(); }
      else throw new Error("Unknown fixture command");
    } catch { rejected = true; }
    const campaign = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.active("campaign")));
    const daily = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.active("arcade")));
    const today = await runtime.runPromise(Effect.flatMap(Content, content => content.today()));
    steps.push({ command, rejected, result: view(result), campaign: view(campaign), daily: view(daily), persisted: persisted === null ? null : JSON.parse(persisted), writes,
      today: { dayId: today.dayId, realm: today.realm, kind: today.objective.kind, value: today.objective.value, opensAt: today.opensAt, freezesAt: today.freezesAt } });
    return result;
  }
  try {
    for (const command of commands) {
      if (command.kind !== "play") { await execute(command); continue; }
      // Search uses the actual backend. Rejections change no token; only the
      // accepted gesture is emitted as a high-level input for C# to execute.
      for (let turn = 0; turn < 60; turn++) {
        const current = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.active(command.id === "1" && name.startsWith("campaign") ? "campaign" : "arcade")));
        if (!current || coreRunSummary(current.token).phase !== "playing") break;
        const summary = coreRunSummary(current.token); let accepted: RunAction | undefined, acceptedView: RunView | undefined;
        if (current.mode === "campaign") {
          // Fixture search ranks real native results. The actual backend still
          // executes the chosen gesture; no expected state is manufactured here.
          const catalog = await runtime.runPromise(Effect.flatMap(Content, content => content.catalog()));
          const realm = catalog.realms[0]!, level = realm.levels[0]!;
          const config = coreBuildRunConfig({ mode: "campaign", rulesHash: new Uint8Array(32).fill(0x33), initialReplay: new Uint8Array(32).fill(0x42),
            maxMoves: level.moveBudget, bonusType: realm.guardian.bonus, trigger: realm.guardian.trigger, triggerThreshold: realm.guardian.threshold,
            startingHeight: realm.startingHeight, fixedTier: level.tier, pointsRequired: level.target, primary: level.primary, secondary: level.secondary,
            objective: { kind: 0, value: 0, requiredCount: 0 } });
          let best = -Infinity;
          for (let row = 0; row < 10; row++) for (let start = 0; start < 8; start++) for (let destination = 0; destination < 8; destination++) {
            if (destination === start || !summary.grid[row * 8 + start]) continue;
            try {
              const after = coreRunSummary(corePlayRunMove({ config, state: current.token, action: summary.actionCounter, expectedMove: summary.moves, row, start, destination }));
              const height = Math.ceil((after.grid.reduce((last, value, index) => value !== 0 ? index : last, -1) + 1) / 8);
              const rank = after.latchedStarSources * 100000 + after.score * 100 - height * 10 - after.grid.filter(value => value !== 0).length;
              if (rank > best) { best = rank; accepted = { _tag: "Move", row, start, destination }; }
            } catch { /* Native rejection excludes this candidate from the fixture search. */ }
          }
          if (accepted) acceptedView = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.act(current.runId, accepted!)));
        }
        for (let row = 0; row < 10 && !accepted; row++) for (let start = 0; start < 8 && !accepted; start++) for (let destination = 0; destination < 8; destination++) {
          if (destination === start || !summary.grid[row * 8 + start]) continue;
          const action = { _tag: "Move" as const, row, start, destination };
          try {
            acceptedView = await runtime.runPromise(Effect.flatMap(Runs, runs => runs.act(current.runId, action)));
            accepted = action; break;
          } catch { /* Try another legal gesture without altering the accepted run. */ }
        }
        if (!accepted) break;
        // Capture the already accepted effect without applying the move twice.
        const result = acceptedView!;
        const commandForCapture: Command = { kind: "act", id: current.runId, action: accepted };
        const today = await runtime.runPromise(Effect.flatMap(Content, content => content.today()));
        steps.push({ command: commandForCapture, rejected: false, result: view(result), campaign: view(await runtime.runPromise(Effect.flatMap(Runs, runs => runs.active("campaign")))),
          daily: view(await runtime.runPromise(Effect.flatMap(Runs, runs => runs.active("arcade")))), persisted: JSON.parse(persisted!), writes,
          today: { dayId: today.dayId, realm: today.realm, kind: today.objective.kind, value: today.objective.value, opensAt: today.opensAt, freezesAt: today.freezesAt } });
        if (result.mode === "arcade" && coreRunSummary(result.token).dailyScore > 0) break;
      }
    }
    return { name, initial, now: 20705 * 86400 + 123, steps };
  } finally { await runtime.dispose(); }
}

export async function produce(root: string) {
  initializeZkubeCoreSync(readFileSync(resolve(root, "client/src/core/generated/zkube_core_bg.wasm")));
  const base = emptyLocalProductState();
  const unlocked = { ...base, campaignOwned: true, stars: Array<number>(100).fill(1) };
  const cases = [];
  cases.push(await scenario("campaign-action", base, [{ kind: "campaign", realm: 1, level: 1 }, { kind: "play", id: "1" }, { kind: "act", id: "1", action: { _tag: "Reroll" } }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }]));
  cases.push(await scenario("daily-actions-restart", base, [{ kind: "daily" }, { kind: "play", id: "1" }, { kind: "act", id: "1", action: { _tag: "Bonus", row: 0, column: 0 } }, { kind: "act", id: "1", action: { _tag: "Reroll" } }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }, { kind: "daily" }, { kind: "restart" }, { kind: "daily" }]));
  cases.push(await scenario("old-daily-completion", base, [{ kind: "daily" }, { kind: "play", id: "1" }, { kind: "time", now: 20706 * 86400 }, { kind: "daily" }, { kind: "act", id: "1", action: { _tag: "Reroll" } }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }]));
  cases.push(await scenario("old-campaign-completion", base, [{ kind: "campaign", realm: 1, level: 1 }, { kind: "campaign", realm: 1, level: 2 }, { kind: "act", id: "1", action: { _tag: "Reroll" } }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }]));
  cases.push(await scenario("reservation-disk-failure", base, [{ kind: "storage", fail: true }, { kind: "daily" }, { kind: "storage", fail: false }, { kind: "daily" }, { kind: "restart" }, { kind: "daily" }]));
  cases.push(await scenario("terminal-disk-failure", base, [{ kind: "daily" }, { kind: "play", id: "1" }, { kind: "storage", fail: true }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }, { kind: "storage", fail: false }, { kind: "act", id: "1", action: { _tag: "Finish", reason: "abandon" } }, { kind: "restart" }, { kind: "daily" }]));
  cases.push(await scenario("billing-locks", { ...base, stars: base.stars.map((value, i) => i === 29 ? 1 : value) }, [{ kind: "campaign", realm: 2, level: 1 }, { kind: "campaign", realm: 4, level: 1 }, { kind: "billing", owned: true, price: "$0.99", fail: false }, { kind: "campaign", realm: 4, level: 1 }, { kind: "billing", owned: false, price: "?", fail: true }, { kind: "campaign", realm: 4, level: 1 }, { kind: "billing", owned: false, price: "¥100", fail: false }, { kind: "campaign", realm: 4, level: 1 }]));
  for (let realm = 1; realm <= 10; realm++) cases.push(await scenario(`realm-${realm}-campaign-config`, unlocked, [{ kind: "campaign", realm, level: 10 }]));
  cases.push(await scenario("utc-streak-gap", base, [{ kind: "time", now: 20706 * 86400 - 1 }, { kind: "daily" }, { kind: "time", now: 20706 * 86400 }, { kind: "daily" }, { kind: "time", now: 20708 * 86400 }, { kind: "daily" }]));
  const source = process.env.ZKUBE_LOCAL_BACKEND_SOURCE ?? resolve(root, "client/src/backend/local/LocalBackendLive.ts");
  return { schemaVersion: 1, sourceSha256: createHash("sha256").update(readFileSync(source)).digest("hex"), cases };
}
