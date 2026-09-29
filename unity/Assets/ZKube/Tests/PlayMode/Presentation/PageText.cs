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

        // Every number the page draws (outside a button's label) sits on one line inside its rect.
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
