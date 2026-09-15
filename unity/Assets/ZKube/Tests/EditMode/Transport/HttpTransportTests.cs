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

        [Test]
        public async Task AStalledResponseBodyTimesOutAfterSuccessfulHeadersAndDisposesTheStream()
        {
            var handler = new ResponseHandler();
            using var transport = new HttpClientJsonRpc(handler, TimeSpan.FromMilliseconds(50));
            Exception failure = null;
            try { await transport.Post(new Uri("https://fixture.invalid/"), "{}", 1024, default); }
            catch (Exception error) { failure = error; }
            Assert.That(failure, Is.InstanceOf<OperationCanceledException>());
            Assert.That(handler.Body.ReadStarted, Is.True);
            Assert.That(handler.Body.Disposed, Is.True);
        }
    }
}
