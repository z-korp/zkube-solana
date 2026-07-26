import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import DailyStatusPanel from "./DailyStatusPanel";

const CTA_NAME = "Play Campaign while you wait";

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("DailyStatusPanel", () => {
  it("offers Campaign when today's Daily is delayed", () => {
    const onPlayCampaign = vi.fn();
    render(
      <DailyStatusPanel lifecycle="delayed" onPlayCampaign={onPlayCampaign} />,
    );

    expect(
      screen.getByText("Today’s Daily is running late"),
    ).toBeInTheDocument();
    const cta = screen.getByRole("button", { name: CTA_NAME });
    fireEvent.click(cta);
    expect(onPlayCampaign).toHaveBeenCalledTimes(1);
  });

  it("offers Campaign when only a stale previous Daily is visible", () => {
    render(<DailyStatusPanel lifecycle="stale" onPlayCampaign={vi.fn()} />);

    expect(
      screen.getByText("Yesterday’s Daily is still visible"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: CTA_NAME })).toBeInTheDocument();
  });

  it("shows only the schedule during the normal preparation grace", () => {
    render(<DailyStatusPanel lifecycle="preparing" onPlayCampaign={vi.fn()} />);

    expect(screen.getByText("Daily being prepared")).toBeInTheDocument();
    expect(screen.getByText("Opens 00:00 UTC")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
