using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using NUnit.Framework;

namespace ZKube.Integration.Transport.Tests
{
    public sealed class HttpTransportTests
    {
        private sealed class StalledStream : Stream
        {
            public bool ReadStarted, Disposed;
            public override bool CanRead => true;
            public override bool CanSeek => false;
            public override bool CanWrite => false;
            public override long Length => throw new NotSupportedException();
            public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
            public override async Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellation)
            { ReadStarted = true; await Task.Delay(Timeout.Infinite, cancellation).ConfigureAwait(false); return 0; }
            protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
            public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
            public override void Flush() => throw new NotSupportedException();
            public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
            public override void SetLength(long value) => throw new NotSupportedException();
            public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        }
        private sealed class ResponseHandler : HttpMessageHandler
        {
            public readonly StalledStream Body = new StalledStream();
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation) =>
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(Body), RequestMessage = request });
        }

        private sealed class RefusingHandler : HttpMessageHandler
        {
            public string Said;
            protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellation) =>
                Task.FromResult(new HttpResponseMessage(HttpStatusCode.ServiceUnavailable) { Content = Said == null ? null : new StringContent(Said), RequestMessage = request });
        }

        // An endpoint that refuses says why in its answer. The start of it reaches
        // the log line: one bounded line, every URL cut to its host and anything
        // long enough to be a key, an address or a transaction removed.
        [Test]
        public async Task ARefusingEndpointsOwnWordsReachTheLogCutAndCleaned()
        {
            string transaction = new string('A', 400);
            var handler = new RefusingHandler { Said = "<html>\n<h1>503 Service Temporarily Unavailable</h1> upstream https://sender.internal:8899/v1?key=secret refused " + transaction + new string('x', 4000) };
            using var transport = new HttpClientJsonRpc(handler, TimeSpan.FromSeconds(5));
            Exception failure = null;
            try { await transport.Post(new Uri("https://fixture.invalid/path?api-key=secret"), "{}", 1024, default); }
            catch (Exception error) { failure = error; }
            Assert.That(failure, Is.InstanceOf<HttpStatusException>()); Assert.That(((HttpStatusException)failure).Status, Is.EqualTo(503));
            var logged = RequestFailure.Of(failure);
            Assert.That(logged.Kind, Is.EqualTo(FailureKind.ServerError)); Assert.That(logged.Status, Is.EqualTo(503));
            StringAssert.StartsWith("HTTP status 503: <html> <h1>503 Service Temporarily Unavailable</h1> upstream sender.internal refused", logged.Message);
            StringAssert.DoesNotContain("secret", logged.Message); StringAssert.DoesNotContain("8899", logged.Message); StringAssert.DoesNotContain("AAAA", logged.Message);
            Assert.That(logged.Message.Length, Is.LessThanOrEqualTo(200));
            // An answer with nothing in it is its status alone.
            handler.Said = null; failure = null;
            try { await transport.Post(new Uri("https://fixture.invalid/"), "{}", 1024, default); }
            catch (Exception error) { failure = error; }
            Assert.That(RequestFailure.Of(failure).Message, Is.EqualTo("HTTP status 503"));
        }

        [Test]
        public async Task AStalledResponseBodyTimesOutAfterSuccessfulHeadersAndDisposesTheStream()
        {
            var handler = new ResponseHandler();
            using var transport = new HttpClientJsonRpc(handler, TimeSpan.FromMilliseconds(50));
            Exception failure = null;
            try { await transport.Post(new Uri("https://fixture.invalid/"), "{}", 1024, default); }
            catch (Exception error) { failure = error; }
            Assert.That(failure, Is.InstanceOf<TimeoutException>(), "A deadline is a timeout, not the caller cancelling");
            Assert.That(RequestFailure.Of(failure).Kind, Is.EqualTo(FailureKind.Timeout));
            Assert.That(handler.Body.ReadStarted, Is.True);
            Assert.That(handler.Body.Disposed, Is.True);
        }
    }
}
