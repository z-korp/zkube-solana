using ZKube.Presentation;
using System.Globalization;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using ZKube.Local.App;

namespace ZKube.Tests
{
    public sealed class StorePagePolishTests
    {
        [TestCase(280f)] [TestCase(320f)]
        public void AuthoredPathsKeepLargeTextTargetsInsideNarrowHighDensityMaps(float logicalWidth)
        {
            const float density = 2.75f, textScale = 1.3f;
            float canvasScale = logicalWidth * density / 430;
            float width = 430 - 52; // Actual store reference width minus safe/content insets.
            float size = BoardLayout.CanvasTouchSize(64 * textScale, density, canvasScale);
            Assert.That(size * canvasScale / density, Is.GreaterThanOrEqualTo(48));
            foreach (var realm in PageCatalog.Load().themes)
            {
                var authored = realm.campaignPath.Select(point => new Vector2(point.x, point.y)).ToArray();
                float height = CampaignPathGraphic.RequiredMapHeight(realm, width, size, 660 * textScale);
                CollectionAssert.AreEqual(authored, realm.campaignPath.Select(point => new Vector2(point.x, point.y)).ToArray());
                var targets = new System.Collections.Generic.List<Rect>();
                foreach (var point in realm.campaignPath)
                {
                    var rect = new Rect(point.x * width - size / 2, (1 - point.y) * height - size / 2, size, size);
                    Assert.That(rect.xMin >= -.01f && rect.xMax <= width + .01f && rect.yMin >= -.01f && rect.yMax <= height + .01f, Is.True, realm.realmName);
                    foreach (var other in targets)
                        Assert.That(Mathf.Min(rect.xMax, other.xMax) - Mathf.Max(rect.xMin, other.xMin) > .01f &&
                            Mathf.Min(rect.yMax, other.yMax) - Mathf.Max(rect.yMin, other.yMin) > .01f, Is.False, realm.realmName + " has overlapping trial targets");
                    targets.Add(rect);
                }
            }
        }
        [Test] public void ImportedPageCatalogContainsEveryPublishedRealmAndObjective()
        {
            var catalog = PageCatalog.Load();
            foreach (var realm in ZKube.Core.Generated.Protocol.Realms)
                Assert.That(catalog.Realm(realm.MapId).campaignPath.Length, Is.EqualTo(realm.Levels.Length));
            foreach (var theme in ZKube.Core.Generated.Protocol.DailyThemes)
                Assert.That(catalog.Objective(theme[0], theme[1]).name, Is.Not.Empty);
        }
        [Test] public void ShareTextAgreesWithTheActualTypescriptShareCardFormatter()
        {
            string path = Path.Combine(Application.dataPath, "../../fixtures/unity-store-share-v1.json");
            foreach (JObject row in JArray.Parse(File.ReadAllText(path)))
                Assert.That(StoreShareText.Build((string)row["name"], (string)row["guardian"], (string)row["realm"],
                    (string)row["objective"], (string)row["total"], (ulong)row["score"], (ulong)row["streak"], CultureInfo.GetCultureInfo((string)row["locale"])),
                    Is.EqualTo((string)row["expected"]));
        }
        [Test] public void AuthoredCurveUsesTheSameMidYControlsAndPreservesEndpoints()
        {
            var from = new Vector2(10, 20); var to = new Vector2(40, 80);
            var first = CampaignPathGraphic.Curve(from, to, 0); var last = CampaignPathGraphic.Curve(from, to, 1);
            Assert.That(first.x, Is.EqualTo(10)); Assert.That(first.y, Is.EqualTo(20));
            Assert.That(last.x, Is.EqualTo(40)); Assert.That(last.y, Is.EqualTo(80));
            var sample = CampaignPathGraphic.Curve(from, to, .25f);
            Assert.That(sample.x, Is.EqualTo(14.6875f)); Assert.That(sample.y, Is.EqualTo(37.8125f));
        }
        [TestCase("cleared", "cleared", "cleared")]
        [TestCase("cleared", "current", "active")]
        [TestCase("cleared", "playing", "active")]
        [TestCase("current", "locked", "locked")]
        [TestCase("playing", "cleared", "locked")]
        public void CurveStateMatchesMapPage(string from, string to, string expected)
            => Assert.That(CampaignPathGraphic.EdgeState(from, to), Is.EqualTo(expected));
    }
}
