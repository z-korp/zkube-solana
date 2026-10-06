using System.Collections;
using System.Linq;
using NUnit.Framework;
using TMPro;
using UnityEngine;
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

        private string[] EntriesSent() => environment.Http.Requests.ToArray().Where(request => (string)request["method"] == "sendTransaction")
            .Where(request => TransactionSignatures.Describe(System.Convert.FromBase64String((string)request["params"][0])).Instructions
                .Any(instruction => instruction.ProgramId == environment.Services.Protocol.ProgramId &&
                    environment.Services.Protocol.DecodeInstruction(instruction).Name == "enter_arena"))
            .Select(request => (string)request["params"][0]).ToArray();
        private string[] Texts(string name) => host.GetComponentsInChildren<TMP_Text>().Where(value => value.name == name).Select(value => value.text).ToArray();
        private bool Shows(string text) => host.GetComponentsInChildren<TMP_Text>().Any(value => value.isActiveAndEnabled && value.text.Contains(text));
        // While an entry is on its way the card it was tapped on stays: the Kredit
        // figure the chain last confirmed, and the loader on its button, on every frame.
        private IEnumerator WhileEntering(float seconds, string kredits, System.Func<bool> until = null)
        {
            float limit = Time.realtimeSinceStartup + seconds; bool drawn = false;
            while (Time.realtimeSinceStartup < limit && (until == null || !until()))
            {
                if (Offers("Action progress"))
                {
                    drawn = true;
                    CollectionAssert.AreEquivalent(new[] { "Entering" }, Texts("Action progress label").Distinct());
                    CollectionAssert.AreEquivalent(new[] { kredits }, Texts("Kredit figure number").Distinct(), "The confirmed balance stays in view");
                    Assert.That(Shows("Checking"), Is.False, "Never a bare card");
                }
                yield return null;
            }
            Assert.That(drawn, Is.True, "The loader was on the tapped card");
        }

        // No endpoint takes the entry at first. Its loader stays on the button
        // that was tapped, over the card as the chain last confirmed it; the same
        // signed entry is sent again while its blockhash is valid, and the moment
        // an endpoint takes it the board opens. One entry, one Kredit.
        [UnityTest] public IEnumerator AnEntryNoEndpointTakesAtFirstIsSentAgainFromItsButtonAndOpensItsBoard()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Arena"); Follow(.02f, 30);
            environment.Services.Executor.ResendEvery = System.TimeSpan.FromMilliseconds(50);
            string kredits = Text("Kredit figure number"); bool down = true;
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            environment.Http.Confirmation = null; environment.Http.LandsWhenSent = true;
            environment.Http.Refuse = (endpoint, method) => down && method == "sendTransaction" ? new HttpStatusException(503) : null;
            Click("Confirm 1 Kredit");
            yield return WhileEntering(1.5f, kredits);
            Assert.That(EntriesSent().Length, Is.GreaterThan(2), "Sent again, to both endpoints, while nothing takes it");
            down = false;
            yield return Until(() => !Adapter.isActiveAndEnabled || host.GetComponent<MoneyBoardHost>().HasRun, "The entry landed and its run opened"); yield return Idle();
            yield return BoardReady();
            Assert.That(host.GetComponent<MoneyBoardHost>().Board.Session.Daily, Is.True);
            Assert.That(EntriesSent().Distinct().Count(), Is.EqualTo(1), "One signed entry, however often it was sent");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }

        // Nothing ever takes it. The card keeps its loader and its figures until
        // the blockhash has passed; then it says the entry never landed and that
        // the Kredit is safe, with the same Kredit figure and Enter back on its button.
        [UnityTest] public IEnumerator AnEntryThatNeverLandsSaysSoOnItsCardWithTheKreditFigureUnchanged()
        {
            yield return PrepareDeviceScenario("daily-playable", page: "Arena"); Follow(.02f, 30);
            environment.Services.Executor.ResendEvery = System.TimeSpan.FromMilliseconds(50);
            string kredits = Text("Kredit figure number");
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            environment.Http.Confirmation = null;
            environment.Http.Refuse = (endpoint, method) => method == "sendTransaction" ? new HttpStatusException(503) : null;
            Click("Confirm 1 Kredit");
            yield return WhileEntering(1.5f, kredits);
            yield return ZKube.Tests.Presentation.Captures.Snap(host.GetComponent<ZKube.Presentation.PageShell>(), "entry-on-its-way");
            environment.Http.BlockHeight = 501;
            yield return WhileEntering(15, kredits, () => Shows("It never landed.")); yield return Idle();
            yield return ZKube.Tests.Presentation.Captures.Snap(host.GetComponent<ZKube.Presentation.PageShell>(), "entry-never-landed");
            Assert.That(Text("Daily reason"), Is.EqualTo("It never landed. Your Kredit is safe. Try again."));
            Assert.That(Text("Kredit figure number"), Is.EqualTo(kredits));
            Assert.That(Find("Enter · 1 Kredit").interactable, Is.True, "The way on is the entry itself");
            Assert.That(Offers("Action progress"), Is.False); Assert.That(Shows("Checking"), Is.False);
            Assert.That(Adapter.LastReceipt.Outcome, Is.EqualTo(ZKube.Integration.Execution.ExecutionOutcome.ExpiredReconciled));
            Assert.That(EntriesSent().Distinct().Count(), Is.EqualTo(1));
            // And the entry can be made again: a new transaction, taken this time.
            environment.Http.Refuse = null; environment.Http.BlockHeight = 400; environment.Http.LandsWhenSent = true;
            int sent = EntriesSent().Length;
            yield return SessionClick("Enter · 1 Kredit"); yield return Idle();
            yield return SessionClick("Confirm 1 Kredit"); yield return Idle();
            yield return BoardReady();
            Assert.That(EntriesSent().Length, Is.EqualTo(sent + 1), "Taken at once: sent once");
            Assert.That(environment.ForbiddenCalls, Is.Zero);
        }
    }
}
