import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import type { HTMLAttributes } from "react";
import Grid, { type ReceiptProjection } from "./Grid";
import { BonusType } from "../../solana/reboot/bonusTypes";
import { useMoveStore } from "../../stores/moveTxStore";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

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

    expect(
      (container.querySelector(".svg-block") as SVGGElement).style.transform,
    ).not.toBe("translate(0px, 180px)");
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

    expect(
      (container.querySelector(".svg-block") as SVGGElement).style.transform,
    ).not.toBe("translate(0px, 180px)");
  });
});

describe("Grid move queue", () => {
  const receipt = (): ReceiptProjection => ({
    blocks: Array.from({ length: 10 }, (_, y) =>
      y === 9 ? [0, 0, 1, 0, 0, 0, 0, 0] : Array(8).fill(0),
    ),
    nextRow: [2, 2, 0, 0, 0, 0, 0, 0],
    over: true,
  });

  const dragBlockTo = (container: HTMLElement, clientX: number) => {
    const block = container.querySelector(".svg-block") as SVGGElement;
    const surface = container.querySelector("svg") as SVGSVGElement;
    Object.defineProperty(surface, "getScreenCTM", {
      value: () => ({ a: 1, e: 0 }),
      configurable: true,
    });
    fireEvent.pointerDown(block, { clientX: 10 });
    fireEvent.pointerMove(document, { clientX });
    fireEvent.pointerUp(document);
  };

  const baseProps = {
    gameId: 1n,
    initialData: [{ id: 1, x: 0, y: 9, width: 1 }],
    nextLineData: [],
    setNextLineHasBeenConsumed: vi.fn(),
    gridSize: 20,
    gridWidth: 8,
    gridHeight: 10,
    bonus: BonusType.None,
    isTxProcessing: false,
    setIsTxProcessing: vi.fn(),
    levelTransitionPending: false,
    onBonus: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    useMoveStore.setState({
      queue: [],
      isQueueProcessing: false,
      lastFailedMoveError: null,
    });
  });

  it("rolls back the grid and clears the queue when the move tx fails", async () => {
    const onMove = vi.fn(async () => {
      throw new Error("ER rejected the move");
    });
    const { container } = render(<Grid {...baseProps} onMove={onMove} />);

    dragBlockTo(container, 50);

    await waitFor(() =>
      expect(useMoveStore.getState().lastFailedMoveError).toBe(
        "ER rejected the move",
      ),
    );
    // No stuck "submitting" entry may survive the failure.
    expect(useMoveStore.getState().queue).toHaveLength(0);
    expect(useMoveStore.getState().isQueueProcessing).toBe(false);
    // The optimistic move was rolled back to the last authoritative board.
    await waitFor(() =>
      expect(
        (container.querySelector(".svg-block") as SVGGElement).style.transform,
      ).toBe("translate(0px, 180px)"),
    );
  });

  it("completes a move with an empty next line without stalling the machine", async () => {
    const postMoveGrid = Array.from({ length: 10 }, (_, y) =>
      y === 9 ? [0, 0, 1, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0, 0],
    );
    const onMove = vi.fn(async () => ({
      blocks: postMoveGrid,
      nextRow: [2, 2, 0, 0, 0, 0, 0, 0],
      over: false,
    }));
    const { container } = render(<Grid {...baseProps} onMove={onMove} />);

    dragBlockTo(container, 50);

    await waitFor(() => expect(onMove).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useMoveStore.getState().queue).toHaveLength(0));
    // The receipt must land and unlock the board (WAITING) even though no
    // next line was inserted — a second drag must still respond.
    await waitFor(() => {
      dragBlockTo(container, 90);
      expect(
        (container.querySelector(".svg-block") as SVGGElement).style.transform,
      ).not.toBe("translate(40px, 180px)");
    });
  });

  it("signals completion after an early receipt and the local cascade", async () => {
    const onCascadeComplete = vi.fn();
    const onMove = vi.fn(async () => receipt());
    const { container } = render(
      <Grid
        {...baseProps}
        onMove={onMove}
        onCascadeComplete={onCascadeComplete}
      />,
    );

    dragBlockTo(container, 50);

    await waitFor(() => expect(onMove).toHaveBeenCalledOnce());
    await waitFor(() => expect(onCascadeComplete).toHaveBeenCalledOnce(), {
      timeout: 5_000,
    });
  });

  it("waits for a late receipt after the local cascade before signaling", async () => {
    let resolveMove!: (value: ReceiptProjection) => void;
    const pendingMove = new Promise<ReceiptProjection>((resolve) => {
      resolveMove = resolve;
    });
    const onMove = vi.fn(() => pendingMove);
    const onCascadeComplete = vi.fn();
    const setIsTxProcessing = vi.fn();
    const { container } = render(
      <Grid
        {...baseProps}
        setIsTxProcessing={setIsTxProcessing}
        onMove={onMove}
        onCascadeComplete={onCascadeComplete}
      />,
    );

    dragBlockTo(container, 50);

    await waitFor(() => expect(onMove).toHaveBeenCalledOnce());
    await waitFor(() => expect(setIsTxProcessing).toHaveBeenCalledWith(true), {
      timeout: 5_000,
    });
    expect(onCascadeComplete).not.toHaveBeenCalled();

    resolveMove(receipt());
    await waitFor(() => expect(onCascadeComplete).toHaveBeenCalledOnce(), {
      timeout: 5_000,
    });
  });
});
