import React from "react";
import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CampaignProvider, useCampaign } from "./campaign";
import { DailyProvider, useDaily } from "./daily";
import { ProgressProvider, useProgress } from "./progress";
import { RunProvider, useRun } from "./run";

const controllers = vi.hoisted(() => ({
  campaign: { kind: "campaign-controller" },
  daily: { kind: "daily-controller" },
  progress: { kind: "progress-controller" },
  run: { kind: "run-controller" },
}));

const chainHooks = vi.hoisted(() => ({
  campaign: vi.fn(() => controllers.campaign),
  daily: vi.fn(() => controllers.daily),
  progress: vi.fn(() => controllers.progress),
  run: vi.fn(() => controllers.run),
}));

vi.mock("@/chain/useCampaignController", () => ({
  useCampaignController: chainHooks.campaign,
}));

vi.mock("@/chain/useDailyController", () => ({
  useDailyController: chainHooks.daily,
}));

vi.mock("@/chain/useProgressController", () => ({
  useProgressController: chainHooks.progress,
}));

vi.mock("@/chain/useRunController", () => ({
  useRunController: chainHooks.run,
}));

beforeAll(() => {
  // vitest.config.ts does not load Vite's React JSX transform.
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("shared controller providers", () => {
  it("creates one controller per provider and preserves each return object", () => {
    let observed: unknown[] = [];

    function Probe() {
      observed = [
        useRun(),
        useCampaign(),
        useProgress(),
        useDaily(),
      ];
      return null;
    }

    render(
      <RunProvider>
        <CampaignProvider>
          <ProgressProvider>
            <DailyProvider>
              <Probe />
            </DailyProvider>
          </ProgressProvider>
        </CampaignProvider>
      </RunProvider>,
    );

    expect(chainHooks.run).toHaveBeenCalledTimes(1);
    expect(chainHooks.campaign).toHaveBeenCalledTimes(1);
    expect(chainHooks.progress).toHaveBeenCalledTimes(1);
    expect(chainHooks.daily).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      controllers.run,
      controllers.campaign,
      controllers.progress,
      controllers.daily,
    ]);
  });
});
