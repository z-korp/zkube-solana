import type { BackendLayer } from "@/backend/runtime";
import {
  LOCAL_BACKEND_SENTINEL,
  makeLocalBackendLive,
  type LocalOwnerControls,
} from "./LocalBackendLive";
import {
  PLAYTEST_BUILD_SENTINEL,
  playtestSeed,
  playtestToday,
  subscribePlaytestSettings,
} from "./playtest";

const OWNER_CONTROLS: LocalOwnerControls = {
  seed: playtestSeed,
  today: playtestToday,
  subscribe: subscribePlaytestSettings,
};

export const SELECTED_BACKEND_SENTINEL = LOCAL_BACKEND_SENTINEL;
export const SELECTED_BUILD_SENTINEL: string | undefined =
  PLAYTEST_BUILD_SENTINEL;

export function makeSelectedBackend(): BackendLayer {
  return makeLocalBackendLive({
    target: "playtest",
    ownerControls: OWNER_CONTROLS,
  });
}
