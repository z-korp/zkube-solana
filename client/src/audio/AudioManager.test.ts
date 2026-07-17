import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AudioManager,
  CROSSFADE_MS,
  DUCK_LEVEL,
  MUTE_FADE_MS,
  PLAYLIST_CROSSFADE_MS,
  SFX_THROTTLE_MS,
} from "./AudioManager";
import { THEME_MUSIC } from "@/config/themes";

interface FadeCall {
  from: number;
  to: number;
  ms: number;
}

class FakeHowl {
  static instances: FakeHowl[] = [];

  src: string;
  fades: FadeCall[] = [];
  playCalls = 0;
  stopCalls = 0;
  pauseCalls = 0;
  private volumeValue: number;
  private loopValue: boolean;
  private playingValue = false;
  private durationValue = 120;
  private handlers = new Map<string, Array<() => void>>();

  constructor(options: { src: string[]; volume?: number; loop?: boolean }) {
    this.src = options.src[0];
    this.volumeValue = options.volume ?? 1;
    this.loopValue = options.loop ?? false;
    FakeHowl.instances.push(this);
  }

  volume(value?: number): number | this {
    if (value === undefined) return this.volumeValue;
    this.volumeValue = value;
    return this;
  }

  loop(value?: boolean): boolean | this {
    if (value === undefined) return this.loopValue;
    this.loopValue = value;
    return this;
  }

  playing(): boolean {
    return this.playingValue;
  }

  play(): number {
    this.playCalls++;
    return this.playCalls;
  }

  /** Test hook: the browser finished loading and playback really started. */
  firePlay(): void {
    this.playingValue = true;
    const pending = this.handlers.get("play") ?? [];
    this.handlers.set("play", []);
    for (const handler of pending) handler();
  }

  stop(): this {
    this.playingValue = false;
    this.stopCalls++;
    return this;
  }

  pause(): this {
    this.playingValue = false;
    this.pauseCalls++;
    return this;
  }

  fade(from: number, to: number, ms: number): this {
    this.fades.push({ from, to, ms });
    this.volumeValue = to;
    return this;
  }

  once(event: string, handler: () => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return this;
  }

  on(): this {
    return this;
  }

  off(event: string): this {
    this.handlers.set(event, []);
    return this;
  }

  seek(): number {
    return 0;
  }

  duration(): number {
    return this.durationValue;
  }

  state(): string {
    return "loaded";
  }

  unload(): void {}
}

vi.mock("howler", () => ({
  Howl: function MockedHowl(
    this: unknown,
    options: { src: string[]; volume?: number; loop?: boolean },
  ) {
    return new FakeHowl(options);
  },
  Howler: { stop: () => {} },
}));

const MAIN_URL = THEME_MUSIC["theme-1"].main;
const LEVEL_URL = THEME_MUSIC["theme-1"].level;

const howlFor = (url: string): FakeHowl => {
  const found = FakeHowl.instances.find((howl) => howl.src === url);
  if (!found) throw new Error(`no howl created for ${url}`);
  return found;
};

