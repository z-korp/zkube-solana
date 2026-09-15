using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class ProvisionalRow
    {
        private readonly byte[] replay;
        public string Owner { get; }
        public string Source { get; }
        public uint Rank { get; }
        public ulong RunId { get; }
        public uint Score { get; }
        public ulong ObjectiveTotal { get; }
        public ulong Metric { get; }
        public long FinalizedAt { get; }
        public byte[] ReplayHash => (byte[])replay.Clone();
        internal ProvisionalRow(string source, string owner, string kind, JObject fields, uint rank)
        {
            var best = fields[kind + "_best_entry"];
            Owner = owner; Source = source; Rank = rank; RunId = (ulong)fields[kind + "_best_run_id"];
            Score = (uint)best["score"]; ObjectiveTotal = (ulong)best["objective_total"];
            Metric = kind == "score" ? Score : ObjectiveTotal; FinalizedAt = (long)best["finalized_at"];
            replay = best["replay_hash"].Values<byte>().ToArray();
            if (Metric == 0 || RunId == 0 || FinalizedAt < 0 || FinalizedAt > 9007199254740991L || replay.Length != 32)
                throw new FormatException("ArenaPlayer qualified best is invalid");
        }
        private ProvisionalRow(ProvisionalRow source, uint rank)
        { Owner = source.Owner; Source = source.Source; Rank = rank; RunId = source.RunId; Score = source.Score;
            ObjectiveTotal = source.ObjectiveTotal; Metric = source.Metric; FinalizedAt = source.FinalizedAt; replay = source.ReplayHash; }
        internal ProvisionalRow Ranked(uint rank) => new ProvisionalRow(this, rank);
    }

    public sealed class ProvisionalBoards
    {
        public uint DayId { get; }
        public ulong Slot { get; }
        // Only complete-provisional exposes ranks. Other states never return a
        // prefix presented as the entire board. These rows have no claim status.
        public string Status { get; }
        public bool Complete => Status == "complete-provisional";
        public uint ScoreQualifiedCount { get; }
        public uint ThemeQualifiedCount { get; }
        public uint RetainedCapacity => ClientPolicy.ArenaBoardCapacity;
        public IReadOnlyList<ProvisionalRow> Score { get; }
        public IReadOnlyList<ProvisionalRow> Theme { get; }
        public ProvisionalStanding ScoreStanding { get; }
        public ProvisionalStanding ThemeStanding { get; }
        internal ProvisionalBoards(uint day, ulong slot, string status,
            ProvisionalRow[] score = null, ProvisionalRow[] theme = null, uint scoreCount = 0, uint themeCount = 0,
            ProvisionalStanding scoreStanding = null, ProvisionalStanding themeStanding = null)
        { DayId = day; Slot = slot; Status = status; Score = Array.AsReadOnly(score ?? Array.Empty<ProvisionalRow>());
            Theme = Array.AsReadOnly(theme ?? Array.Empty<ProvisionalRow>()); ScoreQualifiedCount = scoreCount; ThemeQualifiedCount = themeCount;
            ScoreStanding = scoreStanding; ThemeStanding = themeStanding; }
    }

    public sealed class ProvisionalStanding
    {
        public bool Qualified => Entry != null;
        public uint? Rank => Entry?.Rank;
        public ProvisionalRow Entry { get; }
        internal ProvisionalStanding(ProvisionalRow entry) { Entry = entry; }
    }

    public sealed partial class ProductQueries
    {
        public Task<ProductRead<ProvisionalBoards>> CurrentProvisionalBoards(CancellationToken cancellation = default) => Read(cancellation, async (lease, token) => {
            uint day = CurrentDay(Clock());
            string[] observed = { addresses.ProtocolAddress, addresses.ArcadeAddress, addresses.Daily(day),
                addresses.ArenaPlayer(addresses.Daily(day), lease.Owner) };
            var before = await rpc.ReadAccounts(rpc.Base, observed, cancellation: token).ConfigureAwait(false);
            if (before.Accounts.Take(2).Any(item => item.Envelope == null)) return new ProvisionalBoards(day, before.Slot, "missing-config");
            var protocol = accounts.ProtocolConfig(before.Accounts[0].Envelope);
            var arcade = accounts.ArcadeConfig(before.Accounts[1].Envelope);
            if ((bool)protocol["paused"]) return new ProvisionalBoards(day, before.Slot, "paused");
            if (day < (uint)arcade["suspended_until_day"]) return new ProvisionalBoards(day, before.Slot, "suspended");
            if (before.Accounts[2].Envelope == null) return new ProvisionalBoards(day, before.Slot, "missing-daily");
            var daily = accounts.ArenaDaily(before.Accounts[2].Envelope, day);
            ValidateDailyPublication(daily, protocol, day);
            string status = DailyStatus(daily, Clock());
            if (status != "open" && status != "frozen") return new ProvisionalBoards(day, before.Slot, status);
            uint scoreCount = (uint)daily["score_qualified_players"], themeCount = (uint)daily["theme_qualified_players"];
            if (scoreCount > SolanaRpcTransport.MaximumArenaPlayerAccounts || themeCount > SolanaRpcTransport.MaximumArenaPlayerAccounts)
                return new ProvisionalBoards(day, before.Slot, "reference-scan-limit");
            var viewerEnvelope = before.Accounts[3].Envelope;
            var viewer = viewerEnvelope == null ? null : accounts.ArenaPlayer(viewerEnvelope, day, lease.Owner);
            var score = new TopRows("score", viewerEnvelope, viewer); var theme = new TopRows("theme", viewerEnvelope, viewer);
            bool viewerSeen = false, viewerChanged = false;
            ulong scanSlot = await rpc.ReadArenaPlayers(accounts, day, before.Slot, (envelope, fields) => {
                if ((string)fields["player"] == lease.Owner) { viewerSeen = true; viewerChanged = !JToken.DeepEquals(fields, viewer); }
                score.Add(envelope, fields); theme.Add(envelope, fields);
            }, token).ConfigureAwait(false);
            var after = await rpc.ReadAccounts(rpc.Base, observed, minContextSlot: scanSlot, cancellation: token).ConfigureAwait(false);
            if (CurrentDay(Clock()) != day || viewerChanged || after.Accounts.Where((item, i) => !SameObservation(item.Envelope, before.Accounts[i].Envelope)).Any())
                return new ProvisionalBoards(day, after.Slot, "changed");
            // Qualification increments atomically with the first positive best.
            // Require complete qualified sets; missing unqualified accounts do
            // not affect either ranking. Account closure starts after settlement.
            if (score.Count != scoreCount || theme.Count != themeCount || (!viewerSeen && (score.ViewerQualified || theme.ViewerQualified)))
                return new ProvisionalBoards(day, scanSlot, "incomplete");
            return new ProvisionalBoards(day, scanSlot, "complete-provisional", score.Ranked(), theme.Ranked(), score.Count, theme.Count, score.Standing(), theme.Standing());
        });

        private static bool SameObservation(AccountEnvelope left, AccountEnvelope right) => left == null || right == null ? left == right
            : left.Address == right.Address && left.Owner == right.Owner && left.Executable == right.Executable && left.Data.SequenceEqual(right.Data);

        private sealed class TopRows
        {
            private readonly string kind;
            private readonly ProvisionalRow viewer;
            private uint beforeViewer;
            private readonly SortedSet<ProvisionalRow> rows = new SortedSet<ProvisionalRow>(Comparer<ProvisionalRow>.Create(Compare));
            public uint Count { get; private set; }
            public bool ViewerQualified => viewer != null;
            public TopRows(string kind, AccountEnvelope envelope, JObject fields)
            { this.kind = kind; if (fields != null && (bool)fields["has_" + kind + "_best"])
                viewer = new ProvisionalRow(envelope.Address, (string)fields["player"], kind, fields, 0); }
            public void Add(AccountEnvelope envelope, JObject fields)
            {
                if (!(bool)fields["has_" + kind + "_best"]) return;
                var row = new ProvisionalRow(envelope.Address, (string)fields["player"], kind, fields, 0);
                if (viewer != null && Compare(row, viewer) < 0) beforeViewer = checked(beforeViewer + 1);
                Count = checked(Count + 1); rows.Add(row);
                if (rows.Count > ClientPolicy.ArenaBoardCapacity) rows.Remove(rows.Max);
            }
            public ProvisionalRow[] Ranked() => rows.Select((row, index) => row.Ranked(checked((uint)index + 1))).ToArray();
            public ProvisionalStanding Standing() => new ProvisionalStanding(viewer?.Ranked(checked(beforeViewer + 1)));
            // Keeper compareBoardSources: descending metric, earlier finalize,
            // then ascending raw wallet bytes (never base58 string collation).
            private static int Compare(ProvisionalRow left, ProvisionalRow right)
                => BoardOrder.Compare(left.Metric, left.FinalizedAt, left.Owner, right.Metric, right.FinalizedAt, right.Owner);
        }
    }
}
