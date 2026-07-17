import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCampaignLauncher } from "./useCampaignLauncher";

const fixtures = vi.hoisted(() => ({
  run: {} as Record<string, unknown>,
  navigate: vi.fn(),
  showToast: vi.fn(),
}));

vi.mock("@/contexts/run", () => ({
  useRun: () => fixtures.run,
}));
vi.mock("@/stores/navigationStore", () => ({
  useNavigationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ navigate: fixtures.navigate }),
}));
vi.mock("@/utils/toast", () => ({
  showToast: (options: unknown) => fixtures.showToast(options),
}));

const idleRun = (overrides: Record<string, unknown> = {}) => ({
  phase: "none",
  busy: false,
  watchStatus: { phase: "subscribed" },
  startCampaignRun: vi.fn().mockResolvedValue({ runId: 9n }),
  ...overrides,
});

describe("useCampaignLauncher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.run = idleRun();
  });

  it("starts the run in place and navigates once it is live", async () => {
    const { result } = renderHook(() => useCampaignLauncher());

    await act(async () => {
      await result.current.startLevel(1, 3);
    });

    expect(fixtures.run.startCampaignRun).toHaveBeenCalledWith(1, 3);
    expect(fixtures.navigate).toHaveBeenCalledWith("play", 9n);
    expect(result.current.starting).toBe(false);
  });

  it("collapses a double-tap into a single launch", async () => {
    let resolveLaunch: (value: { runId: bigint }) => void = () => {};
    fixtures.run = idleRun({
      startCampaignRun: vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveLaunch = resolve;
        }),
      ),
    });
    const { result } = renderHook(() => useCampaignLauncher());

    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.startLevel(1, 3);
      void result.current.startLevel(1, 3);
    });
    await waitFor(() => expect(result.current.starting).toBe(true));

    await act(async () => {
      resolveLaunch({ runId: 9n });
      await first;
    });
    expect(fixtures.run.startCampaignRun).toHaveBeenCalledOnce();
    expect(fixtures.navigate).toHaveBeenCalledOnce();
  });

  it("refuses to launch while another run is attached", async () => {
    fixtures.run = idleRun({ phase: "delegated" });
    const { result } = renderHook(() => useCampaignLauncher());

    await act(async () => {
      await result.current.startLevel(1, 3);
    });

    expect(fixtures.run.startCampaignRun).not.toHaveBeenCalled();
    expect(fixtures.navigate).not.toHaveBeenCalled();
    expect(fixtures.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error" }),
    );
  });

  it("asks for patience while the watcher is still resolving", async () => {
    fixtures.run = idleRun({ watchStatus: { phase: "resolving" } });
    const { result } = renderHook(() => useCampaignLauncher());

    await act(async () => {
      await result.current.startLevel(1, 3);
    });

    expect(fixtures.run.startCampaignRun).not.toHaveBeenCalled();
    expect(fixtures.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("try again"),
      }),
    );
  });

  it("does not launch before the initial durable-run check", async () => {
    fixtures.run = idleRun({ watchStatus: null });
    const { result } = renderHook(() => useCampaignLauncher());

    await act(async () => {
      await result.current.startLevel(1, 3);
    });

    expect(fixtures.run.startCampaignRun).not.toHaveBeenCalled();
    expect(fixtures.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("checking") }),
    );
  });

  it("surfaces launch failures as a toast and stays put", async () => {
    fixtures.run = idleRun({
      startCampaignRun: vi.fn().mockRejectedValue(new Error("vrf timeout")),
    });
    const { result } = renderHook(() => useCampaignLauncher());

    await act(async () => {
      await result.current.startLevel(1, 3);
    });

    expect(fixtures.navigate).not.toHaveBeenCalled();
    expect(fixtures.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ message: "vrf timeout", type: "error" }),
    );
    expect(result.current.starting).toBe(false);
  });

  it("lets a stale missing marker start fresh", async () => {
    fixtures.run = idleRun({ phase: "missing" });
    const { result } = renderHook(() => useCampaignLauncher());

    await act(async () => {
      await result.current.startLevel(2, 1);
    });

    expect(fixtures.run.startCampaignRun).toHaveBeenCalledWith(2, 1);
    expect(fixtures.navigate).toHaveBeenCalledWith("play", 9n);
  });
});
