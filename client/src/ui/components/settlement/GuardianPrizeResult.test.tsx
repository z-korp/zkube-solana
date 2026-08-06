import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import GuardianPrizeResult from "./GuardianPrizeResult";

const fixtures = vi.hoisted(() => ({
  reduceMotion: false,
  playSfx: vi.fn(),
}));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => fixtures.reduceMotion,
}));
vi.mock("@/contexts/hooks", async () =>
  (await import("@/test/mocks/contexts")).musicPlayerMock({
    playSfx: fixtures.playSfx,
  }),
);
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
  beforeEach(() => {
    fixtures.reduceMotion = true;
    vi.clearAllMocks();
  });

  it("celebrates the delivered prize with period, amount, and the guardian's line", async () => {
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
    await waitFor(() => expect(screen.getByText("+0.500")).toBeInTheDocument());
    // The official Solana logomark replaces the "SOL" text suffix.
    expect(screen.getByRole("img", { name: "SOL" })).toBeInTheDocument();
    // The guardian speaks its prize line (fully revealed under reduced motion).
    expect(
      screen.getByText(/The tide returns bearing gold\./),
    ).toBeInTheDocument();
    expect(fixtures.playSfx).toHaveBeenCalledWith("coin");
  });

  it("renders the final state without particles under reduced motion", () => {
    render(
      <GuardianPrizeResult
        open
        onDismiss={vi.fn()}
        zoneId={1}
        amountLamports={1_250_000_000n}
        periodLabel="Season"
      />,
    );
    expect(screen.getByText("+1.250")).toBeInTheDocument();
    expect(screen.queryByTestId("reward-particle")).not.toBeInTheDocument();
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
