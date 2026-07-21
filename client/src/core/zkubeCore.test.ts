// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import golden from "../../../fixtures/replays/golden-daily-run-v1.json";
import continuation from "../../../fixtures/replays/golden-perfect-clear-continuation-v1.json";
import {
  coreEmptyContinuationRows,
  coreInitialReplayCommitment,
  corePlayerId,
  coreWeeklyMetricLabels,
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

  it("selects one typed metric from each Weekly category", () => {
    const labels = coreWeeklyMetricLabels(42, decodeHex(golden.rules_hash_hex));
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/combo/i);
    expect(labels[1]).toMatch(/action/i);
    expect(labels[2]).toMatch(/lines|blocks|perfect/i);
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

  it("rejects malformed inputs before crossing into WASM", () => {
    expect(() => corePlayerId(new Uint8Array(31), new Uint8Array(32))).toThrow(
      "chainDomain must contain 32 bytes",
    );
    expect(() => decodeHex("not-hex")).toThrow("malformed");
  });
});
