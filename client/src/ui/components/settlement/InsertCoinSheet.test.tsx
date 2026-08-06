import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/ui/elements/tooltip";

import InsertCoinSheet from "./InsertCoinSheet";

const fixtures = vi.hoisted(() => ({ reduceMotion: false }));

vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => fixtures.reduceMotion,
}));
vi.mock("@/ui/elements/theme-provider/hooks", async () =>
  (await import("@/test/mocks/theme")).themeHooksMock(),
);
vi.mock("@/contexts/hooks", async () =>
  (await import("@/test/mocks/contexts")).musicPlayerMock(),
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
        zoneId={2}
        entryLamports={10_000_000n}
        onConfirm={vi.fn()}
        {...props}
      />
    </TooltipProvider>,
  );
}

describe("InsertCoinSheet", () => {
  it("shows the guardian, the exact amount with the SOL mark, and a tap-to-open info affordance", () => {
    renderSheet();

    expect(screen.getByText("0.010")).toBeInTheDocument();
    // The official Solana logomark replaces the "SOL" text suffix.
    expect(screen.getByRole("img", { name: "SOL" })).toBeInTheDocument();
    // Today's guardian hosts the entry — you feed it the coin.
    expect(screen.getByLabelText(/Feed Sobek/)).toBeInTheDocument();
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

  it("feeds the guardian, then proceeds to the owner signature", () => {
    vi.useFakeTimers();
    try {
      const onConfirm = vi.fn();
      renderSheet({ onConfirm });

      fireEvent.click(screen.getByRole("button", { name: "Sign & enter" }));
      // The feeding ceremony runs first — confirm is not immediate…
      expect(onConfirm).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: /Feeding Sobek/ }),
      ).toBeDisabled();
      // …and hands off once the guardian has swallowed the coin and spoken.
      act(() => {
        vi.advanceTimersByTime(2_000);
      });
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("confirms immediately under reduced motion — the ceremony never gates entry", () => {
    fixtures.reduceMotion = true;
    try {
      const onConfirm = vi.fn();
      renderSheet({ onConfirm });

      fireEvent.click(screen.getByRole("button", { name: "Sign & enter" }));
      expect(onConfirm).toHaveBeenCalledOnce();
    } finally {
      fixtures.reduceMotion = false;
    }
  });

  it("disables the button and blocks dismissal while a signature is in flight", () => {
    const onClose = vi.fn();
    renderSheet({ busy: true, onClose });

    expect(screen.getByRole("button", { name: "Preparing signature…" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
