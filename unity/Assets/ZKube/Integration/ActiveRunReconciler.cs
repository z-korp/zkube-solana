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
            byte endReason = lifecycle != "Finished" ? (reason == null ? (byte)0 : (byte)255)
                : reason == null ? (byte)2 : reason == "Abandon" ? (byte)3 : reason == "Deadline" ? (byte)4 : (byte)255;
            var snapshot = new ReconcileRequest {
                Phase = (byte)Phase(lifecycle), EndReason = endReason,
                BonusType = (byte)account["bonus_type"], BonusCharges = (byte)account["bonus_charges"],
                RerollCharges = (byte)account["reroll_charges"], ComboCounter = (byte)account["combo_counter"],
                MaxCombo = (byte)account["max_combo"], PrimaryProgress = 0,
                SecondaryProgress = 0, LatchedStarSources = 0,
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
            var rules = account["rules"];
            return new BuildConfigRequest {
                RulesHash = Bytes(account["rules_hash"]), InitialReplay = Bytes(account["replay_hash"]),
                MaxMoves = checked((ushort)Protocol.DailyMaxMoves),
                BonusType = (byte)rules["guardian"]["bonus"], Trigger = (byte)rules["guardian"]["trigger"],
                TriggerThreshold = (ushort)rules["guardian"]["threshold"], StartingHeight = (byte)rules["starting_rows"],
                TierPolicy = 1,
                ObjectiveKind = (byte)account["daily_theme"]["kind"],
                ObjectiveValue = (byte)account["daily_theme"]["value"],
            };
        }

        private static CorePhase Phase(string lifecycle)
        {
            switch (lifecycle)
            {
                case "Prepared": case "Delegated": case "AwaitingVrf": return CorePhase.AwaitingVrf;
                case "Playing": return CorePhase.Playing;
                case "Finished": return CorePhase.Finished;
                default: throw new FormatException("Invalid ActiveRun lifecycle");
            }
        }
        private static string Variant(JToken token) => ((JObject)token).Properties().Single().Name;
        private static byte[] Bytes(JToken token) => token.Values<byte>().ToArray();
    }
}
