using System;
using UnityEngine;

namespace ZKube.Presentation
{
    public static class AppPreferences
    {
        public static bool ReducedMotion => PlayerPrefs.GetInt("zkube.motion.reduced", 0) == 1;
        public static bool Muted => PlayerPrefs.GetInt("zkube.sound.muted", 0) == 1;
        public static bool Haptics => PlayerPrefs.GetInt("zkube.haptics.enabled", 0) == 1;
        public static float TextScale => PlayerPrefs.GetInt("zkube.text.larger", 0) == 1 ? 1.3f : 1;
        public static AudioPreferences Audio() => new AudioPreferences(
            PlayerPrefs.GetFloat, (key, value) => { PlayerPrefs.SetFloat(key, value); PlayerPrefs.Save(); });
        private static void Save(string key, bool value) { PlayerPrefs.SetInt(key, value ? 1 : 0); PlayerPrefs.Save(); }
        public static void SetReducedMotion(bool value) => Save("zkube.motion.reduced", value);
        public static void SetMuted(bool value) => Save("zkube.sound.muted", value);
        public static void SetHaptics(bool value) => Save("zkube.haptics.enabled", value);
        public static void SetTextScale(float value) => Save("zkube.text.larger", BoardController.SupportedTextScale(value) > 1);

        public static SettingsPageView Read(Action refresh, BoardController board = null)
        {
            var audio = board == null ? Audio() : null;
            var motion = board == null ? ReducedMotion : board.ReducedMotion;
            var haptics = board == null ? Haptics : board.Haptics;
            var scale = board == null ? TextScale : board.TextScale;
            Action<bool> mute = board == null ? SetMuted : board.SetMuted;
            Action<bool> setMotion = board == null ? SetReducedMotion : board.SetReducedMotion;
            Action<bool> setHaptics = board == null ? SetHaptics : board.SetHaptics;
            Action<float> setScale = board == null ? SetTextScale : board.SetTextScale;
            return new SettingsPageView {
                Music = board == null ? audio.MusicVolume : board.MusicVolume,
                Effects = board == null ? audio.EffectsVolume : board.EffectsVolume,
                Muted = board == null ? Muted : board.Muted, ReducedMotion = motion, Haptics = haptics, LargeText = scale > 1,
                SetMusic = board == null ? audio.SetMusicVolume : board.SetMusicVolume,
                SetEffects = board == null ? audio.SetEffectsVolume : board.SetEffectsVolume,
                Unmute = () => { mute(false); refresh(); },
                ToggleMotion = () => { setMotion(!motion); refresh(); },
                ToggleHaptics = () => { setHaptics(!haptics); refresh(); },
                ToggleText = () => { setScale(scale > 1 ? 1 : 1.3f); refresh(); } };
        }
    }
}
