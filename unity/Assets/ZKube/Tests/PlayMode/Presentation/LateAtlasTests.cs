using System.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.U2D;

namespace ZKube.Presentation.Tests
{
    // The atlases are late-binding: a request Unity makes by an atlas's tag is
    // answered with that same atlas, for every atlas the build carries.
    public sealed class LateAtlasTests
    {
        [Test] public void EveryAtlasAnswersUnitysRequestByItsTag()
        {
            var atlases = Resources.LoadAll<SpriteAtlas>("ZKube/Atlases");
            Assert.That(atlases, Is.Not.Empty);
            foreach (var atlas in atlases)
                Assert.That(BoardArt.LateAtlas(atlas.tag), Is.SameAs(atlas), atlas.tag + " answers its own request");
        }
    }
}
