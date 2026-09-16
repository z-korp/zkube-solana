using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using TMPro;
using UnityEditor;
using UnityEditor.U2D;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;
using UnityEngine.U2D;
using Object = UnityEngine.Object;

namespace ZKube.Editor
{
    // Generated copies are disposable; their source bytes and GUIDs are checked
    // by import_assets.py. Never edit a copied PNG/MP3 to change the artwork.
    public sealed class ZKubeAssetImports : AssetPostprocessor
    {
        public const string Generated = "Assets/ZKube/Art/Generated/";
        private const string ResourceRoot = Generated + "Resources/ZKube/";
        private const string CatalogPath = ResourceRoot + "Catalog.json";
        private static Catalog cached;
        private static DateTime catalogTime;

        [Serializable] private sealed class Catalog
        {
            public int schema;
            public Policy importPolicy;
            public Entry[] assets;
            public FontEntry[] fonts;
            public AtlasEntry[] atlases;
        }
        [Serializable] private sealed class Policy
        {
            public int schema;
            public int pixelsPerUnit;
            public string filter;
            public bool mipmaps;
            public bool readable;
            public string androidTextureFormat;
            public int atlasMaxSize;
            public int atlasPadding;
            public bool allowRotation;
            public bool tightPacking;
            public bool includeAtlasInBuild;
        }
        [Serializable] private sealed class Entry
        {
            public string asset;
            public string scope;
            public string kind;
            public string name;
            public string guid;
            public bool streaming;
            public int maxTextureSize;
        }
        [Serializable] private sealed class FontEntry
        {
            public string name;
            public string asset;
            public string resource;
            public string guid;
            public string fontAssetGuid;
        }
        [Serializable] private sealed class AtlasEntry
        {
            public string scope;
            public string asset;
            public string guid;
            public int maxTextureSize;
            public bool singleTexture;
        }
        [Serializable] private sealed class AtlasReport
        {
            public string scope;
            public int spriteCount;
            public long residentBytes;
            public string[] textures;
        }
        [Serializable] private sealed class Report
        {
            public string unityVersion;
            public string target;
            public string measurementScope = "Editor packed Android atlases; not device peak memory or performance acceptance";
            public AtlasReport[] atlases;
            public int fonts;
        }

        private static Catalog ReadCatalog()
        {
            var time = File.GetLastWriteTimeUtc(CatalogPath);
            if (cached != null && time == catalogTime) return cached;
            if (!File.Exists(CatalogPath)) throw new InvalidOperationException("Run unity/tools/import_assets.py --sync before importing art.");
            cached = JsonUtility.FromJson<Catalog>(File.ReadAllText(CatalogPath));
            if (cached.schema != 1 || cached.importPolicy.schema != 1)
                throw new InvalidOperationException("Unsupported generated art catalog schema.");
            catalogTime = time;
            return cached;
        }

        private void OnPreprocessTexture()
        {
            if (!assetPath.StartsWith(Generated + "Sprites/", StringComparison.Ordinal)) return;
            var catalog = ReadCatalog();
            ApplyTexture((TextureImporter)assetImporter, catalog.importPolicy, catalog.assets.Single(e => e.asset == assetPath).maxTextureSize);
        }

        private static void ApplyTexture(TextureImporter importer, Policy policy, int maxTextureSize)
        {
            importer.textureType = TextureImporterType.Sprite;
            // Minimal deterministic metadata has no shape field. Unity may
            // default it to Cube; textureType alone does not reset that field.
            importer.textureShape = TextureImporterShape.Texture2D;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.spritePixelsPerUnit = policy.pixelsPerUnit;
            importer.spritePivot = new Vector2(0.5f, 0.5f);
            importer.mipmapEnabled = policy.mipmaps;
            importer.isReadable = policy.readable;
            importer.alphaIsTransparency = true;
            importer.sRGBTexture = true;
            importer.npotScale = TextureImporterNPOTScale.None;
            importer.wrapMode = TextureWrapMode.Clamp;
            importer.filterMode = (FilterMode)Enum.Parse(typeof(FilterMode), policy.filter);
            int maximum = maxTextureSize > 0 ? maxTextureSize : policy.atlasMaxSize;
            importer.maxTextureSize = maximum;
            var settings = new TextureImporterSettings();
            importer.ReadTextureSettings(settings);
            settings.spriteMeshType = SpriteMeshType.FullRect;
            importer.SetTextureSettings(settings);
            importer.SetPlatformTextureSettings(AndroidSettings(policy, maximum));
        }

