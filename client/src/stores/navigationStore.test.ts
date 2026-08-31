// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACK_TARGETS,
  FULLSCREEN_PAGES,
  useNavigationStore,
} from "./navigationStore";

describe("navigation recovery intent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNavigationStore.setState({
      currentPage: "arcade",
      previousPage: null,
      isTransitioning: false,
      transitionDirection: null,
      recoveryRunId: null,
      settingsOpen: false,
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

    useNavigationStore.getState().navigate("profile");

    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "profile",
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

  it("opens and closes the settings sheet without touching the page", () => {
    useNavigationStore.getState().openSettings();
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "arcade",
      settingsOpen: true,
    });

    useNavigationStore.getState().closeSettings();
    expect(useNavigationStore.getState()).toMatchObject({
      currentPage: "arcade",
      settingsOpen: false,
    });
  });

  it("navigation_has_three_tabs_and_only_play_surfaces_are_fullscreen", () => {
    expect(Object.keys(BACK_TARGETS).sort()).toEqual([
      "arcade",
      "map",
      "play",
      "profile",
      "spectate",
    ]);
    expect(BACK_TARGETS.map).toBe("map");
    expect([...FULLSCREEN_PAGES].sort()).toEqual(["play", "spectate"]);
  });
});
