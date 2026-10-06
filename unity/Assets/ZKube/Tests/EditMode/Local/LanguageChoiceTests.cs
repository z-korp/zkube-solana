using System;
using System.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Local.Tests
{
    // The app starts in the device's language when the catalogue has it. A language added to the catalogue and
    // not to this choice would be reachable from Settings alone, and its speakers would start in English.
    public sealed class LanguageChoiceTests
    {
        [Test] public void EveryLanguageOfTheCatalogueIsSomeDevicesLanguage()
        {
            var chosen = Enum.GetValues(typeof(SystemLanguage)).Cast<SystemLanguage>().Select(AppPreferences.LanguageOf).Distinct().ToArray();
            Assert.That(chosen, Is.EquivalentTo(Words.Codes), "each language of the catalogue, and no other, is some device's language");
            Assert.AreEqual("en", AppPreferences.LanguageOf(SystemLanguage.Unknown));
            Assert.AreEqual("pt-BR", AppPreferences.LanguageOf(SystemLanguage.Portuguese));
            Assert.AreEqual("zh-Hans", AppPreferences.LanguageOf(SystemLanguage.ChineseSimplified));
            foreach (string code in chosen) Assert.AreEqual(code, Words.Codes[Words.Find(code)], code);
        }
    }
}
