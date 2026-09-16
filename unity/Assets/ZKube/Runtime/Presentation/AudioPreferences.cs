using System;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // Master mute leaves both saved channel levels intact.
    public sealed class AudioPreferences
    {
        private readonly Action<string, float> write;
        public double MusicVolume { get; private set; } = AudioPolicy.DefaultMusicVolume;
        public double EffectsVolume { get; private set; } = AudioPolicy.DefaultEffectsVolume;
        public AudioPreferences(Func<string, float, float> read = null, Action<string, float> write = null)
        {
            this.write = write;
            MusicVolume = Clamp(read?.Invoke(AudioPolicy.MusicKey, (float)MusicVolume) ?? MusicVolume);
            EffectsVolume = Clamp(read?.Invoke(AudioPolicy.EffectsKey, (float)EffectsVolume) ?? EffectsVolume);
        }
        public void SetMusicVolume(double value)
        { MusicVolume = Clamp(value); write?.Invoke(AudioPolicy.MusicKey, (float)MusicVolume); }
        public void SetEffectsVolume(double value)
        { EffectsVolume = Clamp(value); write?.Invoke(AudioPolicy.EffectsKey, (float)EffectsVolume); }
        private static double Clamp(double value) => double.IsNaN(value) ? 0 : Math.Min(1, Math.Max(0, value));
    }
}
