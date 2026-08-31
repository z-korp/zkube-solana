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
import { Content, Runs } from "../services";
import { localRowsFromVrf, makeLocalBackendLive } from "./LocalBackendLive";

initializeZkubeCoreSync(
  readFileSync(
    new URL("../../core/generated/zkube_core_bg.wasm", import.meta.url),
  ),
);

describe("LocalBackendLive", () => {
  it("local_backend_plays_a_golden_replay", async () => {
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({
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
    const runtime = ManagedRuntime.make(makeLocalBackendLive());
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

  it("playtest_daily_is_open_on_the_shared_current_utc_day", async () => {
    const nowUnix = Date.UTC(2026, 7, 31, 12, 30) / 1_000;
    const runtime = ManagedRuntime.make(
      makeLocalBackendLive({ playtest: true, nowUnix: () => nowUnix }),
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
});

async function finishedLocalToken(seed: Uint8Array): Promise<Uint8Array> {
  const runtime = ManagedRuntime.make(makeLocalBackendLive({ seed }));
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