        private static TextureImporterPlatformSettings AndroidSettings(Policy policy, int maximum)
        {
            return new TextureImporterPlatformSettings
            {
                name = "Android", overridden = true, maxTextureSize = maximum,
                format = (TextureImporterFormat)Enum.Parse(typeof(TextureImporterFormat), policy.androidTextureFormat),
                textureCompression = TextureImporterCompression.Compressed, compressionQuality = 50
            };
        }

        private void OnPreprocessAudio()
        {
            if (!assetPath.StartsWith(ResourceRoot + "Audio/", StringComparison.Ordinal)) return;
            var entry = ReadCatalog().assets.Single(e => e.asset == assetPath);
            var importer = (AudioImporter)assetImporter;
            var settings = importer.defaultSampleSettings;
            settings.loadType = entry.streaming ? AudioClipLoadType.Streaming : AudioClipLoadType.DecompressOnLoad;
            settings.compressionFormat = AudioCompressionFormat.Vorbis;
            settings.quality = 0.7f;
            settings.preloadAudioData = !entry.streaming;
            importer.defaultSampleSettings = settings;
            importer.loadInBackground = true;
        }

        // Build preparation invokes this after --sync, within the shared Editor lock.
        // See Unity 6.3 Manual: Load sprite atlases manually at runtime. Resources
        // includes atlas bytes but does not preload them; consumers load one realm.
        [MenuItem("ZKube/Prepare Generated Art")]
        public static void Prepare()
        {
            if (EditorSettings.spritePackerMode == SpritePackerMode.Disabled)
                throw new InvalidOperationException("Enable Sprite Atlas packing in project settings before preparing art.");
            if (Shader.Find("TextMeshPro/Mobile/Distance Field") == null)
                throw new InvalidOperationException("Import TMP Essential Resources from the pinned ugui package before preparing fonts.");
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var catalog = ReadCatalog();
            foreach (var entry in catalog.assets)
            {
                if (AssetDatabase.AssetPathToGUID(entry.asset) != entry.guid)
                    throw new InvalidOperationException("Generated asset GUID drift: " + entry.asset);
                if (entry.kind == "sprite")
                {
                    var importer = (TextureImporter)AssetImporter.GetAtPath(entry.asset);
                    ApplyTexture(importer, catalog.importPolicy, entry.maxTextureSize);
                    importer.SaveAndReimport();
                }
            }
            var atlases = new List<SpriteAtlas>();
            var reports = new List<AtlasReport>();
            foreach (var group in catalog.assets.Where(e => e.kind == "sprite").GroupBy(e => e.scope))
            {
                var definition = catalog.atlases.Single(e => e.scope == group.Key);
                string path = definition.asset;
                var atlas = AssetDatabase.LoadAssetAtPath<SpriteAtlas>(path);
                if (atlas == null)
                {
                    atlas = new SpriteAtlas { name = group.Key };
                    atlas = CreateWithGuid(atlas, path, definition.guid);
                }
                if (AssetDatabase.AssetPathToGUID(path) != definition.guid)
                    throw new InvalidOperationException("Generated atlas GUID drift: " + path);
                var packables = group.Select(LoadPackable).ToArray();
                atlas.Remove(atlas.GetPackables());
                atlas.Add(packables);
                var packing = atlas.GetPackingSettings();
                packing.padding = catalog.importPolicy.atlasPadding;
                packing.enableRotation = catalog.importPolicy.allowRotation;
                packing.enableTightPacking = catalog.importPolicy.tightPacking;
                atlas.SetPackingSettings(packing);
                var texture = atlas.GetTextureSettings();
                texture.generateMipMaps = catalog.importPolicy.mipmaps;
                texture.readable = catalog.importPolicy.readable;
                texture.sRGB = true;
                texture.filterMode = (FilterMode)Enum.Parse(typeof(FilterMode), catalog.importPolicy.filter);
                atlas.SetTextureSettings(texture);
                int maximum = definition.maxTextureSize > 0 ? definition.maxTextureSize : catalog.importPolicy.atlasMaxSize;
                if (definition.singleTexture)
                    atlas.SetPlatformSettings(new TextureImporterPlatformSettings { name = "DefaultTexturePlatform", maxTextureSize = maximum });
                atlas.SetPlatformSettings(AndroidSettings(catalog.importPolicy, maximum));
                atlas.SetIncludeInBuild(catalog.importPolicy.includeAtlasInBuild);
                EditorUtility.SetDirty(atlas);
                atlases.Add(atlas);
            }
            AssetDatabase.SaveAssets();
            var target = EditorUserBuildSettings.activeBuildTarget;
            SpriteAtlasUtility.PackAtlases(atlases.ToArray(), target, false);
            foreach (var atlas in atlases)
            {
                var expected = catalog.assets.Where(e => e.kind == "sprite" && e.scope == atlas.name).ToArray();
                if (atlas.spriteCount != expected.Length)
                    throw new InvalidOperationException($"Packed atlas {atlas.name} has {atlas.spriteCount} sprites, expected {expected.Length}");
                foreach (var entry in expected)
                {
                    var named = atlas.GetSprite(entry.name);
                    if (named == null) throw new InvalidOperationException("Packed sprite name is missing: " + entry.scope + "/" + entry.name);
                    Object.DestroyImmediate(named);
                }
                var sprites = new Sprite[atlas.spriteCount];
                atlas.GetSprites(sprites);
                var textures = sprites.Where(s => s != null).Select(s => s.texture).Distinct().ToArray();
                var definition = catalog.atlases.Single(value => value.scope == atlas.name);
                if (definition.singleTexture && (textures.Length != 1 || textures[0].width > definition.maxTextureSize || textures[0].height > definition.maxTextureSize))
                    throw new InvalidOperationException("The portrait atlas must pack into one bounded texture");
                if (textures.Length == 0 || textures.Any(t => t == null) || textures.Sum(t => UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(t)) <= 0)
                    throw new InvalidOperationException("Packed atlas has no measurable texture data: " + atlas.name);
                reports.Add(new AtlasReport
                {
                    scope = atlas.name, spriteCount = atlas.spriteCount,
                    residentBytes = textures.Sum(t => UnityEngine.Profiling.Profiler.GetRuntimeMemorySizeLong(t)),
                    textures = textures.Select(t => $"{t.width}x{t.height} {t.format}").ToArray()
                });
                foreach (var sprite in sprites) if (sprite != null) Object.DestroyImmediate(sprite);
            }
            PrepareFonts(catalog.fonts);
            AssetDatabase.SaveAssets();
            string output = Path.GetFullPath("../build/unity/art-import-report.json");
            Directory.CreateDirectory(Path.GetDirectoryName(output));
            File.WriteAllText(output, JsonUtility.ToJson(new Report
            {
                unityVersion = Application.unityVersion, target = target.ToString(), atlases = reports.ToArray(), fonts = catalog.fonts.Length
            }, true));
            Debug.Log("zKube generated art prepared; packed atlas measurements: " + output);
        }

