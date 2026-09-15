using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using ZKube.Integration.Client;

namespace ZKube.Tests.ProductReads
{
    public sealed partial class ProductReadTests
    {
        [Test] public async Task CampaignBrowseNodesAndRulesMatchActualTypescriptAcrossAllRealms()
        {
            var fixture = JObject.Parse(File.ReadAllText(System.Environment.GetEnvironmentVariable("ZKUBE_CAMPAIGN_BROWSE_FIXTURE_PATH") ?? Path.Combine(Root, "fixtures/unity-campaign-browse-v1.json")));
            foreach (var row in fixture["cases"])
            {
                var e = await Environment.Create(); e.Http.Remove(e.Fixture["accounts"]["player"]);
                foreach (var account in row["accounts"]) e.Http.Put(account);
                var read = await e.Queries.Campaign();
                var local = new ZKube.Local.LocalRunClient(new ZKube.Local.LocalProductStore(), () => 0);
                var saved = row["saved"].Type == JTokenType.Null ? null : local.StartCampaign((byte)row["saved"]["realm"], (byte)row["saved"]["level"]).View;
                var actual = CampaignBrowseProjection.Create(read.Value, saved);
                foreach (var realm in actual.Realms)
                {
                    var expected = row["expected"][realm.MapId - 1];
                    Assert.That(realm.ThemeId, Is.EqualTo((byte)expected["themeId"]));
                    Assert.That(realm.CurrentIndex, Is.EqualTo((int)expected["currentIndex"]));
                    Assert.That(realm.Enabled, Is.EqualTo((bool)expected["enabled"])); Assert.That(realm.Unlocked, Is.EqualTo((bool)expected["unlocked"]));
                    foreach (var level in realm.Levels)
                    {
                        var node = expected["levels"][level.Level - 1]; string id = row["id"] + "/" + realm.MapId + "/" + level.Level;
                        Assert.That(level.State, Is.EqualTo((string)node["state"]), id); Assert.That(level.Stars, Is.EqualTo((byte)node["stars"]), id);
                        Assert.That(level.CanInspect, Is.EqualTo((bool)node["canInspect"]), id); Assert.That(level.SavedRules, Is.EqualTo((bool)node["savedRules"]), id);
                        var rules = level.Rules; var wanted = node["rules"];
                        Assert.That(rules.PointsRequired, Is.EqualTo((uint)wanted["pointsRequired"]), id);
                        Assert.That(rules.MaxMoves, Is.EqualTo((ushort)wanted["maxMoves"]), id); Assert.That(rules.FixedTier, Is.EqualTo((byte)wanted["difficulty"]), id);
                        Assert.That(rules.StartingHeight, Is.EqualTo((byte)node["startingRows"]), id);
                        Assert.That(rules.BonusType, Is.EqualTo((byte)node["guardian"]["bonus"]), id);
                        Assert.That(rules.Trigger, Is.EqualTo((byte)node["guardian"]["trigger"]), id);
                        Assert.That(rules.TriggerThreshold, Is.EqualTo((ushort)node["guardian"]["threshold"]), id);
                        Assert.That(new[] { rules.PrimaryKind, rules.PrimaryValue, rules.PrimaryCount, rules.SecondaryKind, rules.SecondaryValue, rules.SecondaryCount },
                            Is.EqualTo(new[] { (byte)wanted["constraintType"], (byte)wanted["constraintValue"], (byte)wanted["constraintCount"], (byte)wanted["constraint2Type"], (byte)wanted["constraint2Value"], (byte)wanted["constraint2Count"] }), id);
                        rules.FixedTier = 99; Assert.That(level.Rules.FixedTier, Is.Not.EqualTo(99), "Preview returns a cloned request");
                    }
                }
            }
        }
        [Test] public async Task CampaignCatalogDoesNotRequireProtocolPublication()
        {
            var e = await Environment.Create();
            e.Http.Remove(e.Fixture["accounts"]["protocol"]);
            Assert.That((await e.Queries.Campaign()).Value.Status, Is.EqualTo("ready"));
        }
    }
}
