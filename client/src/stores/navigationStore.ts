import { create } from "zustand";
import type { GameLevelData } from "@/hooks/useGameLevel";

type TabId = "arcade" | "profile";
type OverlayId = "play" | "map" | "spectate";
export type PageId = TabId | OverlayId;

export const FULLSCREEN_PAGES: ReadonlySet<PageId> = new Set([
  "play",
  "map",
  "spectate",
]);

interface SpectateTargetParams {
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
  latchedStarSources: number;
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
  /** The Settings sheet is an overlay over any page, never a page itself. */
  settingsOpen: boolean;
  navigate: (page: PageId, gameId?: bigint) => void;
  openSettings: () => void;
  closeSettings: () => void;
  goBack: () => void;
  setRecoveryRunId: (id: bigint | null) => void;
  setMapZoneId: (zoneId: number) => void;
  setPendingLevelCompletion: (data: PendingLevelCompletion | null) => void;
  markZoneGreeted: (zoneId: number) => void;
  spectateTarget: SpectateTargetParams | null;
}

export const BACK_TARGETS: Readonly<Record<PageId, PageId>> = {
  arcade: "arcade",
  map: "arcade",
  play: "map",
  profile: "arcade",
  spectate: "arcade",
};

export const useNavigationStore = create<NavigationState>((set, get) => ({
  currentPage: "arcade",
  previousPage: null,
  isTransitioning: false,
  transitionDirection: null,
  gameId: null,
  recoveryRunId: null,
  mapZoneId: 1,
  pendingLevelCompletion: null,
  greetedZones: new Set(),
  settingsOpen: false,

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
    });

    setTimeout(() => {
      set({ isTransitioning: false, transitionDirection: null });
    }, NAV_TRANSITION_LOCK_MS);
  },

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),

  goBack: () => {
    const { currentPage, isTransitioning } = get();
    if (isTransitioning) return;

    set({
      previousPage: currentPage,
      currentPage: BACK_TARGETS[currentPage],
      transitionDirection: "back",
      isTransitioning: true,
      recoveryRunId: null,
    });

    setTimeout(() => {
      set({ isTransitioning: false, transitionDirection: null });
    }, NAV_TRANSITION_LOCK_MS);
  },

  setRecoveryRunId: (id) => set({ recoveryRunId: id }),
  setMapZoneId: (zoneId) => set({ mapZoneId: zoneId }),
  spectateTarget: null,
  setPendingLevelCompletion: (data) => set({ pendingLevelCompletion: data }),
  markZoneGreeted: (zoneId) =>
    set((state) => {
      const next = new Set(state.greetedZones);
      next.add(zoneId);
      return { greetedZones: next };
    }),
}));
