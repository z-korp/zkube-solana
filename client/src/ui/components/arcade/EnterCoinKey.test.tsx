import React from "react";
import { render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import EnterCoinKey from "./EnterCoinKey";

beforeAll(() => {
  vi.stubGlobal("React", React);
  // jsdom has no matchMedia; motion's useReducedMotion queries it.
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("EnterCoinKey", () => {
  it("sells an entry as amount-then-coin: the coin is the only currency mark and sits after the price", () => {
    render(<EnterCoinKey label="Enter" amountSol="0.010" />);

    const key = screen.getByRole("button", { name: /enter 0\.010/i });
    // Exactly one currency object — the embossed coin, no trailing SOL mark.
    const marks = key.querySelectorAll("svg");
    expect(marks).toHaveLength(1);
    const coin = marks[0]!;
    expect(coin.querySelector("circle")).not.toBeNull();
    // The coin follows the price (unit on the right).
    const text = key.querySelector("span");
    expect(text?.textContent).toBe("Enter 0.010");
    expect(
      text!.compareDocumentPosition(coin) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders plain for non-entry verbs", () => {
    render(<EnterCoinKey label="Entries closed" disabled />);

    const key = screen.getByRole("button", { name: /entries closed/i });
    expect(key.querySelectorAll("svg")).toHaveLength(0);
  });
});