        private static Object LoadPackable(Entry entry)
        {
            var assets = AssetDatabase.LoadAllAssetsAtPath(entry.asset);
            var sprites = assets.OfType<Sprite>().ToArray();
            if (sprites.Length != 1 || sprites[0].name != entry.name)
                throw new InvalidOperationException("Expected one named sprite " + entry.name + " at " + entry.asset +
                    "; imported objects: " + string.Join(", ", assets.Select(a => a.GetType().Name + ":" + a.name)));
            return sprites[0];
        }

        private static void PrepareFonts(FontEntry[] entries)
        {
            // Keep a bounded Latin/UI seed. These assets use only bundled font
            // files for later glyph additions; never DynamicOS/system fallbacks.
            var seed = new StringBuilder();
            for (int code = 32; code <= 126; code++) seed.Append((char)code);
            for (int code = 160; code <= 255; code++) seed.Append((char)code);
            seed.Append("★☆✓◇×←→↑↓↻…–—‘’“”•≤≥");
            var fonts = new Dictionary<string, TMP_FontAsset>();
            foreach (var entry in entries)
            {
                if (AssetDatabase.AssetPathToGUID(entry.asset) != entry.guid)
                    throw new InvalidOperationException("Generated font GUID drift: " + entry.asset);
                string path = Generated + "Resources/" + entry.resource + ".asset";
                var font = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(path);
                if (font == null)
                {
                    font = TMP_FontAsset.CreateFontAsset(AssetDatabase.LoadAssetAtPath<Font>(entry.asset),
                        64, 8, GlyphRenderMode.SDFAA, 1024, 1024, AtlasPopulationMode.Dynamic, true);
                    if (font == null) throw new InvalidOperationException("Failed to create TMP font: " + entry.name);
                    font.name = entry.name;
                    font = CreateWithGuid(font, path, entry.fontAssetGuid,
                        font.material, font.atlasTextures[0]);
                }
                if (AssetDatabase.AssetPathToGUID(path) != entry.fontAssetGuid)
                    throw new InvalidOperationException("Generated TMP font GUID drift: " + path);
                // In the pinned ugui package the accessor is internal; use its
                // serialized Editor field so baked seed glyphs survive builds.
                var serialized = new SerializedObject(font);
                var clearOnBuild = serialized.FindProperty("m_ClearDynamicDataOnBuild");
                if (clearOnBuild == null) throw new InvalidOperationException("Pinned TMP clear-on-build field changed.");
                clearOnBuild.boolValue = false;
                serialized.ApplyModifiedPropertiesWithoutUndo();
                font.TryAddCharacters(seed.ToString(), out string _, true);
                fonts.Add(entry.name, font);
            }
            var symbols = fonts["NotoSansSymbols2-Regular"];
            var math = fonts["NotoSansMath-Regular"];
            symbols.fallbackFontAssetTable = new List<TMP_FontAsset>();
            math.fallbackFontAssetTable = new List<TMP_FontAsset>();
            foreach (var pair in fonts)
            {
                if (pair.Value == symbols || pair.Value == math) continue;
                pair.Value.fallbackFontAssetTable = pair.Key == "LilitaOne-Regular"
                    ? new List<TMP_FontAsset> { fonts["Outfit-Regular"], symbols, math }
                    : new List<TMP_FontAsset> { symbols, math };
                const string required = "zKube Campaign Arcade Score Theme Kredit 0123456789★☆✓◇×←→↑↓…–—‘’“”•≤≥";
                if (!pair.Value.HasCharacters(required, out uint[] missing, true, true))
                    throw new InvalidOperationException(EntryMessage(pair.Key, missing));
            }
            foreach (var font in fonts.Values)
            {
                // Additional pages created by glyph warming must be persistent too.
                foreach (var texture in font.atlasTextures)
                    if (!AssetDatabase.Contains(texture)) AssetDatabase.AddObjectToAsset(texture, font);
                EditorUtility.SetDirty(font);
            }
        }

