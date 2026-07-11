import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import type { HTMLAttributes } from "react";
import Grid from "./Grid";
import { BonusType } from "../../solana/reboot/bonusTypes";
import { useMoveStore } from "../../stores/moveTxStore";

vi.mock("motion/react", () => ({
  motion: {
    div: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

vi.mock("../elements/animatedText", () => ({
  default: () => null,
}));

vi.mock("@/contexts/hooks", () => ({
  useMusicPlayer: () => ({
    playExplode: vi.fn(),
    playSwipe: vi.fn(),
  }),
}));

vi.mock("@/ui/elements/theme-provider/hooks", () => ({
  useTheme: () => ({ themeTemplate: "theme-1" }),
}));

vi.mock("@/config/themes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/themes")>();
  return {
    ...actual,
    getThemeColors: () => ({
      particles: {
        explosion: ["#ffffff"],
      },
    }),
  };
});

vi.mock("@/hooks/useGridAnimations", () => ({
  default: () => ({
    shouldBounce: false,
    animateText: undefined,
    resetAnimateText: vi.fn(),
    setAnimateText: vi.fn(),
    animatedPoints: 0,
    setAnimatedPoints: vi.fn(),
    animatedCubes: 0,
    setAnimatedCubes: vi.fn(),
  }),
}));

vi.mock("@/hooks/useTransitionBlocks", () => ({
  default: () => ({
    transitioningBlocks: [],
    handleTransitionBlockStart: vi.fn(),
    handleTransitionBlockEnd: vi.fn(),
  }),
}));

describe("Grid drag interactions", () => {
  const baseProps = {
    gameId: 1n,
    initialData: [{ id: 1, x: 0, y: 9, width: 1 }],
    nextLineData: [],
    setNextLineHasBeenConsumed: vi.fn(),
    gridSize: 20,
    gridWidth: 8,
    gridHeight: 10,
    selectBlock: vi.fn(),
    bonus: BonusType.None,
    isTxProcessing: false,
    setIsTxProcessing: vi.fn(),
    score: 0,
    combo: 0,
    maxCombo: 0,
    setOptimisticScore: vi.fn(),
    setOptimisticCombo: vi.fn(),
    setOptimisticMaxCombo: vi.fn(),
    levelTransitionPending: false,
    onMove: vi.fn(async () => undefined),
    onBonus: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    useMoveStore.setState({
      isMoveComplete: false,
      queue: [],
      isQueueProcessing: false,
      lastFailedMoveError: null,
    });
  });

  it("desktop drag remains responsive after a no-move click", () => {
    const { container } = render(<Grid {...baseProps} />);
    const block = container.querySelector(".svg-block") as SVGGElement;
    const surface = container.querySelector("svg") as SVGSVGElement;
    Object.defineProperty(surface, "getScreenCTM", {
      value: () => ({ a: 1, e: 0 }),
    });

    expect(block.style.transform).toBe("translate(0px, 180px)");

    fireEvent.pointerDown(block, { clientX: 10 });
    fireEvent.pointerUp(document);

    fireEvent.pointerDown(block, { clientX: 10 });
    fireEvent.pointerMove(document, { clientX: 50 });

    expect((container.querySelector(".svg-block") as SVGGElement).style.transform).not.toBe(
      "translate(0px, 180px)",
    );
  });

  it("mobile drag remains responsive after a no-move tap", () => {
    const { container } = render(<Grid {...baseProps} />);
    const block = container.querySelector(".svg-block") as SVGGElement;
    const surface = container.querySelector("svg") as SVGSVGElement;
    Object.defineProperty(surface, "getScreenCTM", {
      value: () => ({ a: 1, e: 0 }),
    });

    expect(block.style.transform).toBe("translate(0px, 180px)");

    fireEvent.pointerDown(block, { clientX: 10, pointerType: "touch" });
    fireEvent.pointerUp(document, { pointerType: "touch" });

    fireEvent.pointerDown(block, { clientX: 10, pointerType: "touch" });
    fireEvent.pointerMove(document, { clientX: 50, pointerType: "touch" });

    expect((container.querySelector(".svg-block") as SVGGElement).style.transform).not.toBe(
      "translate(0px, 180px)",
    );
  });
});
