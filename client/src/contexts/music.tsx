/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioManager } from "@/audio/AudioManager";
import {
  type MusicContext,
  type SfxName,
  type ThemeId,
  loadAudioSettings,
} from "@/config/themes";
import { useTheme } from "@/ui/elements/theme-provider/hooks";
import noop from "@/utils/noop";

/**
 * Music is mood-driven: pages declare a mood, and the engine only transitions
 * (with crossfades) when the mood or theme actually changes — navigating
 * between same-mood pages never touches the track.
 */
export type MusicMood = "menu" | "level" | "boss";

/** The menu mood rotates the theme's main and level tracks. */
const MENU_PLAYLIST: MusicContext[] = ["main", "level"];

export interface MusicPlayerContextValue {
  musicVolume: number;
  effectsVolume: number;
  setMusicVolume: (volume: number) => void;
  setEffectsVolume: (volume: number) => void;
  setMusicMood: (mood: MusicMood) => void;
  warmMusic: (contexts: MusicContext[]) => void;
  duck: () => void;
  unduck: () => void;
  isPlaying: boolean;
  playSfx: (name: SfxName) => void;
  playSwipe: () => void;
  playExplode: () => void;
  playTheme: () => void;
  stopTheme: () => void;
}

const DEFAULT_MUSIC_CONTEXT: MusicContext = "main";

export const MusicPlayerContext = createContext<MusicPlayerContextValue>({
  musicVolume: 0.3,
  effectsVolume: 0.5,
  setMusicVolume: noop,
  setEffectsVolume: noop,
  setMusicMood: noop,
  warmMusic: noop,
  duck: noop,
  unduck: noop,
  isPlaying: false,
  playSfx: noop,
  playSwipe: noop,
  playExplode: noop,
  playTheme: noop,
  stopTheme: noop,
});

const clampVolume = (volume: number): number => Math.min(Math.max(volume, 0), 1);

