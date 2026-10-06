using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;
using ZKube.Integration.Presentation;
using ZKube.Integration.Transport;

namespace ZKube.Integration.App.Tests
{
    // One classification of a failed request serves the page's words and the
    // log line. Only a request that never reached anything is the network's.
    public sealed class RequestFailureTests
    {
        private const string Address = "11111111111111111111111111111111";
        private sealed class Http : IJsonRpcHttp
        {
            public Func<string> Answer;
            public Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
            {
                try { return Task.FromResult(Answer()); }
                catch (Exception error) { return Task.FromException<string>(error); }
            }
        }
        // The failure as the Base transport lets it through: marked with what it was asking.
        private static async Task<RequestFailure> Asked(Func<string> answer)
        {
            var rpc = new SolanaRpcTransport(new Http { Answer = answer }, "https://base.invalid/v1/secret-path?api-key=K3Y", "https://router.invalid/", Address, Address);
            try { await rpc.VerifyBase(); }
            catch (Exception error) { return RequestFailure.Of(error); }
            Assert.Fail("The call was meant to fail"); return null;
        }
        private static Func<string> Throws(Exception error) => () => throw error;

        [Test] public async Task EveryKindOfFailureIsToldApartAndOnlyAConnectivityFailureIsTheNetworks()
        {
            var cases = new (Func<string> Answer, FailureKind Kind, string Words)[] {
                (Throws(new TimeoutException("No answer within 30 s")), FailureKind.Timeout, "Solana took too long to answer."),
                (Throws(new HttpStatusException(429)), FailureKind.Busy, "Solana is busy. Try again in a moment."),
                (Throws(new HttpStatusException(403)), FailureKind.Refused, "Solana refused this device’s request."),
                (Throws(new HttpStatusException(503)), FailureKind.ServerError, "Solana is having trouble. Try again."),
                (Throws(new HttpStatusException(404)), FailureKind.HttpError, "Solana answered with an error."),
                (Throws(new HttpRequestException("An error occurred while sending the request", new WebException("Error: NameResolutionFailure", WebExceptionStatus.NameResolutionFailure))),
                    FailureKind.NoNetwork, "The network could not be reached."),
                (Throws(new HttpRequestException("An error occurred while sending the request", new SocketException(111))), FailureKind.NoNetwork, "The network could not be reached."),
                (Throws(new HttpRequestException("An error occurred while sending the request",
                    new WebException("Error: SecureChannelFailure", new AuthenticationException("handshake"), WebExceptionStatus.SecureChannelFailure, null))),
                    FailureKind.Insecure, "Solana could not be reached over a secure connection."),
                (() => "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}", FailureKind.RpcError, "Solana could not handle this request."),
                (() => "<html>gateway</html>", FailureKind.UnreadableReply, "Solana answered in a way this app could not read."),
            };
            foreach (var row in cases)
            {
                var failure = await Asked(row.Answer);
                Assert.That(failure.Kind, Is.EqualTo(row.Kind), row.Words);
                Assert.That(MoneyReceiptText.Refusal(failure), Is.EqualTo(row.Words));
                Assert.That(failure.Host, Is.EqualTo("base.invalid")); Assert.That(failure.Call, Is.EqualTo("getGenesisHash"));
                Assert.That(MoneyReceiptText.Refusal(failure).Contains("network"), Is.EqualTo(row.Kind == FailureKind.NoNetwork), row.Words);
            }
            Assert.That((await Asked(Throws(new HttpStatusException(429)))).Status, Is.EqualTo(429));
            Assert.That((await Asked(() => "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"Method not found\"}}")).Status, Is.EqualTo(-32601));
            // An error nothing was asked for happened on the device, and says so.
            var local = RequestFailure.Of(new InvalidOperationException("Device key was not saved"));
            Assert.That(local.Kind, Is.EqualTo(FailureKind.Local)); Assert.That(local.Host, Is.Null);
            Assert.That(MoneyReceiptText.Refusal(local), Is.EqualTo("This request could not be prepared on this device."));
        }

        [Test] public async Task AFailedRequestLogsOneLineWithItsHostAndNothingOfThePlayers()
        {
            const string key = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", bytes = "AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=";
            var failure = await Asked(Throws(new HttpRequestException(
                "POST https://base.invalid/v1/secret-path?api-key=K3Y failed for " + key + " with\n" + bytes, new IOException("reset"))));
            string line = failure.Line("device setup");
            StringAssert.StartsWith("zKube request failed: action=device setup kind=NoNetwork service=Solana host=base.invalid call=getGenesisHash type=HttpRequestException>IOException", line);
            foreach (string secret in new[] { "secret-path", "api-key", "K3Y", key, bytes, "\n", "https://" }) StringAssert.DoesNotContain(secret, line);
            StringAssert.Contains("POST base.invalid failed for … with …", line);

            // A call's name is printed whole, however long: it is ours, not the player's.
            var rent = new InvalidOperationException("Method not found");
            RequestFailure.Mark(rent, "the game server", new Uri("https://devnet-eu.example/"), "getMinimumBalanceForRentExemption");
            StringAssert.Contains(" host=devnet-eu.example call=getMinimumBalanceForRentExemption ", RequestFailure.Of(rent).Line("vrf-daily"));

            var lines = new System.Collections.Generic.List<string>(); var sink = ClientLog.Sink;
            try
            {
                ClientLog.Sink = lines.Add;
                ClientLog.Failure("read Daily", new HttpStatusException(429));
                ClientLog.Failure("read Daily", new OperationCanceledException("superseded"));
                ClientLog.Outcome("session-renew", "simulation-rejected", "{\"InstructionError\":[0,{\"Custom\":1}]} " + key);
                ClientLog.Sink = _ => throw new InvalidOperationException("log is down");
                ClientLog.Failure("read Daily", new HttpStatusException(500));
            }
            finally { ClientLog.Sink = sink; }
            Assert.That(lines.Count, Is.EqualTo(2), "A superseded request is not a failure, and a failing log fails nothing");
            Assert.That(lines[0], Is.EqualTo("zKube request failed: action=read Daily kind=Busy status=429 type=HttpStatusException message=\"HTTP status 429\""));
            Assert.That(lines[1], Is.EqualTo("zKube request failed: action=session-renew code=simulation-rejected chain=\"{'InstructionError':[0,{'Custom':1}]} …\""));
        }
    }
}
