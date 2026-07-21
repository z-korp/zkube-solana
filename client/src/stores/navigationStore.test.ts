// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationStore } from "./navigationStore";

describe("navigation recovery intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNavigationStore.setState({
      currentPage: "arcade",
      previousPage: null,
      isTransitioning: false,
      transitionDirection: null,
      recoveryRunId: null,
      settingsFocus: null,
      settingsReturnPage: null,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("clears a recovery run ID when navigating away from play", () => {
    useNavigationStore.setState({
      currentPage: "play",
      recoveryRunId: 7n,
    });

    useNavigationStore.getState().navigate("settings");

    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "settings",
      recoveryRunId: null,
    });
  });

  it("clears a recovery run ID when backing out of play", () => {
    useNavigationStore.setState({
      currentPage: "play",
      recoveryRunId: 7n,
    });

    useNavigationStore.getState().goBack();

    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "map",
      recoveryRunId: null,
    });
  });

  it("returns to the originating tab after wallet settings", () => {
    useNavigationStore.getState().openWalletSettings("campaign");
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "settings",
      settingsFocus: "wallet",
      settingsReturnPage: "campaign",
    });
    vi.advanceTimersByTime(300);

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "campaign",
      settingsFocus: null,
      settingsReturnPage: null,
    });
  });

  it("returns from settings to profile when no return page is set", () => {
    useNavigationStore.setState({ currentPage: "settings" });

    useNavigationStore.getState().goBack();

    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "profile",
    });
  });
});
