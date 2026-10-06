using System.Collections;
using System.Linq;
using NUnit.Framework;
using UnityEngine.TestTools;
using ZKube.Integration;
using ZKube.Integration.App.Tests;
using ZKube.Integration.Presentation;
using ZKube.Integration.Transport;

namespace ZKube.Tests.MoneyOverview
{
    // An entry whose send the endpoint does not take.
    public sealed partial class MoneyOverviewTests
    {
        private string[] AskedOf(string endpoint) => environment.Http.Requests.ToArray()
            .Where(request => (string)request["endpoint"] == endpoint).Select(request => (string)request["method"]).ToArray();

        // The owner's evening of 2026-10-06: the cluster's first endpoint answered
        // every entry's send with HTTP 503. The same signed entry goes to the
        // second endpoint, lands, and the board opens; the device signs once and
        // one Kredit is spent, once.
        [UnityTest] public IEnumerator AnEntryTheFirstEndpointRefusesGoesThroughTheSecondAndOpensItsBoard()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Arena");
            string first = environment.Config.BaseUri;
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            environment.Http.Confirmation = null; environment.Http.LandsWhenSent = true;
            environment.Http.Refuse = (endpoint, method) => method == "sendTransaction" && endpoint.AbsoluteUri == first ? new HttpStatusException(503, "no healthy upstream") : null;
            yield return SessionClick("Confirm 1 Kredit"); yield return Idle();
            yield return BoardReady();
            Assert.That(host.GetComponent<MoneyBoardHost>().Board.Session.Daily, Is.True);
            var entries = environment.Http.Requests.ToArray().Where(request => (string)request["method"] == "sendTransaction")
                .Where(request => TransactionSignatures.Describe(System.Convert.FromBase64String((string)request["params"][0])).Instructions
                    .Any(instruction => instruction.ProgramId == environment.Services.Protocol.ProgramId &&
                        environment.Services.Protocol.DecodeInstruction(instruction).Name == "enter_arena")).ToArray();
            CollectionAssert.AreEqual(new[] { first, MoneyTestEnvironment.SecondBase }, entries.Select(request => (string)request["endpoint"]));
            Assert.That((string)entries[1]["params"][0], Is.EqualTo((string)entries[0]["params"][0]), "The same signed bytes, never signed again");
            CollectionAssert.AreEqual(new[] { "getGenesisHash", "sendTransaction" }, AskedOf(MoneyTestEnvironment.SecondBase).Take(2));
            Assert.That(AskedOf(MoneyTestEnvironment.SecondBase).Where(method => method != "getSignatureStatuses").Count(), Is.EqualTo(2),
                "The second endpoint is asked for the send and for that signature, nothing else");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
