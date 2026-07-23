import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { BonusType } from "@/chain/bonusTypes";
import GameActionBar from "@/ui/components/actionbar/GameActionBar";
import GameHud from "@/ui/components/hud/GameHud";

const fixtures = vi.hoisted(() => ({
  useBonus: vi.fn(),
}));

vi.mock("@/contexts/hooks", async () =>
  (await import("@/test/mocks/contexts")).musicPlayerMock(),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(hover: none)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Practice game chrome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders real Practice HUD and controls without a composed-ref update loop", () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <>
        <GameHud
          level={1}
          levelScore={120}
          targetScore={0}
          movesRemaining={87}
          combo={4}
          constraintProgress={0}
          constraint2Progress={0}
          gameLevel={null}
          mode={1}
          totalScore={145}
          engineScore={120}
          challengeBonus={25}
          pressureScore={120}
          dailyRuleName="Highest combo"
          dailyRuleDescription="Build the strongest combo."
          dailyObjectiveState="Best combo 4"
          currentDifficulty={2}
          endlessThresholds={[50, 100, 150, 200, 250, 300, 350]}
          endlessScoreMultipliersX100={[100, 110, 120, 130, 140, 150, 160, 170]}
          zoneId={1}
        />
        <GameActionBar
          bonusSlots={[
            {
              type: BonusType.Wave,
              charges: 2,
              isActive: true,
              icon: "/wave.png",
              name: "Wave",
              description: "Clear one row.",
              triggerDescription: "Chain 4 combos",
              startingCharges: 0,
              onClick: fixtures.useBonus,
            },
          ]}
          activeBonus={BonusType.None}
          bonusDescription=""
          onSurrender={vi.fn()}
          zoneId={1}
        />
      </>,
    );

    const guardian = screen.getByRole("button", { name: "About Mako" });
    const bonus = screen.getByRole("button", { name: "Wave: 2 charges" });
    expect(guardian.tagName).toBe("BUTTON");
    expect(bonus.tagName).toBe("BUTTON");

    act(() => fireEvent.click(bonus));
    expect(fixtures.useBonus).toHaveBeenCalledOnce();
    expect(screen.getAllByText("Clear one row.").length).toBeGreaterThan(0);

    const messages = errors.mock.calls.flat().join(" ");
    expect(messages).not.toMatch(
      /Maximum update depth|Minified React error #185/i,
    );
  });
});
