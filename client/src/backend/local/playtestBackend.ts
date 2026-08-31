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
  readPlaytestName,
  storePlaytestName,
  subscribePlaytestSettings,
} from "./playtest";

const OWNER_CONTROLS: LocalOwnerControls = {
  seed: playtestSeed,
  today: playtestToday,
  readName: readPlaytestName,
  storeName: storePlaytestName,
  subscribe: subscribePlaytestSettings,
};

export const SELECTED_BACKEND_SENTINEL = LOCAL_BACKEND_SENTINEL;
export const SELECTED_BUILD_SENTINEL: string | undefined =
  PLAYTEST_BUILD_SENTINEL;

export function makeSelectedBackend(): BackendLayer {
  return makeLocalBackendLive({ ownerControls: OWNER_CONTROLS });
}
