/**
 * Shared vi.mock factories for the app context hooks.
 *
 * Each factory accepts either a stable value (mutate its properties in the
 * test) or a getter (when the fixture field itself is reassigned between
 * renders), mirroring the two patterns the suites already use:
 *
 *   vi.mock("@/contexts/run", async () =>
 *     (await import("@/test/mocks/contexts")).runContextMock(() => fixtures.run));
 */
import { vi } from "vitest";

type ValueOrGetter<T> = T | (() => T);

function resolveValue<T>(value: ValueOrGetter<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

/** Mock module for "@/contexts/run". */
export function runContextMock<T>(run: ValueOrGetter<T>) {
  return { useRun: () => resolveValue(run) };
}

/** Mock module for "@/chain/connectedPlayerContext". */
export function connectedPlayerMock<T>(player: ValueOrGetter<T>) {
  return { useConnectedPlayer: () => resolveValue(player) };
}

/**
 * Mock module for "@/contexts/hooks" (music player). Every context function
 * is a spy on one stable object; pass the spies you assert on as overrides
 * so they stay reachable from the suite's hoisted fixtures.
 */
export function musicPlayerMock(overrides: Record<string, unknown> = {}) {
  const player = {
    musicVolume: 0.3,
    effectsVolume: 0.5,
    setMusicVolume: vi.fn(),
    setEffectsVolume: vi.fn(),
    setMusicMood: vi.fn(),
    warmMusic: vi.fn(),
    duck: vi.fn(),
    unduck: vi.fn(),
    isPlaying: false,
    playSfx: vi.fn(),
    playSwipe: vi.fn(),
    playExplode: vi.fn(),
    playTheme: vi.fn(),
    stopTheme: vi.fn(),
    ...overrides,
  };
  return { useMusicPlayer: () => player };
}
