import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { BonusType } from "@/chain/bonusTypes";
import type { Game } from "@/game/model";
import type { Block } from "@/types/types";
import GameBoard from "./GameBoard";
import type { GridProps, ReceiptProjection } from "./Grid";

const captured = vi.hoisted(() => ({
  gridProps: null as GridProps | null,
}));

vi.mock("./Grid", () => ({
  default: (props: GridProps) => {
    captured.gridProps = props;
    return <div data-testid="grid" />;
  },
}));

vi.mock("./NextLine", () => ({
  default: ({ nextLineData }: { nextLineData: Block[] }) => (
    <div data-testid="next-line">
      {nextLineData.map((block) => `${block.x}:${block.width}`).join(",")}
    </div>
  ),
}));

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

const ROW_A = [2, 0, 0, 0, 0, 0, 0, 0];
const ROW_B = [0, 0, 3, 0, 0, 0, 0, 0];
const ROW_C = [0, 0, 0, 0, 0, 0, 0, 1];

const GRID = [
  ...Array.from({ length: 9 }, () => Array<number>(8).fill(0)),
  [1, 0, 0, 0, 0, 0, 0, 0],
];

const receipt: ReceiptProjection = {
  blocks: GRID,
  nextRow: ROW_B,
  over: false,
};

const renderBoard = (nextLine: number[], onMove: GridProps["onMove"]) => (
  <GameBoard
    initialGrid={GRID}
    nextLine={nextLine}
    game={{ id: 1n } as Game}
    activeBonus={BonusType.None}
    bonusDescription=""
    levelTransitionPending={false}
    onMove={onMove}
    onBonus={vi.fn()}
  />
);

const stripText = () => screen.getByTestId("next-line").textContent;

describe("GameBoard next-line preview", () => {
  it("holds the preview while a receipt is pending and advances at cascade end", async () => {
    let resolveMove: (value: ReceiptProjection) => void = () => {};
    const onMove: GridProps["onMove"] = vi.fn(
      () =>
        new Promise<ReceiptProjection>((resolve) => {
          resolveMove = resolve;
        }),
    );

    const { rerender } = render(renderBoard(ROW_A, onMove));
    expect(stripText()).toBe("0:2");

    // Player moves; the wrapped onMove marks a receipt in flight.
    let movePromise: Promise<ReceiptProjection | void> = Promise.resolve();
    act(() => {
      movePromise = captured.gridProps!.onMove(9, 0, 1);
    });

    // Chain confirms mid-cascade: the authoritative prop advances, but the
    // visible strip must not.
    rerender(renderBoard(ROW_B, onMove));
    expect(stripText()).toBe("0:2");
    // Grid itself still receives the authoritative row.
    expect(captured.gridProps!.nextLineData.map((b) => `${b.x}:${b.width}`))
      .toEqual(["2:3"]);

    await act(async () => {
      resolveMove(receipt);
      await movePromise;
    });
    // Receipt resolved but the cascade hasn't finished: still held.
    expect(stripText()).toBe("0:2");

    // applyReceipt fires onNextLineUpdate at cascade end: strip advances.
    act(() => {
      captured.gridProps!.onNextLineUpdate?.(ROW_B);
    });
    expect(stripText()).toBe("2:3");

    // Idle out-of-band correction (watcher/VRF) flows straight through.
    rerender(renderBoard(ROW_C, onMove));
    expect(stripText()).toBe("7:1");
  });

  it("resumes following the prop after a failed move", async () => {
    const onMove: GridProps["onMove"] = vi.fn(() =>
      Promise.reject(new Error("timeout")),
    );

    const { rerender } = render(renderBoard(ROW_A, onMove));
    expect(stripText()).toBe("0:2");

    await act(async () => {
      await captured.gridProps!.onMove(9, 0, 1).catch(() => {});
    });

    rerender(renderBoard(ROW_C, onMove));
    expect(stripText()).toBe("7:1");
  });
});
