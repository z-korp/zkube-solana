using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.U2D;

namespace ZKube.Presentation
{
    public sealed class BoardArt : IDisposable
    {
        [Serializable] private sealed class Catalog { public Theme[] themes; public GuardianRule[] guardianRules; }
        [Serializable] public sealed class GuardianRule
        {
            public byte bonus, trigger;
            public ushort threshold;
            public string description, sentence;
        }
        private GuardianRule[] guardianRules = Array.Empty<GuardianRule>();
        [Serializable] private sealed class Theme { public string id, guardianName; public byte realmId; public Swatch[] rgba; public AudioEntry[] audio; }
        [Serializable] private sealed class AudioEntry { public string context, resource; }
        [Serializable] private sealed class Swatch { public string name; public float[] value; }
        private SpriteAtlas atlas;
        private SpriteAtlas common;
        // Resources returns the same atlas to the page and the playable board.
        // Count those main-thread owners before starting/waiting on a request;
        // only the last owner may unload the shared native asset.
        private sealed class AtlasLoad
        {
            public readonly string Path;
            public readonly ResourceRequest Request;
            public int Owners = 1;
            public bool Collected;
            public AtlasLoad(string path) { Path = path; Request = Resources.LoadAsync<SpriteAtlas>(path); }
        }
        private static readonly Dictionary<string, AtlasLoad> atlasLoads = new Dictionary<string, AtlasLoad>();
        private AtlasLoad realmLoad, commonLoad;
        private readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();
        private readonly Dictionary<string, Color> colors = new Dictionary<string, Color>();
        public TMP_FontAsset Display { get; private set; }
        public TMP_FontAsset Body { get; private set; }
        public byte RealmId { get; private set; }
        public string ThemeId { get; private set; }
        public string GuardianName { get; private set; }
        public string LevelMusicResource { get; private set; }
        private bool disposed;
        public string Title(BoardSession session) => !string.IsNullOrEmpty(session?.Title) ? session.Title :
            GuardianName + (session == null ? "" : session.Daily ? " · DAILY" : " · CAMPAIGN");
        public IEnumerator Load(byte realmId)
        {
            if (disposed) throw new ObjectDisposedException(nameof(BoardArt));
            ReleaseRealm();
            var catalog = Resources.Load<TextAsset>("ZKube/Catalog");
            if (catalog == null) throw new InvalidOperationException("Generated art catalog is missing");
            Catalog data;
            try { data = JsonUtility.FromJson<Catalog>(catalog.text); }
            finally { Resources.UnloadAsset(catalog); }
            guardianRules = data.guardianRules ?? throw new InvalidOperationException("Regenerate the art catalog with live guardian descriptions");
            var theme = data.themes?.SingleOrDefault(value => value.realmId == realmId)
                ?? throw new InvalidOperationException("No imported art is bound to realm " + realmId);
            if (string.IsNullOrEmpty(theme.id) || string.IsNullOrEmpty(theme.guardianName))
                throw new InvalidOperationException("Imported realm identity is incomplete");
            var music = theme.audio?.SingleOrDefault(value => value.context == "level")
                ?? throw new InvalidOperationException("Imported realm level music is missing");
            RealmId = realmId; ThemeId = theme.id; GuardianName = theme.guardianName; LevelMusicResource = music.resource;
            foreach (var swatch in theme.rgba)
                colors[swatch.name] = new Color(swatch.value[0], swatch.value[1], swatch.value[2], swatch.value[3]);
            var selected = realmLoad = AcquireAtlas("ZKube/Atlases/" + ThemeId);
            yield return selected.Request;
            if (disposed || realmLoad != selected) yield break;
            atlas = selected.Request.asset as SpriteAtlas;
            if (common == null)
            {
                if (commonLoad == null) commonLoad = AcquireAtlas("ZKube/Atlases/common");
                yield return commonLoad.Request;
                if (disposed || realmLoad != selected) yield break;
                common = commonLoad.Request.asset as SpriteAtlas;
            }
            if (Display == null) Display = Resources.Load<TMP_FontAsset>("ZKube/Fonts/LilitaOne-Regular");
            if (Body == null) Body = Resources.Load<TMP_FontAsset>("ZKube/Fonts/Outfit-Regular");
            if (atlas == null || common == null || Display == null || Body == null)
                throw new InvalidOperationException("Prepare the bundled realm atlas and TMP fonts before opening the board");

        }
        public IEnumerator LoadPortraits()
        {
            if (disposed) throw new ObjectDisposedException(nameof(BoardArt));
            ReleaseRealm();
            foreach (var sprite in sprites.Values) UnityEngine.Object.Destroy(sprite);
            sprites.Clear(); ReleaseAtlas(ref commonLoad); common = null;
            ThemeId = "portraits";
            var selected = realmLoad = AcquireAtlas("ZKube/Atlases/portraits");
            yield return selected.Request;
            if (disposed || realmLoad != selected) yield break;
            atlas = selected.Request.asset as SpriteAtlas;
            if (atlas == null) throw new InvalidOperationException("Generated profile portraits are missing");
        }
        private static AtlasLoad AcquireAtlas(string path)
        {
            if (atlasLoads.TryGetValue(path, out var shared)) { shared.Owners++; return shared; }
            var created = new AtlasLoad(path); atlasLoads.Add(path, created);
            // Completion can outlive one or all of its requesting BoardArt
            // owners. A new owner may also acquire this still-pending request.
            created.Request.completed += _ => CollectAtlas(created);
            return created;
        }
        private static void ReleaseAtlas(ref AtlasLoad owned)
        {
            if (owned == null) return;
            var released = owned; owned = null; released.Owners--; CollectAtlas(released);
        }
        private static void CollectAtlas(AtlasLoad shared)
        {
            if (shared.Collected || shared.Owners != 0 || !shared.Request.isDone) return;
            shared.Collected = true; atlasLoads.Remove(shared.Path);
            if (shared.Request.asset != null) Resources.UnloadAsset(shared.Request.asset);
        }
        public Sprite Sprite(string name)
        {
            if (!sprites.TryGetValue(name, out var sprite))
            {
                sprite = name.StartsWith("common/", StringComparison.Ordinal) ? common.GetSprite(name.Substring(7)) : atlas.GetSprite(name);
                if (sprite == null) throw new InvalidOperationException("Missing realm sprite: " + name);
                sprites.Add(name, sprite);
            }
            return sprite;
        }
        public Color Color(string name, Color fallback) => colors.TryGetValue(name, out var color) ? color : fallback;
        public GuardianRule Guardian(byte bonus, byte trigger, ushort threshold)
        {
            foreach (var rule in guardianRules)
                if (rule.bonus == bonus && rule.trigger == trigger && rule.threshold == threshold) return rule;
            return null;
        }
        private void ReleaseRealm()
        {
            foreach (string key in sprites.Keys.Where(key => !key.StartsWith("common/", StringComparison.Ordinal)).ToArray())
            { UnityEngine.Object.Destroy(sprites[key]); sprites.Remove(key); }
            ReleaseAtlas(ref realmLoad);
            atlas = null; colors.Clear();
            RealmId = 0; ThemeId = null; GuardianName = null; LevelMusicResource = null;
        }
        public void Dispose()
        {
            if (disposed) return;
            disposed = true; ReleaseRealm();
            foreach (var sprite in sprites.Values) UnityEngine.Object.Destroy(sprite);
            sprites.Clear();
            ReleaseAtlas(ref commonLoad);
            common = null;
        }
    }
}
