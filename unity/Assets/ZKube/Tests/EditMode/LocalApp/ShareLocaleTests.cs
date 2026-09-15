using System.Globalization;
using NUnit.Framework;
using ZKube.Local.App;

namespace ZKube.Tests
{
    public sealed class ShareLocaleTests
    {
        [Test] public void DefaultCultureUsesTheSameCompatibilityWithoutChangingPlayerText()
        {
            var previous = CultureInfo.CurrentCulture;
            try
            {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
                Assert.That(StoreShareText.Build("A\u00a0B", "Mako", "Tiki", "Combo", "10000", 10000, 1),
                    Is.EqualTo("A\u00a0B faced Mako in Tiki. Combo: 10000. Score: 10\u202f000. 1 day streak."));
            }
            finally { CultureInfo.CurrentCulture = previous; }
        }
        [Test] public void LocaleOutsideMeasuredScopePreservesTheCallersPlatformFormatting()
        {
            var culture = (CultureInfo)CultureInfo.GetCultureInfo("ja-JP").Clone();
            culture.NumberFormat.NumberGroupSeparator = "_";
            Assert.That(StoreShareText.Build("A", "Mako", "Tiki", "Combo", "1", 1234567, 1, culture),
                Is.EqualTo("A faced Mako in Tiki. Combo: 1. Score: 1_234_567. 1 day streak."));
            Assert.That(culture.NumberFormat.NumberGroupSeparator, Is.EqualTo("_"));
        }
    }
}
