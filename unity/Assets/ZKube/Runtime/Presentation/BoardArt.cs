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
        private PageCatalog.GuardianRule[] guardianRules = Array.Empty<PageCatalog.GuardianRule>();
        private SpriteAtlas atlas;
        private SpriteAtlas common;
        // Resources returns the same atlas to the page and the playable board.
        // Count those main-thread owners before starting/waiting on a request;
        // only the last owner may unload the shared native asset.
        private sealed class AtlasLoad
        {
            public readonly string Path;
            private readonly ResourceRequest request;
            public int Owners = 1;
            public bool Collected;
            public AtlasLoad(string path, Action<AtlasLoad> done) { Path = path; request = Resources.LoadAsync<SpriteAtlas>(path); request.completed += _ => done(this); }
            // Unity lets one coroutine yield a request and logs an error for a second, which then goes on
            // without the asset. So the request is never handed out to be yielded: the first owner to wait
            // is given it once, and every other owner waits until it is done.
            private bool awaited;
            public object Awaited() { if (awaited) return null; awaited = true; return request; }
            public bool Done => request.isDone;
            public SpriteAtlas Atlas => request.asset as SpriteAtlas;
        }
        private static readonly Dictionary<string, AtlasLoad> atlasLoads = new Dictionary<string, AtlasLoad>();
        // The atlases are late-binding, in Resources under their own tag. When
        // Unity itself asks for one (a packed sprite drawn before its atlas was
        // bound), it gets the same asset, not a warning and a blank sprite.
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void BindLateAtlases() { SpriteAtlasManager.atlasRequested -= Supply; SpriteAtlasManager.atlasRequested += Supply; }
        private static void Supply(string tag, Action<SpriteAtlas> bind) { var atlas = LateAtlas(tag); if (atlas != null) bind(atlas); }
        public static SpriteAtlas LateAtlas(string tag) => Resources.Load<SpriteAtlas>("ZKube/Atlases/" + tag);
        private AtlasLoad realmLoad, commonLoad, skinUiLoad, skinRealmLoad;
        private SpriteAtlas skinUi, skinRealm;
        // The skin's tokens and the loaded realm's own tokens, in one lookup.
        private readonly Dictionary<string, Color> tokens = new Dictionary<string, Color>();
        private readonly Dictionary<string, Sprite> sprites = new Dictionary<string, Sprite>();
        private readonly Dictionary<string, Color> colors = new Dictionary<string, Color>();
        // By name: a language may take another face for a role.
        private readonly Dictionary<string, TMP_FontAsset> fonts = new Dictionary<string, TMP_FontAsset>();
        // The language whose script font leads; a font is never handed out in another language's order.
        private int scriptOf = -1;
        public TMP_FontAsset Font(SkinUi.Type type)
        {
            if (scriptOf != global::ZKube.Core.Generated.Words.Language)
            { scriptOf = global::ZKube.Core.Generated.Words.Language; global::ZKube.Presentation.SkinUi.LeadWithTheLanguagesScript(); }
            string name = global::ZKube.Presentation.SkinUi.FontName(type);
            if (fonts.TryGetValue(name, out var font)) return font;
            font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + name);
            if (font == null) throw new InvalidOperationException("Prepare the bundled TMP fonts before opening the board");
            fonts.Add(name, font); return font;
        }
        public byte RealmId { get; private set; }
        public string ThemeId { get; private set; }
        public string GuardianName { get; private set; }
        // The loaded realm's key light, shafts and motes.
        public PageCatalog.RealmLight Light { get; private set; }
        // The guardian's rail line, a fraction of its canvas from the top.
        public float GuardianRailY { get; private set; }
        // The top of the guardian's head (crest, horns, ears) as a fraction of its canvas.
        public float GuardianTopY { get; private set; }
        // The lowest edge of the guardian's paws, which hang below its rail over what it leans on.
        public float GuardianPawsY { get; private set; }
        // Guardian continuity (one owner): the guardian is always drawn as its
        // idle frame, and a mood, blink or talk frame adds only its face, the
        // rectangle the art records, over it. Every frame then shares idle's
        // body texels, so no frame can differ from idle outside the face,
        // whatever the texture codec does to each frame's own copy of the body.
        // GuardianFace is that rectangle, in fractions of the canvas from its
        // top left.
        public const string GuardianIdle = "boss__idle";
        public Rect GuardianFace { get; private set; }
        // The face of a frame as its own sprite, cut from the frame where it is packed; null for idle.
        public Sprite Face(string frame)
        {
            if (frame == "idle") return null;
            string key = "face:" + frame;
            if (!sprites.TryGetValue(key, out var face))
            {
                var whole = Sprite("boss__" + frame); var packed = whole.textureRect;
                var cut = new Rect(packed.x + Mathf.Round(GuardianFace.x * packed.width), packed.y + Mathf.Round((1 - GuardianFace.yMax) * packed.height),
                    Mathf.Round(GuardianFace.width * packed.width), Mathf.Round(GuardianFace.height * packed.height));
                face = UnityEngine.Sprite.Create(whole.texture, cut, new Vector2(.5f, .5f), whole.pixelsPerUnit, 0, SpriteMeshType.FullRect);
                face.name = "boss__" + frame;
                sprites.Add(key, face);
            }
            return face;
        }
        // Where the face lies inside a rectangle the whole canvas is drawn in (y up).
        public Rect FaceIn(Rect canvas) => new Rect(canvas.x + GuardianFace.x * canvas.width, canvas.y + (1 - GuardianFace.yMax) * canvas.height,
            GuardianFace.width * canvas.width, GuardianFace.height * canvas.height);
        // The guardian's eyes and mouth as the art records them, in the same
        // fractions: a speech bubble's tail aims at the mouth and stays off the eyes.
        public Rect GuardianEyes { get; private set; }
        public Vector2 GuardianMouth { get; private set; }
        public Rect EyesIn(Rect canvas) => new Rect(canvas.x + GuardianEyes.x * canvas.width, canvas.y + (1 - GuardianEyes.yMax) * canvas.height,
            GuardianEyes.width * canvas.width, GuardianEyes.height * canvas.height);
        public Vector2 MouthIn(Rect canvas) => new Vector2(canvas.x + GuardianMouth.x * canvas.width, canvas.y + (1 - GuardianMouth.y) * canvas.height);
        public string LevelMusicResource { get; private set; }
        // The guardian's own track and title, for its level.
        public string BossMusicResource { get; private set; }
        public string GuardianTitle { get; private set; }
        private bool disposed;
        public IEnumerator Load(byte realmId)
        {
            if (disposed) throw new ObjectDisposedException(nameof(BoardArt));
            ReleaseRealm();
            var data = PageCatalog.Load();
            guardianRules = data.guardianRules ?? throw new InvalidOperationException("Regenerate the art catalog with live guardian descriptions");
            var theme = data.themes?.SingleOrDefault(value => value.realmId == realmId)
                ?? throw new InvalidOperationException("No imported art is bound to realm " + realmId);
            if (string.IsNullOrEmpty(theme.id) || string.IsNullOrEmpty(theme.guardianName))
                throw new InvalidOperationException("Imported realm identity is incomplete");
            var music = theme.audio?.SingleOrDefault(value => value.context == "level")
                ?? throw new InvalidOperationException("Imported realm level music is missing");
            if (theme.guardian == null || !(theme.guardian.railY > 0 && theme.guardian.railY < 1))
                throw new InvalidOperationException("Imported guardian has no rail line");
            if (!(theme.guardian.topY >= 0 && theme.guardian.topY < theme.guardian.railY))
                throw new InvalidOperationException("Imported guardian has no head top above its rail");
            if (!(theme.guardian.pawsY > theme.guardian.railY && theme.guardian.pawsY <= 1))
                throw new InvalidOperationException("Imported guardian has no paws below its rail");
            var face = theme.guardian.face;
            if (face == null || face.Length != 4 || !(face[2] > 0 && face[3] > 0 && face[0] >= 0 && face[1] >= 0 && face[0] + face[2] <= 1 && face[1] + face[3] <= 1))
                throw new InvalidOperationException("Imported guardian has no face rectangle");
            GuardianFace = new Rect(face[0], face[1], face[2], face[3]);
            float[] eyes = theme.guardian.eyes, mouth = theme.guardian.mouth;
            if (eyes == null || eyes.Length != 4 || mouth == null || mouth.Length != 2)
                throw new InvalidOperationException("Imported guardian has no eyes and mouth");
            GuardianEyes = new Rect(eyes[0], eyes[1], eyes[2], eyes[3]); GuardianMouth = new Vector2(mouth[0], mouth[1]);
            var boss = theme.audio.SingleOrDefault(value => value.context == "boss")
                ?? throw new InvalidOperationException("Imported realm guardian music is missing");
            RealmId = realmId; ThemeId = theme.id; GuardianName = theme.guardianName; LevelMusicResource = music.resource;
            BossMusicResource = boss.resource; GuardianTitle = theme.guardianTitle;
            GuardianRailY = theme.guardian.railY; GuardianTopY = theme.guardian.topY; GuardianPawsY = theme.guardian.pawsY;
            foreach (var swatch in theme.rgba)
                colors[swatch.name] = new Color(swatch.value[0], swatch.value[1], swatch.value[2], swatch.value[3]);
            var selected = realmLoad = AcquireAtlas("ZKube/Atlases/" + ThemeId);
            for (object wait = selected.Awaited(); ; wait = null) { yield return wait; if (selected.Done) break; }
            if (disposed || realmLoad != selected) yield break;
            atlas = selected.Atlas;
            if (common == null)
            {
                if (commonLoad == null) commonLoad = AcquireAtlas("ZKube/Atlases/common");
                var shared = commonLoad;
                for (object wait = shared.Awaited(); ; wait = null) { yield return wait; if (shared.Done) break; }
                if (disposed || realmLoad != selected) yield break;
                common = shared.Atlas;
            }
            var skin = data.DefaultSkin;
            var realmEntry = skin.realms.Single(value => value.realmId == realmId);
            Light = realmEntry.light;
            foreach (var token in skin.tokens.Concat(realmEntry.tokens))
                tokens.Add(token.name, new Color(token.value[0], token.value[1], token.value[2], token.value[3]));
            var realmSkin = skinRealmLoad = AcquireAtlas("ZKube/Atlases/skin-" + skin.id + "-theme-" + realmId);
            if (skinUiLoad == null) skinUiLoad = AcquireAtlas("ZKube/Atlases/skin-" + skin.id + "-ui");
            var ui = skinUiLoad;
            for (object wait = realmSkin.Awaited(); ; wait = null) { yield return wait; if (realmSkin.Done) break; }
            for (object wait = ui.Awaited(); ; wait = null) { yield return wait; if (ui.Done) break; }
            if (disposed || realmLoad != selected) yield break;
            skinRealm = realmSkin.Atlas;
            skinUi = ui.Atlas;
            if (skinRealm == null || skinUi == null) throw new InvalidOperationException("Prepare the bundled skin atlases before opening the page");
            foreach (global::ZKube.Presentation.SkinUi.Type type in Enum.GetValues(typeof(global::ZKube.Presentation.SkinUi.Type)))
                Font(type);
            if (atlas == null || common == null)
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
            for (object wait = selected.Awaited(); ; wait = null) { yield return wait; if (selected.Done) break; }
            if (disposed || realmLoad != selected) yield break;
            atlas = selected.Atlas;
            if (atlas == null) throw new InvalidOperationException("Generated profile portraits are missing");
        }
        private static AtlasLoad AcquireAtlas(string path)
        {
            if (atlasLoads.TryGetValue(path, out var shared)) { shared.Owners++; return shared; }
            // Completion can outlive one or all of its requesting BoardArt
            // owners. A new owner may also acquire this still-pending request.
            var created = new AtlasLoad(path, CollectAtlas); atlasLoads.Add(path, created);
            return created;
        }
        private static void ReleaseAtlas(ref AtlasLoad owned)
        {
            if (owned == null) return;
            var released = owned; owned = null; released.Owners--; CollectAtlas(released);
        }
        private static void CollectAtlas(AtlasLoad shared)
        {
            if (shared.Collected || shared.Owners != 0 || !shared.Done) return;
            shared.Collected = true; atlasLoads.Remove(shared.Path);
            if (shared.Atlas != null) Resources.UnloadAsset(shared.Atlas);
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
        // The zKube wordmark's mark alone, for small headers.
        public const string Mark = "common/mark";
        public Color Color(string name, Color fallback) => colors.TryGetValue(name, out var color) ? color : fallback;
        public Color Token(string name) => tokens.TryGetValue(name, out var color) ? color
            : throw new InvalidOperationException("Skin token is missing: " + name);
        public Sprite SkinUi(string slot) => SkinSprite("ui/", skinUi, slot);
        public Sprite SkinRealm(string slot) => SkinSprite("realm/", skinRealm, slot);
        private Sprite SkinSprite(string prefix, SpriteAtlas source, string slot)
        {
            var key = "skin/" + prefix + slot;
            if (!sprites.TryGetValue(key, out var sprite))
            {
                sprite = source != null ? source.GetSprite(slot) : null;
                if (sprite == null) throw new InvalidOperationException("Missing skin sprite: " + prefix + slot);
                sprites.Add(key, sprite);
            }
            return sprite;
        }
        public PageCatalog.GuardianRule Guardian(byte bonus, byte trigger, ushort threshold)
        {
            foreach (var rule in guardianRules)
                if (rule.bonus == bonus && rule.trigger == trigger && rule.threshold == threshold) return rule;
            return null;
        }
        private void ReleaseRealm()
        {
            foreach (string key in sprites.Keys.Where(key => !key.StartsWith("common/", StringComparison.Ordinal) &&
                                                             !key.StartsWith("skin/ui/", StringComparison.Ordinal)).ToArray())
            { UnityEngine.Object.Destroy(sprites[key]); sprites.Remove(key); }
            ReleaseAtlas(ref realmLoad); ReleaseAtlas(ref skinRealmLoad);
            atlas = null; skinRealm = null; colors.Clear(); tokens.Clear();
            RealmId = 0; ThemeId = null; GuardianName = null; LevelMusicResource = null; BossMusicResource = null; GuardianTitle = null;
        }
        public void Dispose()
        {
            if (disposed) return;
            disposed = true; ReleaseRealm();
            foreach (var sprite in sprites.Values) UnityEngine.Object.Destroy(sprite);
            sprites.Clear();
            ReleaseAtlas(ref commonLoad); ReleaseAtlas(ref skinUiLoad);
            common = null; skinUi = null;
        }
    }
}
