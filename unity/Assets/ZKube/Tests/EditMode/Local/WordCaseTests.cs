using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using NUnit.Framework;
using UnityEngine;

namespace ZKube.Local.Tests
{
    // A word's case is written in the catalogue, a language at a time. Code that changes it is wrong in Turkish
    // (i and İ, ı and I), means nothing in Chinese, Japanese and Korean, and follows the device's language on some
    // paths. So no code that draws for a player changes a string's case, by a call or by a text style.
    public sealed class WordCaseTests
    {
        private static readonly Regex ChangesCase = new Regex(
            @"\.ToUpper\w*\(|\.ToLower\w*\(|ToTitleCase|FontStyles\.(UpperCase|LowerCase|SmallCaps)|<(uppercase|lowercase|allcaps|smallcaps)>");
        // Not a player's word: the name of an instruction's enum variant, matched against the program's own.
        private static readonly string[] NotWords = { "Integration/Execution/ExecutionReconciler.Economy.cs" };

        [Test] public void NoCodeChangesTheCaseOfAPlayersWord()
        {
            string root = Path.Combine(Application.dataPath, "ZKube");
            var files = new[] { "Runtime", "Local", "Integration" }.SelectMany(folder => Directory.GetFiles(Path.Combine(root, folder), "*.cs", SearchOption.AllDirectories))
                .Select(path => path.Replace('\\', '/')).Where(path => !NotWords.Any(skipped => path.EndsWith(skipped))).ToArray();
            Assert.That(files.Length, Is.GreaterThan(50), "the player's code is scanned");
            var found = files.SelectMany(path => File.ReadAllLines(path).Select((line, at) => (path, line, at))
                .Where(entry => ChangesCase.IsMatch(entry.line))
                .Select(entry => entry.path.Substring(root.Length + 1) + ":" + (entry.at + 1) + ": " + entry.line.Trim())).ToArray();
            Assert.IsEmpty(found, "Write the case in assets/words instead:\n" + string.Join("\n", found));
        }
    }
}
