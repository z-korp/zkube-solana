import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNavigationStore } from "./navigationStore";

describe("navigation recovery intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNavigationStore.setState({
      currentPage: "home",
      previousPage: null,
      isTransitioning: false,
      transitionDirection: null,
      recoveryRunId: null,
      shopOrigin: null,
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

  it("preserves Daily origin through Vault funding and returns through Shop", () => {
    useNavigationStore.getState().openShop("daily");
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "shop",
      shopOrigin: "daily",
    });
    vi.advanceTimersByTime(300);

    useNavigationStore.getState().openVaultSettings("shop");
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "settings",
      settingsFocus: "vault",
      settingsReturnPage: "shop",
      shopOrigin: "daily",
    });
    vi.advanceTimersByTime(300);

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "shop",
      settingsFocus: null,
      settingsReturnPage: null,
      shopOrigin: "daily",
    });
    vi.advanceTimersByTime(300);

    useNavigationStore.getState().goBack();
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "daily",
      shopOrigin: null,
    });
  });
});
