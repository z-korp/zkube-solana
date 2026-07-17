import { create } from "zustand";
import type { GameLevelData } from "@/hooks/useGameLevel";

export type TabId =
  | "home"
  | "rewards"
  | "ranks"
  | "shop"
  | "profile"
  | "settings";
export type OverlayId = "play" | "boss" | "map" | "spectate";
export type PageId = TabId | OverlayId;
export type ShopOrigin = "ranks" | "home";
export type SettingsFocus = "wallet";

export const FULLSCREEN_PAGES: ReadonlySet<PageId> = new Set([
  "play",
  "boss",
  "map",
  "spectate",
]);

export interface SpectateTargetParams {
  player?: string;
  pda?: string;
  runId?: string;
}
const NAV_TRANSITION_LOCK_MS = 300;

export interface PendingLevelCompletion {
  level: number;
  levelMoves: number;
  prevTotalScore: number;
  totalScore: number;
  gameLevel: GameLevelData | null;
  xpAwarded: number;
  isIncomplete?: boolean;
}

interface NavigationState {
  currentPage: PageId;
  previousPage: PageId | null;
  isTransitioning: boolean;
  transitionDirection: "forward" | "back" | null;
  gameId: bigint | null;
  recoveryRunId: bigint | null;
  mapZoneId: number;
  pendingLevelCompletion: PendingLevelCompletion | null;
  greetedZones: Set<number>;
  shopOrigin: ShopOrigin | null;
  settingsFocus: SettingsFocus | null;
  settingsReturnPage: PageId | null;
  navigate: (page: PageId, gameId?: bigint) => void;
  openShop: (origin?: ShopOrigin | null) => void;
  openWalletSettings: (returnPage?: PageId | null) => void;
  clearSettingsFocus: () => void;
  goBack: () => void;
  setGameId: (id: bigint | null) => void;
  setRecoveryRunId: (id: bigint | null) => void;
  setMapZoneId: (zoneId: number) => void;
  setPendingLevelCompletion: (data: PendingLevelCompletion | null) => void;
  markZoneGreeted: (zoneId: number) => void;
  spectateTarget: SpectateTargetParams | null;
  setSpectateTarget: (target: SpectateTargetParams | null) => void;
}

const getBackTarget = (page: PageId): PageId => {
  switch (page) {
    case "play":
      return "map";
    case "spectate":
      return "ranks";
    case "boss":
      return "map";
    case "map":
      return "home";
    case "settings":
      return "profile";
    case "shop":
      return "home";
    default:
      return "home";
  }
};

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentPage: "home",
  previousPage: null,
  isTransitioning: false,
  transitionDirection: null,
  gameId: null,
  recoveryRunId: null,
  mapZoneId: 1,
  pendingLevelCompletion: null,
  greetedZones: new Set(),
  shopOrigin: null,
  settingsFocus: null,
  settingsReturnPage: null,

  navigate: (page, gameId) => {
    const { currentPage, isTransitioning } = get();
    if (isTransitioning || page === currentPage) return;

    set({
      previousPage: currentPage,
      currentPage: page,
      transitionDirection: "forward",
      isTransitioning: true,
      ...(gameId !== undefined ? { gameId } : {}),
      ...(page !== "play" ? { recoveryRunId: null } : {}),
      ...(page !== "settings"
        ? { settingsFocus: null, settingsReturnPage: null }
        : {}),
      ...(page !== "shop" && !(currentPage === "shop" && page === "settings")
        ? { shopOrigin: null }
        : {}),
    });

    setTimeout(() => {
      set({ isTransitioning: false, transitionDirection: null });
    }, NAV_TRANSITION_LOCK_MS);
  },

  openShop: (origin = null) => {
    set({ shopOrigin: origin });
    get().navigate("shop");
  },

  openWalletSettings: (returnPage = "shop") => {
    set({ settingsFocus: "wallet", settingsReturnPage: returnPage });
    get().navigate("settings");
  },

  clearSettingsFocus: () => set({ settingsFocus: null }),

  goBack: () => {
    const {
      currentPage,
      isTransitioning,
      settingsReturnPage,
      shopOrigin,
    } = get();
    if (isTransitioning) return;

    const target =
      currentPage === "settings" && settingsReturnPage
        ? settingsReturnPage
        : currentPage === "shop" && shopOrigin
          ? shopOrigin
          : getBackTarget(currentPage);
    set({
      previousPage: currentPage,
      currentPage: target,
      transitionDirection: "back",
      isTransitioning: true,
      recoveryRunId: null,
      ...(currentPage === "settings"
        ? { settingsFocus: null, settingsReturnPage: null }
        : {}),
      ...(currentPage === "shop" ? { shopOrigin: null } : {}),
    });

    setTimeout(() => {
      set({ isTransitioning: false, transitionDirection: null });
    }, NAV_TRANSITION_LOCK_MS);
  },

  setGameId: (id) => set({ gameId: id }),
  setRecoveryRunId: (id) => set({ recoveryRunId: id }),
  setMapZoneId: (zoneId) => set({ mapZoneId: zoneId }),
  spectateTarget: null,
  setSpectateTarget: (target) => set({ spectateTarget: target }),
  setPendingLevelCompletion: (data) => set({ pendingLevelCompletion: data }),
  markZoneGreeted: (zoneId) =>
    set((state) => {
      const next = new Set(state.greetedZones);
      next.add(zoneId);
      return { greetedZones: next };
    }),
}));
