// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Effect, ManagedRuntime } from "effect";

import golden from "../../../../fixtures/replays/golden-daily-run-v1.json";
import continuation from "../../../../fixtures/replays/golden-perfect-clear-continuation-v1.json";
import {
  coreRunSummary,
  decodeHex,
  encodeHex,
  initializeZkubeCoreSync,
  type CoreRunConfigInput,
} from "@/core/zkubeCore";
import { currentDailyDayId } from "@/core/dailyRules";
import { computeArcadeLifecycle } from "@/ui/components/arcade/arcadeLifecycle";
import { Content, Runs, StoreEconomy } from "../services";
import { localRowsFromVrf, makeLocalBackendLive } from "./LocalBackendLive";
import { localProductStorage } from "./localPersistence";
import type { CampaignBilling } from "./storeBilling";
import type { StorageLike } from "@/platform/storage";

initializeZkubeCoreSync(
  readFileSync(
    new URL("../../core/generated/zkube_core_bg.wasm", import.meta.url),
  ),
);

describe("LocalBackendLive", () => {
  it("local_backend_plays_a_golden_replay", async () => {
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({
        target: "store",
        dailyConfig: goldenConfig(),
        dailyVrfOutputs: [
          decodeHex(golden.events[0].output_hex!),
          decodeHex(golden.events[2].output_hex!),
        ],
        deadlineAfterAcceptedActions: 1,
      }),
    );
    try {
      const view = await runtime.runPromise(
        Effect.gen(function* () {
          const runs = yield* Runs;
          const started = yield* runs.enterDaily();
          return yield* runs.act(started.runId, {
            _tag: "Move",
            row: golden.events[1].row!,
            start: golden.events[1].start!,
            destination: golden.events[1].destination!,
          });
        }),
      );
      const summary = coreRunSummary(view.token);
      expect(summary.grid).toEqual(golden.expected.final_grid);
      expect(summary.dailyScore).toBe(golden.expected.daily_score);
      expect(summary.objectiveTotal).toBe(
        BigInt(golden.expected.objective_total),
      );
      expect(summary.phase).toBe("finished");
      expect(view.finishReason).toBe("deadline");
      expect(encodeHex(Uint8Array.from(summary.replayHash))).toBe(
        golden.expected.final_replay_hash_hex,
      );
    } finally {
      await runtime.dispose();
    }

    expect(
      localRowsFromVrf({
        requestCounter: continuation.request_counter,
        vrfOutput: decodeHex(continuation.vrf_output_hex),
        rulesHash: decodeHex(continuation.rules_hash_hex),
        weights: continuation.weights,
      }),
    ).toEqual({
      seedRow: continuation.seed_row,
      previewRow: continuation.preview_row,
    });
  });

  it("local_rows_are_deterministic_per_seed", async () => {
    const seed = new Uint8Array(32).fill(7);
    const first = await finishedLocalToken(seed);
    const second = await finishedLocalToken(seed);
    expect(second).toEqual(first);
    expect(await finishedLocalToken(new Uint8Array(32).fill(8))).not.toEqual(
      first,
    );
  });

  it("terminal_campaign_run_leaves_the_resumable_slot_empty", async () => {
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({ target: "store" }),
    );
    try {
      const slot = await runtime.runPromise(
        Effect.gen(function* () {
          const runs = yield* Runs;
          const started = yield* runs.startCampaign(1, 1);
          const terminal = yield* runs.act(started.runId, {
            _tag: "Finish",
            reason: "abandon",
          });
          expect(coreRunSummary(terminal.token).phase).toBe("finished");
          return yield* runs.resume("campaign");
        }),
      );
      expect(slot).toBeNull();
    } finally {
      await runtime.dispose();
    }
  });

  it("local_daily_is_open_on_the_shared_current_utc_day", async () => {
    const nowUnix = Date.UTC(2026, 7, 31, 12, 30) / 1_000;
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({ target: "store", nowUnix: () => nowUnix }),
    );
    try {
      const today = await runtime.runPromise(
        Effect.flatMap(Content, (content) => content.today()),
      );
      expect(today.dayId).toBe(currentDailyDayId(nowUnix));
      expect(today.suspended).toBe(false);
      expect(today.opensAt).toBeLessThanOrEqual(nowUnix);
      expect(today.freezesAt).toBeGreaterThan(nowUnix);
      expect(
        computeArcadeLifecycle({
          view: {
            dayId: today.dayId,
            status: "open",
            opensAt: today.opensAt,
            runsCloseAt: today.freezesAt,
          },
          hasActiveRun: false,
          nowUnix,
        }),
      ).toBe("entries-open");
    } finally {
      await runtime.dispose();
    }
  });

  it("store_daily_is_one_attempt_per_day", async () => {
    let nowUnix = Date.UTC(2026, 7, 31, 12) / 1_000;
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({ target: "store", nowUnix: () => nowUnix }),
    );
    try {
      await runtime.runPromise(
        Effect.flatMap(Runs, (runs) => runs.enterDaily()),
      );
      await expect(
        runtime.runPromise(Effect.flatMap(Runs, (runs) => runs.enterDaily())),
      ).rejects.toThrow("already been played");
      nowUnix += 86_400;
      await expect(
        runtime.runPromise(Effect.flatMap(Runs, (runs) => runs.enterDaily())),
      ).resolves.toBeDefined();
    } finally {
      await runtime.dispose();
    }
  });

  it("store_daily_rows_derive_from_the_day", async () => {
    const nowUnix = Date.UTC(2026, 7, 31, 12) / 1_000;
    const first = ManagedRuntime.make(
      makeLocalBackendLive({ target: "store", nowUnix: () => nowUnix }),
    );
    const second = ManagedRuntime.make(
      makeLocalBackendLive({ target: "store", nowUnix: () => nowUnix }),
    );
    try {
      const start = (runtime: typeof first) =>
        runtime.runPromise(Effect.flatMap(Runs, (runs) => runs.enterDaily()));
      expect((await start(second)).token).toEqual((await start(first)).token);
    } finally {
      await Promise.all([first.dispose(), second.dispose()]);
    }
  });

  it("only_the_store_catalog_reports_purchase_locks", async () => {
    const store = ManagedRuntime.make(
      makeLocalBackendLive({ target: "store" }),
    );
    const playtest = ManagedRuntime.make(
      makeLocalBackendLive({ target: "playtest" }),
    );
    try {
      const catalog = (runtime: typeof store) =>
        runtime.runPromise(
          Effect.flatMap(Content, (content) => content.catalog()),
        );
      expect(
        (await catalog(store)).realms.map((realm) => realm.locked),
      ).toEqual([null, "stars", "stars", ...Array(7).fill("purchase")]);
      expect(
        (await catalog(playtest)).realms.every(
          (realm) => realm.locked === null,
        ),
      ).toBe(true);
    } finally {
      await Promise.all([store.dispose(), playtest.dispose()]);
    }
  });

  it("store_answer_overwrites_the_cached_campaign_entitlement", async () => {
    const storage = memoryStorage();
    localProductStorage(storage).write((current) => ({
      ...current,
      campaignOwned: true,
      campaignPrice: "$0.99",
    }));
    const billing = fakeCampaignBilling(false, "€0.99");
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({
        target: "store",
        storage,
        campaignBilling: billing,
      }),
    );
    try {
      const state = await runtime.runPromise(
        Effect.flatMap(StoreEconomy, (economy) => economy.restorePurchases()),
      );
      expect(state).toEqual({ campaignOwned: false, price: "€0.99" });
      expect(localProductStorage(storage).read().campaignOwned).toBe(false);
    } finally {
      await runtime.dispose();
    }
  });

  it("store_campaign_unlock_requires_store_ownership_at_the_run_boundary", async () => {
    const storage = memoryStorage();
    localProductStorage(storage).write((current) => ({
      ...current,
      stars: current.stars.map((stars, index) => (index === 29 ? 1 : stars)),
    }));
    const billing = fakeCampaignBilling(false, "¥0.99");
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({
        target: "store",
        storage,
        campaignBilling: billing,
      }),
    );
    try {
      await expect(
        runtime.runPromise(
          Effect.flatMap(Runs, (runs) => runs.startCampaign(4, 1)),
        ),
      ).rejects.toThrow("Unlock the full Campaign first");
      const state = await runtime.runPromise(
        Effect.flatMap(StoreEconomy, (economy) => economy.unlockCampaign()),
      );
      expect(state).toEqual({ campaignOwned: true, price: "¥0.99" });
      await expect(
        runtime.runPromise(
          Effect.flatMap(Runs, (runs) => runs.startCampaign(4, 1)),
        ),
      ).resolves.toBeDefined();
    } finally {
      await runtime.dispose();
    }
  });
});

