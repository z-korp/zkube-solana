using System.Globalization;
using NUnit.Framework;
using UnityEngine;
using ZKube.Local.App;

namespace ZKube.Tests
{
    public sealed class ShareLocaleTests
    {
        [Test] public void DefaultCultureFormatsTheScoreWithoutChangingPlayerText()
        {
            var previous = CultureInfo.CurrentCulture;
            try
            {
                CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
                Assert.That(StoreShareText.Build("A\u00a0B", "Mako", "Tiki", "Combo", "10000", 10000, 1),
                    Is.EqualTo(Application.productName + " · Daily\nA\u00a0B faced Mako in Tiki. Combo: 10000. Score: " + 10000UL.ToString("N0", CultureInfo.CurrentCulture) + ". 1 day streak."));
            }
            finally { CultureInfo.CurrentCulture = previous; }
        }
        [Test] public void SharePreservesTheCallersPlatformFormatting()
        {
            var culture = (CultureInfo)CultureInfo.GetCultureInfo("ja-JP").Clone();
            culture.NumberFormat.NumberGroupSeparator = "_";
            Assert.That(StoreShareText.Build("A", "Mako", "Tiki", "Combo", "1", 1234567, 1, culture),
                Is.EqualTo(Application.productName + " · Daily\nA faced Mako in Tiki. Combo: 1. Score: 1_234_567. 1 day streak."));
            Assert.That(culture.NumberFormat.NumberGroupSeparator, Is.EqualTo("_"));
        }
    }
}