describe("AudioManager transitions", () => {
  let manager: AudioManager;
  let now: number;

  beforeEach(() => {
    vi.useFakeTimers();
    FakeHowl.instances = [];
    now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    manager = new AudioManager();
    manager.setMusicVolume(0.5);
    manager.setEffectsVolume(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fades the incoming track up only once it is audible, then fades and stops the outgoing", () => {
    manager.playMusic("theme-1", "main");
    const main = howlFor(MAIN_URL);
    expect(main.playCalls).toBe(1);
    expect(main.volume()).toBe(0);
    expect(main.fades).toHaveLength(0); // still loading — no ramp yet

    main.firePlay();
    expect(main.fades).toEqual([{ from: 0, to: 0.5, ms: CROSSFADE_MS }]);

    manager.playMusic("theme-1", "level");
    const level = howlFor(LEVEL_URL);
    expect(main.playing()).toBe(true); // outgoing untouched while loading

    level.firePlay();
    expect(level.fades.at(-1)).toEqual({ from: 0, to: 0.5, ms: CROSSFADE_MS });
    expect(main.fades.at(-1)).toEqual({
      from: 0.5,
      to: 0,
      ms: CROSSFADE_MS,
    });
    expect(main.stopCalls).toBe(0);

    vi.advanceTimersByTime(CROSSFADE_MS);
    expect(main.stopCalls).toBe(1);
    expect(level.playing()).toBe(true);
  });

  it("never restarts an identical looped target", () => {
    manager.playMusic("theme-1", "main");
    const main = howlFor(MAIN_URL);
    main.firePlay();

    manager.playMusic("theme-1", "main");
    expect(main.playCalls).toBe(1);
    expect(main.stopCalls).toBe(0);
  });

  it("silences a superseded track that finishes loading late", () => {
    manager.playMusic("theme-1", "main");
    const main = howlFor(MAIN_URL);

    // Player navigates on before the first track ever became audible.
    manager.playMusic("theme-1", "level");
    const level = howlFor(LEVEL_URL);

    main.firePlay(); // stale transition finally loads
    expect(main.stopCalls).toBe(1);

    level.firePlay();
    expect(level.fades.at(-1)).toEqual({ from: 0, to: 0.5, ms: CROSSFADE_MS });
    expect(level.playing()).toBe(true);
    expect(main.playing()).toBe(false);
  });

  it("mutes by pausing in place and resumes without a restart", () => {
    manager.playMusic("theme-1", "main");
    const main = howlFor(MAIN_URL);
    main.firePlay();

    manager.muteMusic();
    expect(main.fades.at(-1)).toEqual({ from: 0.5, to: 0, ms: MUTE_FADE_MS });
    vi.advanceTimersByTime(MUTE_FADE_MS);
    expect(main.pauseCalls).toBe(1);
    expect(main.stopCalls).toBe(0);
    expect(manager.isPlaying).toBe(false);

    manager.unmuteMusic();
    expect(main.playCalls).toBe(2); // resume, not a new track
    expect(main.stopCalls).toBe(0);
    expect(main.fades.at(-1)).toEqual({ from: 0, to: 0.5, ms: MUTE_FADE_MS });
    expect(manager.isPlaying).toBe(true);
  });

  it("nests ducks and applies the duck factor to volume changes", () => {
    manager.playMusic("theme-1", "main");
    const main = howlFor(MAIN_URL);
    main.firePlay();

    manager.duck();
    expect(main.fades.at(-1)?.to).toBeCloseTo(0.5 * DUCK_LEVEL);

    manager.duck();
    manager.unduck();
    expect(main.fades.at(-1)?.to).toBeCloseTo(0.5 * DUCK_LEVEL); // still ducked

    manager.setMusicVolume(0.8);
    expect(main.fades.at(-1)?.to).toBeCloseTo(0.8 * DUCK_LEVEL);

    manager.unduck();
    expect(main.fades.at(-1)?.to).toBeCloseTo(0.8);
  });

  it("overlaps playlist tracks shortly before each ends and cycles", () => {
    manager.playMusicPlaylist("theme-1", ["main", "level"]);
    const main = howlFor(MAIN_URL);
    main.firePlay(); // duration 120s → rollover at 120000 - PLAYLIST_CROSSFADE_MS

    vi.advanceTimersByTime(120_000 - PLAYLIST_CROSSFADE_MS);
    const level = howlFor(LEVEL_URL);
    expect(level.playCalls).toBe(1);

    level.firePlay();
    expect(level.fades.at(-1)).toEqual({
      from: 0,
      to: 0.5,
      ms: PLAYLIST_CROSSFADE_MS,
    });

    // Cycles back to the first track at the next boundary.
    vi.advanceTimersByTime(120_000 - PLAYLIST_CROSSFADE_MS);
    expect(main.playCalls).toBe(2);
  });

  it("keeps the same-playlist continuity guard", () => {
    manager.playMusicPlaylist("theme-1", ["main", "level"]);
    const main = howlFor(MAIN_URL);
    main.firePlay();

    manager.playMusicPlaylist("theme-1", ["main", "level"]);
    expect(main.playCalls).toBe(1);
    expect(main.stopCalls).toBe(0);
  });

  it("throttles same-SFX retriggers inside the window", () => {
    manager.playSfx("coin");
    const coin = FakeHowl.instances.at(-1)!;
    expect(coin.playCalls).toBe(1);

    now += SFX_THROTTLE_MS - 10;
    manager.playSfx("coin");
    expect(coin.playCalls).toBe(1);

    now += SFX_THROTTLE_MS;
    manager.playSfx("coin");
    expect(coin.playCalls).toBe(2);
  });
});
