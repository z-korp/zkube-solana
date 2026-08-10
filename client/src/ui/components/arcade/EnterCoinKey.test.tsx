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
  it("prices an entry in Kredits and never in SOL", () => {
    render(<EnterCoinKey label="Play" token="kredit" />);

    const key = screen.getByRole("button", { name: /play/i });
    // An entry costs exactly one Kredit, so the key shows the Kredit token and
    // no amount at all — the SOL price of a Kredit belongs in the shop.
    const text = key.querySelector("span");
    expect(text?.textContent).toBe("Play");
    const token = key.querySelector("img");
    expect(token?.getAttribute("src")).toBe("/assets/common/kredit.png");
    expect(key.querySelectorAll("svg")).toHaveLength(0);
    expect(
      text!.compareDocumentPosition(token!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders plain for verbs that spend nothing", () => {
    render(<EnterCoinKey label="Entries closed" disabled />);

    const key = screen.getByRole("button", { name: /entries closed/i });
    expect(key.querySelectorAll("img")).toHaveLength(0);
    expect(key.querySelectorAll("svg")).toHaveLength(0);
  });

  it("marks a collected prize in SOL, the one key that pays out", () => {
    render(<EnterCoinKey label="Collect 0.653" token="sol" />);

    const key = screen.getByRole("button", { name: /collect 0\.653/i });
    // Collecting is the only key denominated in SOL: it moves a prize rather
    // than buying an entry, so it must never wear the Kredit token.
    expect(key.querySelectorAll("img")).toHaveLength(0);
    expect(key.querySelectorAll("svg").length).toBeGreaterThan(0);
  });
});
