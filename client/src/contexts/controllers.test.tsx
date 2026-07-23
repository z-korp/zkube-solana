import React from "react";
import { render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CampaignProvider, useCampaign } from "./campaign";
import { DailyProvider, useDaily } from "./daily";
import { RunProvider, useRun } from "./run";

const controllers = vi.hoisted(() => ({
  campaign: { kind: "campaign-controller" },
  daily: { kind: "daily-controller" },
  run: { kind: "run-controller" },
}));

const chainHooks = vi.hoisted(() => ({
  campaign: vi.fn(() => controllers.campaign),
  daily: vi.fn(() => controllers.daily),
  run: vi.fn(() => controllers.run),
}));

vi.mock("@/chain/useCampaignController", () => ({
  useCampaignController: chainHooks.campaign,
}));

vi.mock("@/chain/useDailyController", () => ({
  useDailyController: chainHooks.daily,
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
      observed = [useRun(), useCampaign(), useDaily()];
      return null;
    }

    render(
      <RunProvider>
        <CampaignProvider>
          <DailyProvider>
            <Probe />
          </DailyProvider>
        </CampaignProvider>
      </RunProvider>,
    );

    expect(chainHooks.run).toHaveBeenCalledTimes(2);
    expect(chainHooks.run).toHaveBeenNthCalledWith(1, "campaign");
    expect(chainHooks.run).toHaveBeenNthCalledWith(2, "arcade");
    expect(chainHooks.campaign).toHaveBeenCalledTimes(1);
    expect(chainHooks.daily).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      {
        ...controllers.run,
        campaign: controllers.run,
        arcade: controllers.run,
      },
      controllers.campaign,
      controllers.daily,
    ]);
  });
});
