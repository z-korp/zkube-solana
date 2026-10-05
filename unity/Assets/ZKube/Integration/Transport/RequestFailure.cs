using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Text.RegularExpressions;

namespace ZKube.Integration.Transport
{
    public enum FailureKind { Timeout, NoNetwork, Insecure, Busy, Refused, ServerError, HttpError, RpcError, UnreadableReply, Local }

    // A non-success HTTP answer, with its status kept as a number.
    public sealed class HttpStatusException : HttpRequestException
    {
        public int Status { get; }
        public HttpStatusException(int status) : base("HTTP status " + status) { Status = status; }
    }

    // What went wrong with one request, in the terms a page and a log line need:
    // the kind of failure, the service and host that were asked (never a path,
    // a query, a key or an address), the call, and the exception's own words
    // with every URL cut to its host and every address or byte string removed.
    // The one owner of that classification: pages word it, the log prints it.
    public sealed class RequestFailure
    {
        public FailureKind Kind { get; }
        // "Solana", "the game server", "the leaderboard", "the name service"; null when no service was asked.
        public string Service { get; }
        public string Host { get; }
        public string Call { get; }
        public int? Status { get; }
        public string Type { get; }
        public string Message { get; }
        private RequestFailure(FailureKind kind, string service, string host, string call, int? status, string type, string message)
        { Kind = kind; Service = service; Host = host; Call = call; Status = status; Type = type; Message = message; }

        // A transport marks the exception it lets through with what it was asking,
        // from an exception filter that never catches, so the exception keeps its type and stack.
        public static bool Mark(Exception error, string service, Uri endpoint, string call)
        {
            if (error.Data.Contains("zkube.host")) return false;
            error.Data["zkube.service"] = service; error.Data["zkube.host"] = endpoint?.Host; error.Data["zkube.call"] = call;
            return false;
        }

        public static RequestFailure Of(Exception error)
        {
            if (error == null) throw new ArgumentNullException(nameof(error));
            string service = null, host = null, call = null, types = null;
            FailureKind? kind = null; int? status = null;
            int depth = 0;
            for (var at = error; at != null && depth < 8; at = at is AggregateException many && many.InnerExceptions.Count > 0 ? many.InnerExceptions[0] : at.InnerException, depth++)
            {
                types = types == null ? at.GetType().Name : types + ">" + at.GetType().Name;
                if (host == null && at.Data.Contains("zkube.host"))
                { service = at.Data["zkube.service"] as string; host = at.Data["zkube.host"] as string; call = at.Data["zkube.call"] as string; }
                if (kind.HasValue) continue;
                switch (at)
                {
                    case TimeoutException _: kind = FailureKind.Timeout; break;
                    case HttpStatusException http:
                        status = http.Status;
                        kind = http.Status == 429 ? FailureKind.Busy : http.Status == 401 || http.Status == 403 ? FailureKind.Refused :
                            http.Status >= 500 ? FailureKind.ServerError : FailureKind.HttpError;
                        break;
                    case RpcFailure rpc: kind = FailureKind.RpcError; status = rpc.Code >= int.MinValue && rpc.Code <= int.MaxValue ? (int)rpc.Code : (int?)null; break;
                    case AuthenticationException _: kind = FailureKind.Insecure; break;
                    case WebException web:
                        if (web.Status == WebExceptionStatus.Timeout) kind = FailureKind.Timeout;
                        else if (web.Status == WebExceptionStatus.SecureChannelFailure || web.Status == WebExceptionStatus.TrustFailure) kind = FailureKind.Insecure;
                        else if (web.InnerException == null) kind = FailureKind.NoNetwork;
                        break;
                    case SocketException _: kind = FailureKind.NoNetwork; break;
                    case IOException _ when at.InnerException == null && error is HttpRequestException: kind = FailureKind.NoNetwork; break;
                }
            }
            // A request that never got an answer and names nothing more precise is the network's;
            // an answer nobody could read is the service's; anything else happened on this device.
            kind ??= error is HttpRequestException ? FailureKind.NoNetwork :
                host != null && (error is FormatException || error is Newtonsoft.Json.JsonException) ? FailureKind.UnreadableReply : FailureKind.Local;
            return new RequestFailure(kind.Value, service, host, call, status, types, Clean(error.Message));
        }

        private static readonly Regex Url = new Regex(@"[a-zA-Z][a-zA-Z0-9+.-]*://([^\s/?#""'<>:@]+)[^\s""'<>]*", RegexOptions.Compiled);
        private static readonly Regex Opaque = new Regex(@"[A-Za-z0-9+/=_-]{32,}", RegexOptions.Compiled);
        // Every URL keeps its host only; every run long enough to be an address,
        // a key, a signature or encoded bytes is removed; one bounded line.
        public static string Clean(string text)
        {
            if (string.IsNullOrEmpty(text)) return "";
            text = Url.Replace(text, match => match.Groups[1].Value);
            text = Opaque.Replace(text, "…");
            text = Regex.Replace(text, @"\s+", " ").Trim();
            return text.Length <= 240 ? text : text.Substring(0, 240) + "…";
        }

