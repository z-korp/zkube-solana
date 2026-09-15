using System;
using System.Linq;
using NUnit.Framework;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Local.Tests
{
    public sealed class BoardRealmBindingTests
    {
        [Test]
        public void LocalProvidersBindEveryRealmFromTheirRunView()
        {
            var state = new LocalProductState { CampaignOwned = true, Stars = Enumerable.Repeat((byte)1, 100).ToArray() };
            var client = new LocalRunClient(new LocalProductStore(_ => LocalProductCodec.Encode(state)));
            foreach (var realm in Protocol.Realms)
            {
                var run = client.StartCampaign(realm.MapId, 1);
                var session = new LocalBoardActionProvider(client, run).Bind("");
                Assert.That(session.RealmId, Is.EqualTo(run.View.Realm));
                Assert.That(session.RealmId, Is.EqualTo(realm.MapId));
                CollectionAssert.AreEqual(run.View.Token.State, session.Accepted.State);
                client.Act(run.View.RunId, new LocalRunAction(LocalActionKind.Finish));
            }
        }
        [Test]
        public void SessionRequiresAnExplicitAuthoredIdentityAndNeverGuessesFromRules()
        {
            var client = new LocalRunClient(new LocalProductStore());
            var run = client.StartCampaign(1, 1); var provider = new LocalBoardActionProvider(client, run);
            foreach (byte invalid in new byte[] { 0, 11, 255 })
                Assert.Throws<ArgumentOutOfRangeException>(() => new BoardSession(run.View.Token, run.View.Rules, provider, "", invalid));
            // Synthetic native probes may intentionally reuse the Balam visual
            // composition; a non-unique rules tuple cannot determine identity.
            var first = new BoardSession(run.View.Token, run.View.Rules, provider, "Probe", 1);
            var eighth = new BoardSession(run.View.Token, run.View.Rules, provider, "Probe", 8);
            Assert.That(first.RealmId, Is.EqualTo(1)); Assert.That(eighth.RealmId, Is.EqualTo(8));
            CollectionAssert.AreEqual(first.Accepted.State, eighth.Accepted.State);
        }
    }
}
