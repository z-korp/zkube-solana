using TMPro;
using UnityEngine;
using UnityEngine.TextCore;

namespace ZKube.Presentation
{
    // The mark an identity shows after an amount of its currency: the Arena's
    // Solana logomark after every SOL amount. The mark is a third party's and
    // is drawn as issued: never tinted, outlined or stretched, in one of its
    // three issued versions by the surface under it (the gradient on a dark
    // surface where it stands 20 dp or taller, the white below that, the black
    // on a lit face), and kept clear of the amount by half its own height. It
    // is no skin slot, so no skin restyles it; the build stages it with the one
    // identity that names it in unity/toolchain.json, and Realms carries none.
    // An amount's formatter ends the amount with Tag. Every label the kit makes
    // can draw it, and the kit alone picks the version: no page does.
    public static class CurrencyMark
    {
        public const string Tag = "<sprite name=\"currency\">";
        // The mark stands on the baseline, this share of its text's size tall,
        // half its height clear of the figure before it.
        public const float HeightEm = .72f, ClearHeights = .5f, GradientFromDp = 20;
        public enum Version { Gradient, White, Black }
        private static readonly string[] staged = { "ZKube/Marks/Currency", "ZKube/Marks/CurrencyWhite", "ZKube/Marks/CurrencyBlack" };
        private static readonly TMP_SpriteAsset[] marks = new TMP_SpriteAsset[staged.Length];
        private static bool looked;

        // sizeDp is the text's size as drawn; lit is the lit primary's face.
        public static Version For(float sizeDp, bool lit) =>
            lit ? Version.Black : sizeDp * HeightEm >= GradientFromDp ? Version.Gradient : Version.White;

        // Lets label draw the mark where its words carry Tag. Where the identity
        // stages no mark there is nothing to wear, and no amount carries the tag.
        public static void Wear(TMP_Text label, float sizeDp, bool lit)
        {
            if (!looked)
            {
                looked = true;
                for (int i = 0; i < staged.Length; i++)
                    if (Resources.Load<Sprite>(staged[i]) is Sprite mark) marks[i] = Inline(mark);
            }
            var worn = marks[(int)For(sizeDp, lit)];
            if (worn != null) label.spriteAsset = worn;
        }

        // One issued mark as text's inline sprite, at its own shape.
        private static TMP_SpriteAsset Inline(Sprite mark)
        {
            var asset = ScriptableObject.CreateInstance<TMP_SpriteAsset>();
            asset.name = mark.name; asset.hideFlags = HideFlags.HideAndDontSave;
            // Made at the current version, so nothing upgrades it from a legacy table it never had.
            JsonUtility.FromJsonOverwrite("{\"m_Version\":\"1.1.0\"}", asset);
            var rect = mark.textureRect; float clear = ClearHeights * rect.height;
            asset.spriteSheet = mark.texture;
            var glyph = new TMP_SpriteGlyph(0, new GlyphMetrics(rect.width, rect.height, clear, rect.height, clear + rect.width),
                new GlyphRect(Mathf.RoundToInt(rect.x), Mathf.RoundToInt(rect.y), Mathf.RoundToInt(rect.width), Mathf.RoundToInt(rect.height)), 1, 0);
            asset.spriteGlyphTable.Add(glyph);
            asset.spriteCharacterTable.Add(new TMP_SpriteCharacter(0xFFFE, asset, glyph) { name = "currency", scale = 1 });
            // The sprite's own metrics: its height is HeightEm of the text's size, and it adds nothing to the line.
            var face = asset.faceInfo;
            face.pointSize = rect.height / HeightEm; face.scale = 1; face.ascentLine = rect.height; face.descentLine = 0; face.baseline = 0;
            face.lineHeight = rect.height;
            asset.faceInfo = face;
            asset.UpdateLookupTables();
            var shader = Shader.Find("TextMeshPro/Sprite") ?? throw new System.InvalidOperationException("The inline sprite shader is not in this build");
            asset.material = new Material(shader) { name = mark.name + " inline", mainTexture = mark.texture, hideFlags = HideFlags.HideAndDontSave };
            return asset;
        }
    }
}
