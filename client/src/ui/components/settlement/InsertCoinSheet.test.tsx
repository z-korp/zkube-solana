import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/ui/elements/tooltip";

import InsertCoinSheet from "./InsertCoinSheet";

vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);

beforeAll(() => {
  vi.stubGlobal("React", React);
  // jsdom has no matchMedia; the tooltip primitive queries it for touch detection.
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

function renderSheet(props: Partial<React.ComponentProps<typeof InsertCoinSheet>> = {}) {
  return render(
    <TooltipProvider>
      <InsertCoinSheet
        open
        onClose={vi.fn()}
        entryLamports={20_000_000n}
        onConfirm={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("InsertCoinSheet", () => {
  it("shows the heading, the exact gold amount, and a tap-to-open info affordance", () => {
    renderSheet();

    expect(screen.getByText("Insert coin")).toBeInTheDocument();
    expect(screen.getByText("0.02")).toBeInTheDocument();
    expect(screen.getByText("SOL")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /how it works/i }),
    ).toBeInTheDocument();
    // The rules copy stays hidden until the info affordance is tapped.
    expect(screen.queryByText(/funds tomorrow/i)).not.toBeInTheDocument();
  });

  it("reveals the rules only after tapping the info affordance", () => {
    renderSheet();

    fireEvent.click(screen.getByRole("button", { name: /how it works/i }));
    expect(screen.getByText(/funds tomorrow/i)).toBeInTheDocument();
  });

  it("proceeds via the Sign & enter button", () => {
    const onConfirm = vi.fn();
    renderSheet({ onConfirm });

    fireEvent.click(screen.getByRole("button", { name: "Sign & enter" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("disables the button and blocks dismissal while a signature is in flight", () => {
    const onClose = vi.fn();
    renderSheet({ busy: true, onClose });

    expect(screen.getByRole("button", { name: "Preparing signature…" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
