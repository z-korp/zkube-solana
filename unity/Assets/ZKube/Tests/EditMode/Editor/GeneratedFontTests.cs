using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEditor;

namespace ZKube.Editor.Tests
{
    public sealed class GeneratedFontTests
    {
        // Text must measure the same in every checkout: a kerning pair may not
        // carry the font engine's uninitialised lookup flags.
        [Test] public void EveryGeneratedFontSpacesEveryKerningPair()
        {
            var fonts = AssetDatabase.FindAssets("t:TMP_FontAsset", new[] { ZKubeAssetImports.Generated })
                .Select(guid => AssetDatabase.LoadAssetAtPath<TMP_FontAsset>(AssetDatabase.GUIDToAssetPath(guid))).ToArray();
            Assert.That(fonts.Length, Is.GreaterThanOrEqualTo(5));
            Assert.That(fonts.Sum(font => font.fontFeatureTable.glyphPairAdjustmentRecords.Count), Is.GreaterThan(0), "The fonts keep their kerning");
            foreach (var font in fonts)
                foreach (var pair in font.fontFeatureTable.glyphPairAdjustmentRecords)
                    Assert.AreEqual(UnityEngine.TextCore.LowLevel.FontFeatureLookupFlags.None, pair.featureLookupFlags, font.name + " pair " +
                        pair.firstAdjustmentRecord.glyphIndex + "-" + pair.secondAdjustmentRecord.glyphIndex);
        }
    }
}
