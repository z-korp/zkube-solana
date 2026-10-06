using System;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using ZKube.Core.Generated;

namespace ZKube.Presentation.Tests
{
    // Chinese, Japanese and Korean are drawn by their own pinned fonts behind the text fonts. A character Chinese and
    // Japanese share is drawn by the font of the language in use, and every character a language shows is already
    // baked, so no page waits on a glyph. In every language each letter is in the face that draws its role: a face
    // that lacks an alphabet is replaced whole, never patched a letter at a time from another font.
    public sealed class ScriptFontTests
    {
        private GameObject root;
        [TearDown] public void TearDown() { Words.Use("en"); if (root != null) UnityEngine.Object.Destroy(root); }

        private string DrawnBy(SkinUi.Type type, char character)
        {
            SkinUi.LeadWithTheLanguagesScript();
            if (root == null) root = new GameObject("Script font test", typeof(Canvas));
            var label = new GameObject("Label", typeof(RectTransform)).AddComponent<TextMeshProUGUI>();
            label.transform.SetParent(root.transform, false);
            label.font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(type));
            label.text = "A" + character; label.ForceMeshUpdate();
            Assert.AreEqual(SkinUi.FontName(type), label.textInfo.characterInfo[0].fontAsset.name, "Latin letters stay in the text font");
            return label.textInfo.characterInfo[1].fontAsset.name;
        }

        [Test] public void EachLanguageDrawsItsOwnScriptInItsOwnFont()
        {
            int chinese = Array.IndexOf(Words.Codes, "zh-Hans"), japanese = Array.IndexOf(Words.Codes, "ja"), korean = Array.IndexOf(Words.Codes, "ko");
            char shared = Words.ScriptCharacters(chinese).Intersect(Words.ScriptCharacters(japanese)).First(c => c >= '一');
            foreach (SkinUi.Type type in Enum.GetValues(typeof(SkinUi.Type)))
            {
                Words.Use("ja"); Assert.AreEqual(Words.ScriptFonts[japanese], DrawnBy(type, shared), type + " in Japanese draws " + shared);
                Words.Use("zh-Hans"); Assert.AreEqual(Words.ScriptFonts[chinese], DrawnBy(type, shared), type + " in Chinese draws " + shared);
                Words.Use("ko"); Assert.AreEqual(Words.ScriptFonts[korean], DrawnBy(type, Words.ScriptCharacters(korean).First(c => c >= '가')), type + " in Korean");
                // A language written in Latin letters still shows the other languages' names on the Language page.
                Words.Use("fr"); Assert.That(Words.ScriptFonts, Does.Contain(DrawnBy(type, shared)), type + " in French draws " + shared);
            }
        }

        [Test] public void EveryCharacterALanguageShowsIsBakedInItsScriptFont()
        {
            for (int language = 0; language < Words.Codes.Length; language++)
            {
                if (Words.ScriptFonts[language] == null) { Assert.IsEmpty(Words.ScriptCharacters(language), Words.Codes[language]); continue; }
                var font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + Words.ScriptFonts[language]);
                Assert.NotNull(font, Words.ScriptFonts[language]);
                Assert.IsNotEmpty(Words.ScriptCharacters(language), Words.Codes[language]);
                var missing = Words.ScriptCharacters(language).Where(c => !font.characterLookupTable.ContainsKey(c)).ToArray();
                Assert.IsEmpty(missing, Words.Codes[language] + " waits on " + new string(missing));
            }
        }

        // A player's name comes from the platform. A name the bundled fonts hold is drawn by them; one they do not is
        // drawn whole by a font of the device, and no other label ever leaves the bundled fonts.
        [Test] public void APlayersNameNoBundledFontDrawsIsDrawnByADeviceFont()
        {
            TMP_Text Name(string text)
            {
                if (root == null) root = new GameObject("Script font test", typeof(Canvas));
                var label = new GameObject("Name", typeof(RectTransform)).AddComponent<TextMeshProUGUI>();
                label.transform.SetParent(root.transform, false);
                label.font = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(SkinUi.Type.Caption)); label.text = text;
                SkinUi.DrawNameInADeviceFont(label); label.ForceMeshUpdate();
                return label;
            }
            string bundled = SkinUi.FontName(SkinUi.Type.Caption);
            foreach (string held in new[] { "Player", "Zoë Müller", "Иван", "张伟", "たろう", "민준" })
                Assert.AreEqual(bundled, Name(held).font.name, held + " is drawn by the bundled fonts");
            const string greek = "Ωμέγα";
            Assert.IsFalse(Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + bundled).HasCharacters(greek, out uint[] _, true, true), "no bundled font holds Greek");
            var drawn = Name(greek);
            Assert.AreNotEqual(bundled, drawn.font.name, "a device font draws the name");
            Assert.IsTrue(drawn.font.HasCharacters(greek, out uint[] missing, false, true), "the device font holds the whole name");
            Assert.AreEqual(drawn.font.name, drawn.textInfo.characterInfo[0].fontAsset.name, "the whole name is in the one face");
        }

        [Test] public void EveryCharacterOfALanguageIsInTheFontThatDrawsIt()
        {
            var faults = new System.Collections.Generic.List<string>();
            for (int language = 0; language < Words.Codes.Length; language++)
            {
                Words.Use(Words.Codes[language]); SkinUi.LeadWithTheLanguagesScript();
                foreach (SkinUi.Type type in Enum.GetValues(typeof(SkinUi.Type)))
                {
                    var face = Resources.Load<TMP_FontAsset>("ZKube/Fonts/" + SkinUi.FontName(type));
                    Assert.NotNull(face, SkinUi.FontName(type));
                    // A letter of the language's alphabet is the face's own. Its own script is its script font's, and a
                    // sign (an arrow, a star, a quotation mark) may come from the fonts behind the face.
                    var missing = Words.CharactersOf[language].Where(c => !char.IsWhiteSpace(c) && c <= '\u2e7f' &&
                        (char.IsLetter(c) ? !face.characterLookupTable.ContainsKey(c) : !face.HasCharacter(c, true))).ToArray();
                    if (missing.Length > 0) faults.Add(Words.Codes[language] + " " + type + " (" + face.name + ") cannot draw " + new string(missing));
                }
            }
            Assert.IsEmpty(faults, string.Join("\n", faults));
        }
    }
}
