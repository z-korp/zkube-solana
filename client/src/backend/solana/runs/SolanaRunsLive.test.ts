// @vitest-environment node

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { RunView } from "../../views";
import { makeActiveRun } from "../../../test/fixtures/activeRun";
import { projectSolanaRun } from "./SolanaRunsLive";

describe("Solana Runs projection", () => {
  it("solana_backend_projects_every_view_field", () => {
    const view = projectSolanaRun(
      makeActiveRun({
        mode: "daily",
        runId: 72n,
        lifecycle: "finished",
        finishReason: "deadline",
        deadlineAt: 2_000_000,
        runToken: {
          config: new Uint8Array([1]),
          state: new Uint8Array([2, 3, 4]),
        },
      }),
    );

    expect(Schema.decodeUnknownSync(RunView)(view)).toEqual(view);
    expect(Object.keys(view).sort()).toEqual(
      ["deadlineAt", "finishReason", "mode", "phase", "runId", "token"].sort(),
    );
    expect(view).toMatchObject({
      mode: "arcade",
      runId: "72",
      phase: "finished",
      finishReason: "deadline",
    });
  });
});
