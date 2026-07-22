import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import GuardianPrizeResult from "./GuardianPrizeResult";

vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("GuardianPrizeResult", () => {
  it("celebrates the delivered prize with period, amount, and push-only copy", () => {
    render(
      <GuardianPrizeResult
        open
        onDismiss={vi.fn()}
        zoneId={1}
        amountLamports={500_000_000n}
        periodLabel="Daily"
      />,
    );

    expect(screen.getByText("Daily prize")).toBeInTheDocument();
    expect(screen.getByText("+0.5")).toBeInTheDocument();
    expect(screen.getByText("SOL")).toBeInTheDocument();
    expect(
      screen.getByText("Pushed to your wallet · no claim"),
    ).toBeInTheDocument();
  });

  it("dismisses via the Nice button", () => {
    const onDismiss = vi.fn();
    render(
      <GuardianPrizeResult
        open
        onDismiss={onDismiss}
        zoneId={2}
        amountLamports={250_000_000n}
        periodLabel="Weekly"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Nice" }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
