using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace ZKube.Tests.Presentation
{
    // What a page shows the player: the text that is drawn and not faded out.
    // GameObject names are not shown.
    public static class PageText
    {
        public static IEnumerable<TMP_Text> Visible(Component root) =>
            root.GetComponentsInChildren<TMP_Text>().Where(text => text.enabled && !string.IsNullOrEmpty(text.text) && text.color.a > .01f &&
                text.GetComponentsInParent<CanvasGroup>().Aggregate(1f, (alpha, group) => alpha * group.alpha) > .01f);

        // The retired names of the boards and the star sources are never the
        // player's words: the boards are Score and the day's objective, the
        // stars are the level's goals.
        private static readonly Regex jargon = new Regex(@"\b(Theme|Shape|Blow)s?\b");
        public static void AssertPlayerWords(Component root, string page)
        {
            foreach (var text in Visible(root))
                Assert.That(jargon.IsMatch(text.text), Is.False, page + ": \"" + text.text + "\" on " + text.name);
        }

        // Every pill's label sits on one line inside the pill.
        public static void AssertPillLabelsOnOneLine(Component root, string page)
        {
            foreach (var button in root.GetComponentsInChildren<Button>().Where(button => button.GetComponent<Image>()?.sprite is Sprite face &&
                (face.name.StartsWith("button-primary") || face.name.StartsWith("button-secondary"))))
                foreach (var text in Visible(button))
                {
                    text.ForceMeshUpdate();
                    Assert.That(text.textInfo.lineCount, Is.LessThanOrEqualTo(1), page + ": the " + button.name + " label wraps \"" + text.text + "\"");
                    Assert.That(text.preferredWidth, Is.LessThanOrEqualTo(text.rectTransform.rect.width + 1), page + ": the " + button.name + " label overflows");
                }
        }

        // Every number the page draws (outside a button's label) sits on one line inside its rect.
        // A count in running text (a sentence in the caption or body face) is
        // written by NumberFit.Figure: never a figure longer than "9,999,999".
        public static void AssertRunningTextFigures(Component root, string page, params TMP_FontAsset[] sentences)
        {
            foreach (var text in Visible(root).Where(text => sentences.Contains(text.font) && text.text.Any(char.IsLetter)))
                foreach (Match figure in Regex.Matches(Regex.Replace(text.text, "<[^>]+>", ""), @"\d[\d,]*"))
                    Assert.That(figure.Value.Count(char.IsDigit), Is.LessThanOrEqualTo(7),
                        page + ": '" + text.text + "' carries a figure NumberFit.Figure would shorten");
        }
        public static void AssertNumbersOnOneLine(Component root, TMP_FontAsset numbers, string page)
        {
            foreach (var text in Visible(root).Where(text => text.font == numbers && text.GetComponentInParent<Button>() == null &&
                text.text.Any(char.IsDigit)))
            {
                text.ForceMeshUpdate();
                Assert.That(text.textInfo.lineCount, Is.LessThanOrEqualTo(1), page + ": " + text.name + " wraps \"" + text.text + "\"");
                Assert.That(text.preferredWidth, Is.LessThanOrEqualTo(text.rectTransform.rect.width + 1), page + ": " + text.name + " overflows \"" + text.text + "\"");
            }
        }
    }
}
