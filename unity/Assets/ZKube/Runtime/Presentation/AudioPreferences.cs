using System;
using System.Globalization;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;

namespace ZKube.Presentation
{
    // The board's independent master mute never overwrites these preferences.
    public sealed class AudioPreferences
    {
        private readonly Action<string, string> write;
        public double MusicVolume { get; private set; } = AudioPolicy.DefaultMusicVolume;
        public double EffectsVolume { get; private set; } = AudioPolicy.DefaultEffectsVolume;
        public AudioPreferences(Func<string, string> read = null, Action<string, string> write = null)
        {
            this.write = write;
            try
            {
                string text = read?.Invoke(AudioPolicy.StorageKey);
                if (string.IsNullOrEmpty(text)) return;
                var root = JToken.Parse(text);
                if (!(root is JObject value)) return;
                double music = Read(value["musicVolume"], AudioPolicy.DefaultMusicVolume);
                double effects = Read(value["effectsVolume"], AudioPolicy.DefaultEffectsVolume);
                MusicVolume = music; EffectsVolume = effects;
            }
            catch { MusicVolume = AudioPolicy.DefaultMusicVolume; EffectsVolume = AudioPolicy.DefaultEffectsVolume; }
        }
        public void SetMusicVolume(double value) { MusicVolume = Clamp(value); Save(); }
        public void SetEffectsVolume(double value) { EffectsVolume = Clamp(value); Save(); }
        private void Save() => write?.Invoke(AudioPolicy.StorageKey,
            "{\"musicVolume\":" + MusicVolume.ToString("R", CultureInfo.InvariantCulture) +
            ",\"effectsVolume\":" + EffectsVolume.ToString("R", CultureInfo.InvariantCulture) + "}");
        private static double Clamp(double value) => double.IsNaN(value) ? 0 : Math.Min(1, Math.Max(0, value));
        private static double Read(JToken value, double fallback) =>
            value != null && (value.Type == JTokenType.Integer || value.Type == JTokenType.Float) ? Clamp((double)value) : fallback;

    }
}
