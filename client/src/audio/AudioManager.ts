import { Howl, Howler } from "howler";
import {
  type ThemeId,
  type MusicContext,
  type SfxName,
  THEME_MUSIC,
  SFX_PATHS,
  loadAudioSettings,
  saveAudioSettings,
} from "@/config/themes";

/** Mood-change crossfade (menu ↔ level ↔ boss, theme switches). */
export const CROSSFADE_MS = 1200;
/** Overlap between consecutive playlist tracks. */
export const PLAYLIST_CROSSFADE_MS = 1000;
export const MUTE_FADE_MS = 300;
export const DUCK_FADE_MS = 200;
/** Music level while a sting/presentation owns the foreground. */
export const DUCK_LEVEL = 0.35;
const VOLUME_RAMP_MS = 150;
/** Same-SFX retriggers inside this window are dropped (anti double-fire). */
export const SFX_THROTTLE_MS = 60;

const clampVolume = (volume: number): number => {
  if (Number.isNaN(volume)) {
    return 0;
  }
  return Math.min(Math.max(volume, 0), 1);
};

/**
 * Music engine built around one primitive: crossfading transitions. Track
 * swaps never hard-stop — the incoming howl fades up from silence once it is
 * actually audible (large MP3s may still be fetching), and only then does the
 * outgoing howl fade away. A monotonically increasing transition token
 * cancels every pending completion when a newer transition supersedes it, so
 * rapid navigation can never leave two tracks playing.
 */
export class AudioManager {
  private musicHowls = new Map<string, Howl>();

  private sfxHowls = new Map<SfxName, Howl>();

  private sfxLastPlayed = new Map<SfxName, number>();

  private currentMusicHowl: Howl | null = null;

  private currentMusicUrl: string | null = null;

  /** Howls with a queued play() that has not fired its "play" event yet. */
  private pendingPlay = new Set<Howl>();

  private transitionToken = 0;

  private outgoingStopTimeoutId: number | null = null;

  private rolloverTimeoutId: number | null = null;

  private muteTimeoutId: number | null = null;

  private pausedByManager = false;

  private userMuted = false;

  private duckCount = 0;

  private playlist: string[] = [];

  private playlistIdx = 0;

  private playlistThemeId: ThemeId | null = null;

  public musicVolume: number;

  public effectsVolume: number;

  public currentThemeId: ThemeId | null = null;

  public currentContext: MusicContext | null = null;

  public isPlaying = false;

  constructor() {
    const settings = loadAudioSettings();
    this.musicVolume = clampVolume(settings.musicVolume);
    this.effectsVolume = clampVolume(settings.effectsVolume);
  }

  public playMusic(themeId: ThemeId, context: MusicContext): void {
    const nextUrl = THEME_MUSIC[themeId][context];

    // Same looped track already the target: never restart it.
    if (
      this.currentMusicUrl === nextUrl &&
      this.playlist.length === 0 &&
      this.isPlaying
    ) {
      this.currentThemeId = themeId;
      this.currentContext = context;
      return;
    }

    this.clearPlaylist();
    this.currentThemeId = themeId;
    this.currentContext = context;
    this.crossfadeTo(nextUrl, true, CROSSFADE_MS);
  }

  public playMusicPlaylist(themeId: ThemeId, contexts: MusicContext[]): void {
    if (contexts.length === 0) return;

    const urls = contexts.map((ctx) => THEME_MUSIC[themeId][ctx]);

    // Same theme + same playlist already playing: continuity, no restart.
    if (
      this.playlistThemeId === themeId &&
      this.playlist.length === urls.length &&
      this.playlist.every((url, index) => url === urls[index]) &&
      this.isPlaying
    ) {
      return;
    }

    this.clearPlaylist();
    this.playlist = urls;
    this.playlistIdx = 0;
    this.playlistThemeId = themeId;
    this.currentThemeId = themeId;
    this.currentContext = contexts[0];
    this.crossfadeTo(urls[0], false, CROSSFADE_MS);
  }

  public stopMusic(withFade = true): void {
    this.transitionToken++;
    this.clearPlaylist();
    this.clearTimers();

    const howl = this.currentMusicHowl;
    this.isPlaying = false;
    if (!howl) return;

    if (withFade && howl.playing()) {
      howl.fade(currentVolumeOf(howl), 0, MUTE_FADE_MS);
      this.outgoingStopTimeoutId = window.setTimeout(() => {
        this.stopHowl(howl);
      }, MUTE_FADE_MS);
      return;
    }
    this.stopHowl(howl);
  }

