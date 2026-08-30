// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import golden from "../../../fixtures/replays/golden-daily-run-v1.json";
import continuation from "../../../fixtures/replays/golden-perfect-clear-continuation-v1.json";
import ladder from "../../../fixtures/ladder-points.json";
import parity from "../../../fixtures/game-parity.json";
import {
  coreEmptyContinuationRows,
  coreApplyRunVrf,
  coreBuildRunConfig,
  coreFinishRun,
  coreInitialReplayCommitment,
  coreLadderPoints,
  coreInitializeRun,
  corePlayRunMove,
  corePlayerId,
  coreProtocol,
  coreReconcileRunState,
  coreRunSummary,
  decodeHex,
  encodeHex,
  initializeZkubeCoreSync,
} from "./zkubeCore";

initializeZkubeCoreSync(
  readFileSync(new URL("./generated/zkube_core_bg.wasm", import.meta.url)),
);

describe("generated zkube-core WASM boundary", () => {
  it("matches the committed replay identity and initial commitment", () => {
    const chainDomain = decodeHex(golden.chain_domain_hex);
    const rawAccount = decodeHex(golden.raw_account_hex);
    expect(encodeHex(corePlayerId(chainDomain, rawAccount))).toBe(
      golden.player_id_hex,
    );
    expect(
      encodeHex(
        coreInitialReplayCommitment({
          chainDomain,
          challengeId: decodeHex(golden.challenge_id_hex),
          rulesHash: decodeHex(golden.rules_hash_hex),
          rawAccount,
          runId: BigInt(golden.run_id),
          mode: "ranked",
        }),
      ),
    ).toBe(golden.initial_replay_hash_hex);
  });

  it("matches the committed perfect-clear seed and preview rows", () => {
    expect(
      coreEmptyContinuationRows({
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

  it("matches every committed integer ladder vector", () => {
    for (const vector of ladder.vectors) {
      expect(coreLadderPoints(vector.qualifiedEntrants, vector.rank)).toBe(
        vector.points,
      );
    }
  });

  it("exposes the shared Run and protocol boundaries in the browser build", () => {
    const draw = parity.phase1Core.dailyPairDraw;
    expect(coreProtocol.dailyPairIndex(draw.startsDay)).toBe(
      draw.pairIndicesByDay[0],
    );
    const split = parity.phase1Core.dailyBoardSplit;
    expect(
      coreProtocol.dailyBoardPools(
        BigInt(split.poolLamports),
        split.themeQualifiedWinners,
      ),
    ).toHaveLength(16);
    expect(() => coreInitializeRun(new Uint8Array(88))).toThrow(
      "invalid run encoding",
    );
  });

  it("local_run_and_chain_run_agree_on_golden_replays", () => {
    const config = coreBuildRunConfig({
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
    });
    let state = coreInitializeRun(config);
    state = coreApplyRunVrf({
      config,
      state,
      requestCounter: 1,
      vrfOutput: decodeHex(golden.events[0].output_hex!),
    });
    state = corePlayRunMove({
      config,
      state,
      action: golden.events[1].action!,
      expectedMove: golden.events[1].expected_move!,
      row: golden.events[1].row!,
      start: golden.events[1].start!,
      destination: golden.events[1].destination!,
    });
    state = coreApplyRunVrf({
      config,
      state,
      requestCounter: 2,
      vrfOutput: decodeHex(golden.events[2].output_hex!),
    });
    state = coreFinishRun(config, state, "deadline");

    const local = coreRunSummary(state);
    const reconciled = coreRunSummary(
      coreReconcileRunState(config, {
        phase: "finished",
        endReason: 4,
        bonusType: 3,
        bonusCharges: golden.expected.bonus_charges,
        rerollCharges: 1,
        comboCounter: golden.expected.combo_counter,
        maxCombo: golden.expected.maximum_engine_combo,
        primaryProgress: golden.expected.primary_progress,
        secondaryProgress: golden.expected.secondary_progress,
        latchedStarSources: 0,
        streak: golden.expected.streak,
        chargesEarned: 0,
        currentTier: golden.expected.current_tier,
        levelLinesCleared: golden.expected.level_lines_cleared,
        moves: golden.expected.moves,
        actionCounter: golden.expected.action_counter,
        vrfRequestCounter: golden.expected.last_vrf_counter,
        pendingVrfCounter: 0,
        score: golden.expected.base_score,
        dailyScore: golden.expected.daily_score,
        objectiveTotal: BigInt(golden.expected.objective_total),
        pressureScore: golden.expected.pressure_score,
        grid: golden.expected.final_grid,
        nextRow: golden.expected.next_row,
        replayHash: decodeHex(golden.expected.final_replay_hash_hex),
      }),
    );

    expect(reconciled).toEqual(local);
    expect(local.grid).toEqual(golden.expected.final_grid);
    expect(encodeHex(Uint8Array.from(local.replayHash))).toBe(
      golden.expected.final_replay_hash_hex,
    );
  });

  it("rejects malformed inputs before crossing into WASM", () => {
    expect(() => corePlayerId(new Uint8Array(31), new Uint8Array(32))).toThrow(
      "chainDomain must contain 32 bytes",
    );
    expect(() => decodeHex("not-hex")).toThrow("malformed");
  });
});
