using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration.Transport
{
    public sealed class PublicStandingRow
    {
        public uint Rank { get; }
        public string Player { get; }
        public ulong Metric { get; }
        internal PublicStandingRow(uint rank, string player, ulong metric) { Rank = rank; Player = player; Metric = metric; }
    }
    public sealed class PublicStandings
    {
        public uint Total { get; }
        public IReadOnlyList<PublicStandingRow> Rows { get; }
        internal PublicStandings(uint total, PublicStandingRow[] rows) { Total = total; Rows = Array.AsReadOnly(rows); }
    }

    // The public read model: the ranks a finalized board no longer holds. It is
    // never an authority. Its answers are display only, callers check them
    // against the chain's own board, and every failure is one answer: null.
    public sealed class StandingsTransport
    {
        public const int PageRows = 100;
        private static readonly TimeSpan Deadline = TimeSpan.FromSeconds(5);
        private readonly IJsonRpcHttp http;
        private readonly Uri endpoint;
        public StandingsTransport(IJsonRpcHttp http, string endpoint)
        {
            this.http = http ?? throw new ArgumentNullException(nameof(http));
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out this.endpoint) || this.endpoint.Scheme != Uri.UriSchemeHttps ||
                !string.IsNullOrEmpty(this.endpoint.UserInfo) || !string.IsNullOrEmpty(this.endpoint.Query) ||
                !string.IsNullOrEmpty(this.endpoint.Fragment)) throw new FormatException("Invalid standings endpoint");
        }

        // The ranks after `offset` on a finalized day's board, at most PageRows.
        public Task<PublicStandings> Rows(uint day, string kind, uint offset, CancellationToken cancellation) =>
            Read(day, kind, "?offset=" + offset.ToString(CultureInfo.InvariantCulture) + "&limit=" + PageRows, cancellation,
                body => body["rows"] is JArray rows && rows.Count <= PageRows ? rows.Select(Row).ToArray() : throw new FormatException());

        // One wallet's rank on a finalized day's board.
        public Task<PublicStandings> Rank(uint day, string kind, string owner, CancellationToken cancellation) =>
            Read(day, kind, "/players/" + owner, cancellation, body => new[] { Row(body["row"]) });

        private async Task<PublicStandings> Read(uint day, string kind, string suffix, CancellationToken cancellation,
            Func<JObject, PublicStandingRow[]> rows)
        {
            if (kind != "score" && kind != "theme") throw new ArgumentException("Invalid board", nameof(kind));
            using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            deadline.CancelAfter(Deadline);
            try
            {
                var address = new Uri(endpoint, "/v1/days/" + day.ToString(CultureInfo.InvariantCulture) + "/boards/" + kind + suffix);
                var body = JObject.Parse(await http.Get(address, 65536, deadline.Token).ConfigureAwait(false));
                // Only a complete model's view of a day it saw finalized is shown.
                if ((uint)body["dayId"] != day || (string)body["kind"] != kind || body["final"]?.Type != JTokenType.Boolean ||
                    !(bool)body["final"] || body["complete"]?.Type != JTokenType.Boolean || !(bool)body["complete"]) return null;
                return new PublicStandings((uint)body["total"], rows(body));
            }
            catch (Exception) when (!cancellation.IsCancellationRequested) { return null; }
        }

        private static PublicStandingRow Row(JToken row)
        {
            string player = (string)row["owner"]; SolanaAddress.Bytes(player);
            if (row["metric"]?.Type != JTokenType.String) throw new FormatException();
            return new PublicStandingRow((uint)row["rank"], player,
                ulong.Parse((string)row["metric"], NumberStyles.None, CultureInfo.InvariantCulture));
        }
    }
}
