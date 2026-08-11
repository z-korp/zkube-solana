import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useGuardianMood, type GuardianSignals } from "./useGuardianMood";

let container: HTMLDivElement;
let root: Root;
let seen: string[] = [];

function Probe(props: GuardianSignals) {
  const mood = useGuardianMood(props);
  seen.push(mood);
  return null;
}

function render(props: GuardianSignals) {
  act(() => {
    root.render(<Probe {...props} />);
  });
  return seen[seen.length - 1];
}

const base: GuardianSignals = {
  runId: 1,
  combo: 0,
  danger: false,
  perfectSignal: 0,
  ended: false,
};

beforeEach(() => {
  vi.useFakeTimers();
  seen = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useGuardianMood", () => {
  it("greets a new run, then settles", () => {
    expect(render(base)).toBe("greeting");
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(seen[seen.length - 1]).toBe("idle");
  });

  it("answers a chain of three and holds it", () => {
    render(base);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(render({ ...base, combo: 3 })).toBe("satisfied");
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(seen[seen.length - 1]).toBe("satisfied");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(seen[seen.length - 1]).toBe("idle");
  });

  it("puts danger above a chain, and defeat above everything", () => {
    render(base);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    // Both land in the same frame: priority decides, not recency.
    expect(render({ ...base, combo: 4, danger: true })).toBe("surprised");
    expect(render({ ...base, combo: 4, danger: true, ended: "lost" })).toBe(
      "defeated",
    );
  });

  it("celebrates a perfect clear over danger", () => {
    render(base);
    act(() => {
      vi.advanceTimersByTime(1_100);
    });
    expect(render({ ...base, danger: true, perfectSignal: 1 })).toBe(
      "celebrate",
    );
  });
});
