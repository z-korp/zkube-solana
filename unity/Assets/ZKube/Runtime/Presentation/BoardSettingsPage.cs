using System;

namespace ZKube.Presentation
{
    public static class BoardSettingsPage
    {
        public static SettingsPageView Read(BoardController board, Action refresh) => new SettingsPageView {
            Music = board.MusicVolume, Effects = board.EffectsVolume, Muted = board.Muted,
            ReducedMotion = board.ReducedMotion, Haptics = board.Haptics, LargeText = board.TextScale > 1,
            SetMusic = board.SetMusicVolume, SetEffects = board.SetEffectsVolume,
            Unmute = () => { board.SetMuted(false); refresh(); },
            ToggleMotion = () => { board.SetReducedMotion(!board.ReducedMotion); refresh(); },
            ToggleHaptics = () => { board.SetHaptics(!board.Haptics); refresh(); },
            ToggleText = () => { board.SetTextScale(board.TextScale > 1 ? 1 : 1.3f); refresh(); }
        };
    }
}
