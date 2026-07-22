import React, { act } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";

describe("Tooltip", () => {
  let touch = false;
  let listeners: Set<() => void>;

  beforeEach(() => {
    listeners = new Set();
    vi.stubGlobal("React", React);
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return touch;
      },
      media: query,
      onchange: null,
      addEventListener: (_event: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) =>
        listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    touch = false;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stays controlled while switching between pointer and touch input", () => {
    const errors = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const warnings = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Help</button>
          </TooltipTrigger>
          <TooltipContent>Details</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );

    act(() => {
      touch = true;
      listeners.forEach((listener) => listener());
    });
    const trigger = screen.getByRole("button", { name: "Help" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("data-state", "instant-open");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("data-state", "closed");
    act(() => {
      touch = false;
      listeners.forEach((listener) => listener());
    });

    const messages = [...errors.mock.calls, ...warnings.mock.calls]
      .flat()
      .join(" ");
    expect(messages).not.toMatch(
      /controlled to uncontrolled|uncontrolled to controlled/i,
    );
  });
});
