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
            key => PlayerPrefs.GetString(key, ""), (key, value) => { PlayerPrefs.SetString(key, value); PlayerPrefs.Save(); });
        private static void Save(string key, bool value) { PlayerPrefs.SetInt(key, value ? 1 : 0); PlayerPrefs.Save(); }
        public static void SetReducedMotion(bool value) => Save("zkube.motion.reduced", value);
        public static void SetMuted(bool value) => Save("zkube.sound.muted", value);
        public static void SetHaptics(bool value) => Save("zkube.haptics.enabled", value);
        public static void SetTextScale(float value) => Save("zkube.text.larger", BoardController.SupportedTextScale(value) > 1);

        public static SettingsPageView Read(Action refresh)
        {
            var audio = Audio();
            return new SettingsPageView { Music = audio.MusicVolume, Effects = audio.EffectsVolume,
                Muted = Muted, ReducedMotion = ReducedMotion, Haptics = Haptics, LargeText = TextScale > 1,
                SetMusic = audio.SetMusicVolume, SetEffects = audio.SetEffectsVolume,
                Unmute = () => { SetMuted(false); refresh(); },
                ToggleMotion = () => { SetReducedMotion(!ReducedMotion); refresh(); },
                ToggleHaptics = () => { SetHaptics(!Haptics); refresh(); },
                ToggleText = () => { SetTextScale(TextScale > 1 ? 1 : 1.3f); refresh(); } };
        }
    }
}
