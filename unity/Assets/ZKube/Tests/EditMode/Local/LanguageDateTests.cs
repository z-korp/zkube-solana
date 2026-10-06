using System;
using NUnit.Framework;
using ZKube.Core.Generated;

namespace ZKube.Local.Tests
{
    // A date takes the language's own form, the first of a month included: French writes "1er", and the
    // languages that write a bare 1 keep it.
    public sealed class LanguageDateTests
    {
        [TearDown] public void TearDown() => Words.Use("en");

        [Test] public void TheFirstOfTheMonthIsWrittenAsTheLanguageWritesIt()
        {
            var first = new DateTime(2026, 10, 1); var second = new DateTime(2026, 10, 2);
            Words.Use("fr");
            StringAssert.StartsWith("1er ", Words.Date(first));
            StringAssert.Contains(" 1er ", Words.DateWithWeekday(first));
            StringAssert.StartsWith("1er ", Words.DateWithYear(first));
            StringAssert.StartsWith("2 ", Words.Date(second));
            foreach (string code in Words.Codes)
            {
                if (code == "fr") continue;
                Words.Use(code);
                Assert.AreEqual(Words.Date(second).Replace("2", "1"), Words.Date(first), code + " writes a bare 1");
            }
        }
    }
}