export function MusicPlayerProvider({ children }: { children: React.ReactNode }) {
  const { themeTemplate } = useTheme();
  const themeId = themeTemplate as ThemeId;
  const [musicVolume, setMusicVolumeState] = useState<number>(audioManager.musicVolume);
  const [effectsVolume, setEffectsVolumeState] = useState<number>(audioManager.effectsVolume);
  const [currentContext, setCurrentContextState] = useState<MusicContext>(DEFAULT_MUSIC_CONTEXT);
  const [playlistContexts, setPlaylistContextsState] = useState<MusicContext[]>([]);
  const [isPlaying, setIsPlaying] = useState<boolean>(audioManager.isPlaying);
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    const settings = loadAudioSettings();
    audioManager.setMusicVolume(settings.musicVolume);
    audioManager.setEffectsVolume(settings.effectsVolume);
    setMusicVolumeState(settings.musicVolume);
    setEffectsVolumeState(settings.effectsVolume);
  }, []);

  // Web Audio autoplay policy: browsers block Howl.play() until a user gesture.
  // Re-trigger playMusic on first interaction so the track actually starts,
  // then warm the active theme so the first mood change crossfades instantly.
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;

      if (playlistContexts.length > 0) {
        audioManager.playMusicPlaylist(themeId, playlistContexts);
      } else {
        audioManager.playMusic(themeId, currentContext);
      }
      audioManager.warm(themeId, ["main", "level"]);
      setIsPlaying(audioManager.isPlaying);

      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };

    document.addEventListener("click", unlock, true);
    document.addEventListener("touchstart", unlock, true);
    document.addEventListener("keydown", unlock, true);

    return () => {
      document.removeEventListener("click", unlock, true);
      document.removeEventListener("touchstart", unlock, true);
      document.removeEventListener("keydown", unlock, true);
    };
  }, [themeId, currentContext, playlistContexts]);

  // Theme/mood reconcile — the engine crossfades every actual change and
  // no-ops identical targets, so this is safe to re-run.
  useEffect(() => {
    if (audioManager.isPlaying) {
      if (playlistContexts.length > 0) {
        audioManager.playMusicPlaylist(themeId, playlistContexts);
      } else {
        audioManager.playMusic(themeId, currentContext);
      }
      audioManager.warm(themeId, ["main", "level"]);
      setIsPlaying(audioManager.isPlaying);
    }
  }, [themeId, currentContext, playlistContexts]);

  // Backgrounding the PWA silences music; returning resumes mid-track.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        audioManager.pauseAll();
      } else {
        audioManager.resumeAll();
      }
      setIsPlaying(audioManager.isPlaying);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () =>
      document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    return () => {
      audioManager.stopMusic(false);
      audioManager.dispose();
    };
  }, []);

  const setMusicVolume = useCallback((volume: number) => {
    const nextVolume = clampVolume(volume);
    audioManager.setMusicVolume(nextVolume);
    setMusicVolumeState(nextVolume);
  }, []);

  const setEffectsVolume = useCallback((volume: number) => {
    const nextVolume = clampVolume(volume);
    audioManager.setEffectsVolume(nextVolume);
    setEffectsVolumeState(nextVolume);
  }, []);

  const setMusicContext = useCallback(
    (context: MusicContext) => {
      setPlaylistContextsState([]);
      setCurrentContextState(context);
      audioManager.playMusic(themeId, context);
      setIsPlaying(audioManager.isPlaying);
    },
    [themeId],
  );

  const setMusicPlaylist = useCallback(
    (contexts: MusicContext[]) => {
      setPlaylistContextsState(contexts);
      setCurrentContextState(contexts[0] ?? DEFAULT_MUSIC_CONTEXT);
      audioManager.playMusicPlaylist(themeId, contexts);
      setIsPlaying(audioManager.isPlaying);
    },
    [themeId],
  );

  const setMusicMood = useCallback(
    (mood: MusicMood) => {
      if (mood === "menu") {
        setMusicPlaylist(MENU_PLAYLIST);
      } else {
        setMusicContext(mood);
      }
    },
    [setMusicContext, setMusicPlaylist],
  );

  const warmMusic = useCallback(
    (contexts: MusicContext[]) => {
      audioManager.warm(themeId, contexts);
    },
    [themeId],
  );

  const duck = useCallback(() => {
    audioManager.duck();
  }, []);

  const unduck = useCallback(() => {
    audioManager.unduck();
  }, []);

  // Mute toggle: pause in place / resume mid-track (never restart from 0).
  const playTheme = useCallback(() => {
    audioManager.unmuteMusic();
    if (!audioManager.isPlaying) {
      audioManager.playMusic(themeId, currentContext);
    }
    setIsPlaying(audioManager.isPlaying);
  }, [themeId, currentContext]);

  const stopTheme = useCallback(() => {
    audioManager.muteMusic();
    setIsPlaying(audioManager.isPlaying);
  }, []);

  const playSfx = useCallback((name: SfxName) => {
    audioManager.playSfx(name);
  }, []);

  const playSwipe = useCallback(() => {
    audioManager.playSfx("swipe");
  }, []);

  const playExplode = useCallback(() => {
    audioManager.playSfx("explode");
  }, []);

  const value = useMemo<MusicPlayerContextValue>(
    () => ({
      musicVolume,
      effectsVolume,
      setMusicVolume,
      setEffectsVolume,
      setMusicMood,
      warmMusic,
      duck,
      unduck,
      isPlaying,
      playSfx,
      playSwipe,
      playExplode,
      playTheme,
      stopTheme,
    }),
    [
      musicVolume,
      effectsVolume,
      setMusicVolume,
      setEffectsVolume,
      setMusicMood,
      warmMusic,
      duck,
      unduck,
      isPlaying,
      playSfx,
      playSwipe,
      playExplode,
      playTheme,
      stopTheme,
    ],
  );

  return <MusicPlayerContext.Provider value={value}>{children}</MusicPlayerContext.Provider>;
}