        private static T CreateWithGuid<T>(T asset, string path, string expectedGuid, params Object[] children) where T : Object
        {
            // CreateAsset allocates a GUID even when an orphan .meta was seeded.
            // Serialize the complete object graph first, then import a real file
            // with its canonical metadata. Unity uses this serializer itself for
            // preset libraries; including TMP children preserves local references.
            if (File.Exists(path)) throw new InvalidOperationException("Refusing to replace an existing generated asset: " + path);
            var objects = new[] { (Object)asset }.Concat(children).ToArray();
            AssetDatabase.DisallowAutoRefresh();
            try
            {
                UnityEditorInternal.InternalEditorUtility.SaveToSerializedFileAndForget(objects, path, true);
                File.WriteAllText(path + ".meta", "fileFormatVersion: 2\nguid: " + expectedGuid + "\n");
            }
            finally { AssetDatabase.AllowAutoRefresh(); }
            AssetDatabase.ImportAsset(path, ImportAssetOptions.ForceSynchronousImport);
            if (AssetDatabase.AssetPathToGUID(path) != expectedGuid)
                throw new InvalidOperationException("Unity did not retain deterministic generated GUID: " + path);
            var loaded = AssetDatabase.LoadAllAssetsAtPath(path).OfType<T>().Single();
            AssetDatabase.SetMainObject(loaded, path);
            foreach (var temporary in objects) Object.DestroyImmediate(temporary);
            if (loaded is TMP_FontAsset font &&
                (!AssetDatabase.Contains(font.material) || font.atlasTextures.Any(t => !AssetDatabase.Contains(t))))
                throw new InvalidOperationException("TMP generated subassets were not retained: " + path);
            return loaded;
        }

        private static string EntryMessage(string name, uint[] missing)
            => "Missing required fallback glyphs for " + name + ": " + string.Join(",", missing.Select(c => "U+" + c.ToString("X4")));
    }
}
