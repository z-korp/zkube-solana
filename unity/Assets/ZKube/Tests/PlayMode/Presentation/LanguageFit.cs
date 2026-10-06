using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TMPro;
using UnityEngine;
using UnityEngine.UI;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Tests.Presentation
{
    // What a language's words may not do on a drawn page: spill out of the
    // place its label was given, leave the screen sideways, wrap on a button, cut a word in two,
    // or be set under the text floor and smaller than English sets that label.
    // A page that does not scroll in English does not scroll in any language. Faults are returned, each named by the
    // language, the phone and the page, so one run lists every place to rephrase.
    public static class LanguageFit
    {
        public const float FloorDp = 11;
        // Whether each page scrolled in English, the source the others are held to.
        private static readonly Dictionary<string, bool> englishScrolls = new Dictionary<string, bool>();
        // The smallest size English sets each label at, by page and label.
        private static readonly Dictionary<string, float> englishSize = new Dictionary<string, float>();

        public static IEnumerable<string> Faults(Component page, Rect screen, float density, float scale, string at)
        {
            string place = at; at = Words.Code + " " + at;
            foreach (var label in page.GetComponentsInChildren<TMP_Text>())
            {
                if (!label.isActiveAndEnabled || string.IsNullOrWhiteSpace(label.text) || label.color.a < .01f) continue;
                if (label.GetComponentsInParent<CanvasGroup>().Any(group => group.alpha < .01f)) continue;
                label.ForceMeshUpdate();
                if (label.textInfo.characterCount == 0) continue;
                // A sign alone (a tick, an arrow) is drawn by the symbol font, whose line stands taller than the text's.
                bool sign = !label.text.Any(char.IsLetterOrDigit);
                var box = label.rectTransform.rect; var drawn = sign ? Vector3.zero : label.textBounds.size;
                string words = "\"" + label.text.Replace("\n", " / ") + "\" (" + label.name + ")";
                // A glyph's ink runs a little past its advance, and a line's bounds past its box.
                float slack = 1.5f * density + .1f * label.fontSize;
                if (drawn.x > box.width + slack)
                    yield return at + ": " + words + " is " + (drawn.x - box.width).ToString("0", CultureInfo.InvariantCulture) + " px wider than its place";
                if (drawn.y > box.height + slack + .3f * label.fontSize)
                    yield return at + ": " + words + " is " + (drawn.y - box.height).ToString("0", CultureInfo.InvariantCulture) + " px taller than its place";
                if (label.textInfo.lineCount > 1 && label.GetComponentInParent<Button>() != null && label.GetComponentInParent<Button>().GetComponentsInChildren<TMP_Text>().Length == 1)
                    yield return at + ": " + words + " wraps on its button";
                // A place too narrow for a word cuts it in two. Scripts written without spaces break anywhere.
                for (int line = 0; line + 1 < label.textInfo.lineCount; line++)
                {
                    char last = label.textInfo.characterInfo[label.textInfo.lineInfo[line].lastCharacterIndex].character;
                    char next = label.textInfo.characterInfo[label.textInfo.lineInfo[line + 1].firstCharacterIndex].character;
                    if (char.IsLetter(last) && char.IsLetter(next) && last < 'ᄀ' && next < 'ᄀ')
                    { yield return at + ": " + words + " breaks a word in two"; break; }
                }
                var corners = new Vector3[4]; label.rectTransform.GetWorldCorners(corners);
                float centre = (corners[0].x + corners[2].x) / 2, left = centre - drawn.x / 2, right = centre + drawn.x / 2;
                if (label.alignment == TextAlignmentOptions.Left || label.alignment == TextAlignmentOptions.TopLeft || label.alignment == TextAlignmentOptions.MidlineLeft)
                { left = corners[0].x; right = left + drawn.x; }
                if (left < screen.xMin - slack || right > screen.xMax + slack)
                    yield return at + ": " + words + " leaves the screen";
                // A label of signs and figures alone is the same in every language, whatever its object is named.
                string sized = place + "|" + (label.text.Any(char.IsLetter) ? label.name : label.text); float size = label.fontSize / density / scale;
                if (Words.Language == 0) englishSize[sized] = englishSize.TryGetValue(sized, out float known) ? Mathf.Min(known, size) : size;
                else if (size < FloorDp - .05f && (!englishSize.TryGetValue(sized, out float english) || size < english - .05f))
                    yield return at + ": " + words + " is set at " + size.ToString("0.#", CultureInfo.InvariantCulture) + " dp, under the floor and under English";
            }
        }

        // Every word a page shows is the catalogue's: a row of the language in
        // use, alone or with its placeholders filled, or several of them set
        // side by side. Figures and signs are not words, and neither is what
        // the player or the platform brought (a name, a price), which a test
        // passes as known. What is left was written somewhere else.
        private static System.Text.RegularExpressions.Regex owned; private static int ownedLanguage = -1;
        private const string Signs = @"[\d\s\p{P}\p{S}]";
        public static IEnumerable<string> Unowned(Component page, string at, params string[] known)
        {
            if (ownedLanguage != Words.Language)
            {
                var rows = new List<string>();
                for (int row = 0; row < Words.Count; row++)
                {
                    string text = Words.At(row);
                    // A row of placeholders and signs alone (a date's order) would own anything, and so would one
                    // Latin letter. One character is a whole word in Chinese, Japanese and Korean.
                    string letters = System.Text.RegularExpressions.Regex.Replace(text, @"\{\d+\}|" + Signs, "");
                    if (letters.Length < (letters.Any(c => c >= '\u2e80') ? 1 : 2)) continue;
                    rows.Add(System.Text.RegularExpressions.Regex.Replace(System.Text.RegularExpressions.Regex.Escape(text), @"\\\{\d+}", ".+?"));
                }
                rows.AddRange(Words.Names.Select(System.Text.RegularExpressions.Regex.Escape));
                // A wallet address, cut short as the pages show it, is the player's.
                rows.Add("[1-9A-HJ-NP-Za-km-z]{3,6}…[1-9A-HJ-NP-Za-km-z]{3,6}");
                owned = new System.Text.RegularExpressions.Regex("^(?:" + string.Join("|", rows.OrderByDescending(row => row.Length)) + "|" + Signs + ")+$",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant |
                    System.Text.RegularExpressions.RegexOptions.Singleline, System.TimeSpan.FromSeconds(2));
                ownedLanguage = Words.Language;
            }
            foreach (var label in page.GetComponentsInChildren<TMP_Text>())
            {
                if (!label.isActiveAndEnabled || string.IsNullOrWhiteSpace(label.text) || label.color.a < .01f) continue;
                string text = System.Text.RegularExpressions.Regex.Replace(label.text, "<[^>]+>", "");
                foreach (string word in known.Where(word => !string.IsNullOrEmpty(word))) text = text.Replace(word, " ");
                bool mine;
                try { mine = owned.IsMatch(text); } catch (System.Text.RegularExpressions.RegexMatchTimeoutException) { mine = false; }
                // A chip sets one phrase round its number: its parts are that phrase's.
                if (!mine && (label.name.EndsWith(" words") || label.name.EndsWith(" lead")))
                    mine = Enumerable.Range(0, Words.Count).Any(row => Words.At(row).IndexOf(text.Trim(), System.StringComparison.OrdinalIgnoreCase) >= 0);
                if (!mine) yield return Words.Code + " " + at + ": \"" + label.text.Replace("\n", " / ") + "\" (" + label.name + ") is not the catalogue's";
            }
        }

        // A page of the shell: its labels, and that it scrolls no more than it does in English.
        public static IEnumerable<string> Faults(PageShell shell, float scale, string at)
        {
            Canvas.ForceUpdateCanvases();
            // The phones are simulated at one pixel a dp.
            const float density = 1;
            foreach (string fault in Faults(shell, shell.ScreenArea, density, scale, at)) yield return fault;
            bool scrolls = shell.Scroll.content.rect.height > shell.Viewport.rect.height + .5f;
            if (Words.Language == 0) englishScrolls[at] = scrolls;
            else if (scrolls && englishScrolls.TryGetValue(at, out bool english) && !english)
                yield return Words.Code + " " + at + ": the page scrolls, and it does not in English";
        }
    }
}
