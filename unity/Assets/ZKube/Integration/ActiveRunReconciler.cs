using System;
using System.Linq;
using Newtonsoft.Json.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration
{
    public sealed class ActiveRunReconciler
    {
        private readonly AccountBindings accounts;
        public ActiveRunReconciler(AccountBindings accounts) { this.accounts = accounts; }

        public CoreRunToken Reconcile(AccountEnvelope envelope, string authority)
        {
            var account = accounts.ActiveRun(envelope, authority);
            string lifecycle = Variant(account["lifecycle"]);
            var config = Configuration(account);
            string reason = account["finish_reason"].Type == JTokenType.Null ? null : Variant(account["finish_reason"]);
            byte endReason = lifecycle == "LevelComplete" && reason == null ? (byte)1
                : lifecycle != "Finished" ? (reason == null ? (byte)0 : (byte)255)
                : reason == null ? (byte)2 : reason == "Abandon" ? (byte)3 : reason == "Deadline" ? (byte)4 : (byte)255;
            var snapshot = new ReconcileRequest {
                Phase = (byte)Phase(lifecycle), EndReason = endReason,
                BonusType = (byte)account["bonus_type"], BonusCharges = (byte)account["bonus_charges"],
                RerollCharges = (byte)account["reroll_charges"], ComboCounter = (byte)account["combo_counter"],
                MaxCombo = (byte)account["max_combo"], PrimaryProgress = (byte)account["primary_progress"],
                SecondaryProgress = (byte)account["secondary_progress"], LatchedStarSources = (byte)account["latched_star_sources"],
                Streak = (byte)account["streak"], ChargesEarned = (byte)account["charges_earned"],
                CurrentTier = (byte)account["current_tier"], LevelLinesCleared = (ushort)account["level_lines_cleared"],
                Moves = (ushort)account["moves"], ActionCounter = (uint)account["action_counter"],
                VrfRequestCounter = (uint)account["vrf_request_counter"], PendingVrfCounter = (uint)account["pending_vrf_counter"],
                Score = (uint)account["score"], DailyScore = (uint)account["daily_score"],
                ObjectiveTotal = (ulong)account["objective_total"], PressureScore = (uint)account["pressure_score"],
                Grid = Bytes(account["grid"]), HasNextRow = (byte)((bool)account["has_next_row"] ? 1 : 0),
                NextRow = (bool)account["has_next_row"] ? Bytes(account["next_row"]) : new byte[8],
                ReplayHash = Bytes(account["replay_hash"]),
            };
            return NativeEngine.Reconcile(config, snapshot);
        }

        // The replay seed here is the observed snapshot's replay anchor. A chain
        // snapshot does not expose the original run opening commitment.
        public BuildConfigRequest BuildConfiguration(AccountEnvelope envelope, string authority) =>
            Configuration(accounts.ActiveRun(envelope, authority));

        public byte RealmId(AccountEnvelope envelope, string authority)
        {
            byte realm = (byte)accounts.ActiveRun(envelope, authority)["map_id"];
            if (!Protocol.Realms.Any(value => value.MapId == realm)) throw new FormatException("ActiveRun has no authored realm");
            return realm;
        }

        public long DeadlineAt(AccountEnvelope envelope, string authority) =>
            (long)accounts.ActiveRun(envelope, authority)["deadline_at"];

        private static BuildConfigRequest Configuration(JObject account)
        {
            string mode = Variant(account["mode"]);
            bool campaign = mode == "Campaign";
            if (!campaign && mode != "Daily") throw new FormatException("Invalid ActiveRun mode");
            var rules = account["rules"];
            byte level = (byte)account["level"], tier = (byte)rules["difficulty"];
            if (campaign && (level < 1 || level > Protocol.CampaignTargets.Length ||
                (uint)rules["points_required"] != Protocol.CampaignTargets[level - 1]))
                throw new FormatException("Campaign score target does not match the protocol ladder");
            return new BuildConfigRequest {
                RulesHash = Bytes(account["rules_hash"]), InitialReplay = Bytes(account["replay_hash"]),
                MaxMoves = campaign ? NativeEngine.CampaignMoveBudget(level, tier) : checked((ushort)Protocol.DailyMaxMoves),
                BonusType = (byte)rules["guardian"]["bonus"], Trigger = (byte)rules["guardian"]["trigger"],
                TriggerThreshold = (ushort)rules["guardian"]["threshold"], StartingHeight = (byte)rules["starting_rows"],
                TierPolicy = (byte)(campaign ? 0 : 1), FixedTier = campaign ? tier : (byte)0,
                PointsRequired = campaign ? (uint)rules["points_required"] : 0,
                PrimaryKind = campaign ? (byte)rules["primary"]["kind"] : (byte)0,
                PrimaryValue = campaign ? (byte)rules["primary"]["value"] : (byte)0,
                PrimaryCount = campaign ? (byte)rules["primary"]["required_count"] : (byte)0,
                SecondaryKind = campaign ? (byte)rules["secondary"]["kind"] : (byte)0,
                SecondaryValue = campaign ? (byte)rules["secondary"]["value"] : (byte)0,
                SecondaryCount = campaign ? (byte)rules["secondary"]["required_count"] : (byte)0,
                ObjectiveKind = campaign ? (byte)0 : (byte)account["daily_theme"]["kind"],
                ObjectiveValue = campaign ? (byte)0 : (byte)account["daily_theme"]["value"],
            };
        }

        private static CorePhase Phase(string lifecycle)
        {
            switch (lifecycle)
            {
                case "Prepared": case "Delegated": case "AwaitingVrf": return CorePhase.AwaitingVrf;
                case "Playing": return CorePhase.Playing;
                case "LevelComplete": return CorePhase.LevelComplete;
                case "Finished": return CorePhase.Finished;
                default: throw new FormatException("Invalid ActiveRun lifecycle");
            }
        }
        private static string Variant(JToken token) => ((JObject)token).Properties().Single().Name;
        private static byte[] Bytes(JToken token) => token.Values<byte>().ToArray();
    }
}