async function finishedLocalToken(seed: Uint8Array): Promise<Uint8Array> {
  const runtime = ManagedRuntime.make(
    makeLocalBackendLive({ target: "playtest", seed }),
  );
  try {
    return await runtime.runPromise(
      Effect.gen(function* () {
        const runs = yield* Runs;
        const started = yield* runs.enterDaily();
        const finished = yield* runs.act(started.runId, {
          _tag: "Finish",
          reason: "abandon",
        });
        return finished.token;
      }),
    );
  } finally {
    await runtime.dispose();
  }
}

function goldenConfig(): CoreRunConfigInput {
  return {
    mode: "daily",
    rulesHash: decodeHex(golden.rules_hash_hex),
    initialReplay: decodeHex(golden.initial_replay_hash_hex),
    maxMoves: golden.rules.max_moves,
    bonusType: 3,
    trigger: golden.rules.guardian.trigger,
    triggerThreshold: golden.rules.guardian.threshold,
    startingHeight: golden.rules.starting_height,
    fixedTier: 0,
    pointsRequired: 0,
    primary: { kind: 0, value: 0, requiredCount: 0 },
    secondary: { kind: 0, value: 0, requiredCount: 0 },
    objective: { kind: 0, value: 0, requiredCount: 0 },
  };
}

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function fakeCampaignBilling(
  initialOwnership: boolean,
  price: string,
): CampaignBilling {
  let campaignOwned = initialOwnership;
  return {
    queryCampaign: async () => ({ campaignOwned, price }),
    purchaseCampaign: async () => {
      campaignOwned = true;
    },
    restorePurchases: async () => undefined,
  };
}