  /** Fade out and pause in place; unmute resumes from the same position. */
  public muteMusic(): void {
    if (this.userMuted) return;
    this.userMuted = true;
    this.clearTimers();

    const howl = this.currentMusicHowl;
    this.isPlaying = false;
    if (!howl || !howl.playing()) return;

    howl.fade(currentVolumeOf(howl), 0, MUTE_FADE_MS);
    this.muteTimeoutId = window.setTimeout(() => {
      if (this.userMuted) howl.pause();
    }, MUTE_FADE_MS);
  }

  public unmuteMusic(): void {
    if (!this.userMuted) return;
    this.userMuted = false;
    this.clearTimers();

    const howl = this.currentMusicHowl;
    if (!howl) return;

    howl.volume(0);
    if (!howl.playing()) howl.play();
    howl.fade(0, this.targetVolume(), MUTE_FADE_MS);
    this.isPlaying = true;
    if (this.playlist.length > 0) {
      this.scheduleRollover(howl, this.transitionToken);
    }
  }

  /**
   * Lower music under a foreground moment (sting, outcome show). Nested:
   * every duck() needs a matching unduck().
   */
  public duck(): void {
    this.duckCount++;
    this.applyDuckLevel();
  }

  public unduck(): void {
    this.duckCount = Math.max(0, this.duckCount - 1);
    this.applyDuckLevel();
  }

  public setMusicVolume(volume: number): void {
    this.musicVolume = clampVolume(volume);

    const howl = this.currentMusicHowl;
    if (howl && howl.playing() && !this.userMuted) {
      howl.fade(currentVolumeOf(howl), this.targetVolume(), VOLUME_RAMP_MS);
    }

    saveAudioSettings({
      musicVolume: this.musicVolume,
      effectsVolume: this.effectsVolume,
    });
  }

  public setEffectsVolume(volume: number): void {
    this.effectsVolume = clampVolume(volume);

    this.sfxHowls.forEach((howl) => {
      howl.volume(this.effectsVolume);
    });

    saveAudioSettings({
      musicVolume: this.musicVolume,
      effectsVolume: this.effectsVolume,
    });
  }

  public playSfx(name: SfxName): void {
    const now = Date.now();
    const last = this.sfxLastPlayed.get(name) ?? 0;
    if (now - last < SFX_THROTTLE_MS && now >= last) return;
    this.sfxLastPlayed.set(name, now);

    const howl = this.getOrCreateSfx(name);
    howl.play();
  }

  /** Pre-fetch tracks so a coming transition starts without a network stall. */
  public warm(themeId: ThemeId, contexts: MusicContext[]): void {
    for (const context of contexts) {
      this.getOrCreateMusicHowl(THEME_MUSIC[themeId][context]);
    }
  }

  public pauseAll(): void {
    if (!this.currentMusicHowl || !this.currentMusicHowl.playing()) {
      return;
    }
    this.clearRollover();
    this.currentMusicHowl.pause();
    this.pausedByManager = true;
    this.isPlaying = false;
  }

  public resumeAll(): void {
    if (!this.currentMusicHowl || !this.pausedByManager || this.userMuted) {
      return;
    }
    this.currentMusicHowl.play();
    this.pausedByManager = false;
    this.isPlaying = true;
    if (this.playlist.length > 0) {
      this.scheduleRollover(this.currentMusicHowl, this.transitionToken);
    }
  }

  public dispose(): void {
    this.transitionToken++;
    this.clearPlaylist();
    this.clearTimers();
    this.musicHowls.forEach((howl) => {
      howl.unload();
    });
    this.sfxHowls.forEach((howl) => {
      howl.unload();
    });
    this.musicHowls.clear();
    this.sfxHowls.clear();
    this.currentMusicHowl = null;
    this.currentMusicUrl = null;
    this.currentThemeId = null;
    this.currentContext = null;
    this.isPlaying = false;
    this.pausedByManager = false;
    this.userMuted = false;
    this.duckCount = 0;
    Howler.stop();
  }

