// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import golden from "../../../fixtures/replays/golden-daily-run-v1.json";
import continuation from "../../../fixtures/replays/golden-perfect-clear-continuation-v1.json";
import ladder from "../../../fixtures/ladder-points.json";
import parity from "../../../fixtures/game-parity.json";
import {
  coreEmptyContinuationRows,
  coreInitialReplayCommitment,
  coreLadderPoints,
  coreInitializeRun,
  corePlayerId,
  coreProtocol,
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

  it("rejects malformed inputs before crossing into WASM", () => {
    expect(() => corePlayerId(new Uint8Array(31), new Uint8Array(32))).toThrow(
      "chainDomain must contain 32 bytes",
    );
    expect(() => decodeHex("not-hex")).toThrow("malformed");
  });
});
