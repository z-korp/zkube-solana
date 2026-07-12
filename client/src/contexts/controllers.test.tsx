import React from "react";
import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CampaignProvider, useCampaignController } from "./campaign";
import { DailyProvider, useDailyController } from "./daily";
import { ProgressProvider, useProgressController } from "./progress";
import { RunProvider, useRun } from "./run";

const controllers = vi.hoisted(() => ({
  campaign: { kind: "campaign-controller" },
  daily: { kind: "daily-controller" },
  progress: { kind: "progress-controller" },
  run: { kind: "run-controller" },
}));

const rebootHooks = vi.hoisted(() => ({
  campaign: vi.fn(() => controllers.campaign),
  daily: vi.fn(() => controllers.daily),
  progress: vi.fn(() => controllers.progress),
  run: vi.fn(() => controllers.run),
}));

vi.mock("@/solana/reboot/useRebootCampaign", () => ({
  useRebootCampaign: rebootHooks.campaign,
}));

vi.mock("@/solana/reboot/useRebootDaily", () => ({
  useRebootDaily: rebootHooks.daily,
}));

vi.mock("@/solana/reboot/useRebootProgress", () => ({
  useRebootProgress: rebootHooks.progress,
}));

vi.mock("@/solana/reboot/useRebootRun", () => ({
  useRebootRun: rebootHooks.run,
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
        useCampaignController(),
        useProgressController(),
        useDailyController(),
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

    expect(rebootHooks.run).toHaveBeenCalledTimes(1);
    expect(rebootHooks.campaign).toHaveBeenCalledTimes(1);
    expect(rebootHooks.progress).toHaveBeenCalledTimes(1);
    expect(rebootHooks.daily).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      controllers.run,
      controllers.campaign,
      controllers.progress,
      controllers.daily,
    ]);
  });
});
