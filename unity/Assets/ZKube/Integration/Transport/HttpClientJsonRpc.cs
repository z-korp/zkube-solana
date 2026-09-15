using System;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Integration.Transport
{
    // One reusable HttpClient belongs to the application's lifetime. Responses
    // are bounded while streaming, before allocating/parsing JSON account data.
    public sealed class HttpClientJsonRpc : IJsonRpcHttp, IDisposable
    {
        private readonly HttpClient client;
        private readonly TimeSpan requestTimeout;
        public HttpClientJsonRpc() : this(new HttpClientHandler { AllowAutoRedirect = false }, TimeSpan.FromSeconds(30)) { }

        // Injected handlers provide offline HTTP behavior. Production uses the
        // redirects-disabled handler above to preserve verified route identity.
        public HttpClientJsonRpc(HttpMessageHandler handler, TimeSpan requestTimeout)
        {
            if (handler == null) throw new ArgumentNullException(nameof(handler));
            if (requestTimeout <= TimeSpan.Zero) throw new ArgumentOutOfRangeException(nameof(requestTimeout));
            this.requestTimeout = requestTimeout;
            client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
        }
        public void Dispose() => client.Dispose();
        public async Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation)
        {
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(requestTimeout);
            cancellation = deadline.Token;
            using var request = new HttpRequestMessage(HttpMethod.Post, endpoint) { Content = new StringContent(json, Encoding.UTF8, "application/json") };
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation).ConfigureAwait(false);
            response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > maximumResponseBytes) throw new FormatException("RPC response exceeds its bound");
            using var input = await response.Content.ReadAsStreamAsync().ConfigureAwait(false);
            using var output = new MemoryStream();
            var buffer = new byte[8192];
            int count;
            while ((count = await input.ReadAsync(buffer, 0, buffer.Length, cancellation).ConfigureAwait(false)) > 0)
            {
                if (output.Length + count > maximumResponseBytes) throw new FormatException("RPC response exceeds its bound");
                output.Write(buffer, 0, count);
            }
            return new UTF8Encoding(false, true).GetString(output.ToArray());
        }
    }
}