  /**
   * The transition primitive. Outgoing audio keeps playing until the
   * incoming track is actually audible, then both ramp over `fadeMs`.
   */
  private crossfadeTo(url: string, loop: boolean, fadeMs: number): void {
    const token = ++this.transitionToken;
    this.clearTimers();

    const outgoing = this.currentMusicHowl;
    const incoming = this.getOrCreateMusicHowl(url);
    this.currentMusicHowl = incoming;
    this.currentMusicUrl = url;
    this.pausedByManager = false;

    incoming.loop(loop);

    if (this.userMuted) {
      // Track the desired target silently; unmute plays it from here.
      if (outgoing && outgoing !== incoming) this.stopHowl(outgoing);
      if (incoming.playing()) incoming.pause();
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;

    const startFades = () => {
      this.pendingPlay.delete(incoming);
      if (token !== this.transitionToken) {
        // A newer transition superseded this one while the track was still
        // loading; if it isn't the current target anymore, silence it.
        if (this.currentMusicHowl !== incoming) this.stopHowl(incoming);
        return;
      }
      incoming.fade(currentVolumeOf(incoming), this.targetVolume(), fadeMs);
      if (outgoing && outgoing !== incoming && outgoing.playing()) {
        outgoing.fade(currentVolumeOf(outgoing), 0, fadeMs);
        this.outgoingStopTimeoutId = window.setTimeout(() => {
          // Never stop a howl that a later transition re-adopted.
          if (this.currentMusicHowl !== outgoing) this.stopHowl(outgoing);
        }, fadeMs);
      }
      if (!loop && this.playlist.length > 0) {
        this.scheduleRollover(incoming, token);
      }
    };

    if (incoming.playing()) {
      // Returning to a track that is still fading out: ramp it back up.
      startFades();
      return;
    }

    incoming.volume(0);
    // Only the newest transition may own the play handler for this howl.
    incoming.off("play");
    incoming.once("play", startFades);
    if (!this.pendingPlay.has(incoming)) {
      this.pendingPlay.add(incoming);
      incoming.play();
    }
  }

  /** Overlap the next playlist entry shortly before this one ends. */
  private scheduleRollover(howl: Howl, token: number): void {
    this.clearRollover();
    const durationSec = howl.duration();
    if (!durationSec || this.playlist.length === 0) return;

    const seek = howl.seek();
    const position = typeof seek === "number" ? seek : 0;
    const remainingMs = Math.max(
      1_000,
      (durationSec - position) * 1_000 - PLAYLIST_CROSSFADE_MS,
    );

    this.rolloverTimeoutId = window.setTimeout(() => {
      this.rolloverTimeoutId = null;
      if (token !== this.transitionToken || this.playlist.length === 0) return;
      this.playlistIdx = (this.playlistIdx + 1) % this.playlist.length;
      this.crossfadeTo(
        this.playlist[this.playlistIdx],
        false,
        PLAYLIST_CROSSFADE_MS,
      );
    }, remainingMs);
  }

  private targetVolume(): number {
    return this.musicVolume * (this.duckCount > 0 ? DUCK_LEVEL : 1);
  }

  private applyDuckLevel(): void {
    const howl = this.currentMusicHowl;
    if (!howl || !howl.playing() || this.userMuted) return;
    howl.fade(currentVolumeOf(howl), this.targetVolume(), DUCK_FADE_MS);
  }

  /** stop() cancels queued plays without firing "play" — clear our marker. */
  private stopHowl(howl: Howl): void {
    this.pendingPlay.delete(howl);
    howl.stop();
  }

  private clearPlaylist(): void {
    this.playlist = [];
    this.playlistIdx = 0;
    this.playlistThemeId = null;
    this.clearRollover();
  }

  private clearRollover(): void {
    if (this.rolloverTimeoutId !== null) {
      window.clearTimeout(this.rolloverTimeoutId);
      this.rolloverTimeoutId = null;
    }
  }

  private clearTimers(): void {
    this.clearRollover();
    if (this.outgoingStopTimeoutId !== null) {
      window.clearTimeout(this.outgoingStopTimeoutId);
      this.outgoingStopTimeoutId = null;
    }
    if (this.muteTimeoutId !== null) {
      window.clearTimeout(this.muteTimeoutId);
      this.muteTimeoutId = null;
    }
  }

  private getOrCreateMusicHowl(url: string): Howl {
    const existing = this.musicHowls.get(url);
    if (existing) {
      return existing;
    }

    const created = new Howl({
      src: [url],
      loop: true,
      volume: this.musicVolume,
    });

    this.musicHowls.set(url, created);
    return created;
  }

  private getOrCreateSfx(name: SfxName): Howl {
    const existing = this.sfxHowls.get(name);
    if (existing) {
      return existing;
    }

    const created = new Howl({
      src: [SFX_PATHS[name]],
      volume: this.effectsVolume,
      loop: false,
    });

    this.sfxHowls.set(name, created);
    return created;
  }
}

/** Howler's volume() can return the Howl in setter form; normalize reads. */
function currentVolumeOf(howl: Howl): number {
  const volume = howl.volume();
  return typeof volume === "number" ? volume : 0;
}

export const audioManager = new AudioManager();