        // action is the player's request ("session-renew", "read Daily"); never anything of the player's.
        public string Line(string action) => "zKube request failed: action=" + Clean(action) + " " + Detail;
        public string Detail => "kind=" + Kind +
            (Service == null ? "" : " service=" + Service.Replace(' ', '-')) + (Host == null ? "" : " host=" + Clean(Host)) +
            (Call == null ? "" : " call=" + Call) + (Status.HasValue ? " status=" + Status.Value : "") +
            " type=" + Type + " message=\"" + Message.Replace("\"", "'") + "\"";
    }

    // The client's one log sink for failed requests. The application points it
    // at its log at start; it prints nothing before that. A line is a
    // RequestFailure's, or an outcome's code with its cleaned chain error.
    public static class ClientLog
    {
        public static Action<string> Sink = _ => { };
        public static void Failure(string action, Exception error)
        {
            if (error is OperationCanceledException && !(error is TimeoutException)) return;
            try { Sink(RequestFailure.Of(error).Line(action)); } catch (Exception) { /* Logging never fails a request. */ }
        }
        // A request's outcome: its action, outcome and code, then what stopped it
        // (the failed call, the chain's error, or what a wallet changed). The
        // evidence of a changed message is built only from counts, program IDs
        // and yes/no facts, and is printed as it is.
        public static void Result(string action, string outcome, string code, RequestFailure failure, string chainError, string walletChange)
        {
            try { Sink("zKube request failed: action=" + RequestFailure.Clean(action ?? "-") + " outcome=" + outcome + " code=" + RequestFailure.Clean(code ?? "-") +
                (failure == null ? "" : " " + failure.Detail) +
                (chainError == null ? "" : " chain=\"" + RequestFailure.Clean(chainError).Replace("\"", "'") + "\"") +
                (walletChange == null ? "" : " evidence=\"" + walletChange + "\"")); }
            catch (Exception) { /* Logging never fails a request. */ }
        }
        // How long a sent transaction takes to settle, for the device log: the
        // send itself, the first status seen, the settled outcome with the number
        // of checks it took, and the page showing it. Times are from the send;
        // a line names the action and never the signature.
        private sealed class Sent { public System.Diagnostics.Stopwatch Clock; public string Action; public int Checks; public bool Seen, Settled; }
        private static readonly System.Collections.Generic.Dictionary<string, Sent> sent = new System.Collections.Generic.Dictionary<string, Sent>();
        private static void Timing(string signature, Func<Sent, string> line, bool forget = false)
        {
            try
            {
                string text;
                lock (sent)
                {
                    if (signature == null || !sent.TryGetValue(signature, out var entry)) return;
                    text = line(entry);
                    if (forget && text != null) sent.Remove(signature);
                }
                if (text != null) Sink("zKube timing: action=" + text);
            }
            catch (Exception) { /* Logging never fails a request. */ }
        }
        public static void Sending(string signature, string action)
        {
            lock (sent)
            {
                if (sent.Count >= 8) sent.Clear();
                sent[signature] = new Sent { Clock = System.Diagnostics.Stopwatch.StartNew(), Action = RequestFailure.Clean(action) };
            }
        }
        public static void SentIn(string signature) => Timing(signature, entry => entry.Action + " sent=+" + entry.Clock.ElapsedMilliseconds + "ms");
        public static void Status(string signature, string seen) => Timing(signature, entry => {
            entry.Checks++;
            if (entry.Seen) return null;
            entry.Seen = true; return entry.Action + " first-status=+" + entry.Clock.ElapsedMilliseconds + "ms seen=" + seen;
        });
        public static void Settled(string signature, string outcome) => Timing(signature, entry => {
            if (entry.Settled) return null;
            entry.Settled = true; return entry.Action + " settled=+" + entry.Clock.ElapsedMilliseconds + "ms outcome=" + outcome + " checks=" + entry.Checks;
        });
        public static void Shown(string signature) => Timing(signature, entry => entry.Settled ? entry.Action + " shown=+" + entry.Clock.ElapsedMilliseconds + "ms" : null, true);

        public static void Outcome(string action, string code, string chainError)
        {
            try { Sink("zKube request failed: action=" + RequestFailure.Clean(action) + " code=" + RequestFailure.Clean(code) +
                (chainError == null ? "" : " chain=\"" + RequestFailure.Clean(chainError).Replace("\"", "'") + "\"")); }
            catch (Exception) { /* Logging never fails a request. */ }
        }
    }
}
