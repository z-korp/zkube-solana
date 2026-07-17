import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCurrentChallenge } from "./useCurrentChallenge";

const fixture = vi.hoisted(() => ({
  daily: null as null | { dayId: number },
  loading: false,
  refresh: vi.fn<() => Promise<null>>(),
}));

vi.mock("@/contexts/daily", () => ({
  useDaily: () => fixture,
}));

describe("useCurrentChallenge", () => {
  beforeEach(() => {
    fixture.daily = null;
    fixture.loading = false;
    fixture.refresh.mockReset().mockResolvedValue(null);
  });

  it("requests a missing Daily once and leaves loading after the null read", async () => {
    const { result, rerender } = renderHook(() => useCurrentChallenge());

    await waitFor(() => expect(fixture.refresh).toHaveBeenCalledTimes(1));
    expect(result.current.challenge).toBeNull();
    expect(result.current.isLoading).toBe(false);

    act(() => {
      fixture.loading = true;
      rerender();
      fixture.loading = false;
      rerender();
    });

    expect(fixture.refresh).toHaveBeenCalledTimes(1);
    expect(result.current.challenge).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
