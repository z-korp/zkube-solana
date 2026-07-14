import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import Sheet from "./Sheet";

beforeAll(() => {
  // vitest.config.ts does not load Vite's React JSX transform.
  vi.stubGlobal("React", React);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("Sheet", () => {
  it("renders title and content when open", () => {
    render(
      <Sheet open onClose={vi.fn()} title="Unlock Zone">
        <p>Sheet body</p>
      </Sheet>,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Unlock Zone")).toBeInTheDocument();
    expect(screen.getByText("Sheet body")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(
      <Sheet open={false} onClose={vi.fn()} title="Hidden">
        <p>Sheet body</p>
      </Sheet>,
    );

    expect(screen.queryByText("Sheet body")).not.toBeInTheDocument();
  });

  it("closes via the drag-handle button", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose}>
        <p>Sheet body</p>
      </Sheet>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose}>
        <p>Sheet body</p>
      </Sheet>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("blocks every dismissal path when dismissible is false", () => {
    const onClose = vi.fn();
    render(
      <Sheet open onClose={onClose} dismissible={false}>
        <p>Sheet body</p>
      </Sheet>,
    );

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Sheet body")).toBeInTheDocument();
  });
});
