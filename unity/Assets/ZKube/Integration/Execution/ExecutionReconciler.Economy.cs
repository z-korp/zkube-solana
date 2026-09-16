using System;
using System.Text;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Client;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Execution
{
    public sealed partial class ExecutionReconciler
    {
        private async Task<bool> ReconcileEconomy(ExecutionReconciliation evidence, DecodedProtocolInstruction call, CancellationToken cancellation)
        {
            if (!evidence.Pending.IsBase) return false;
            if (call.Remaining.Count != 0 || (call.Name != "purchase_kredits" && call.Name != "claim_daily_prize" && call.Name != "set_featured_emblem")) return false;
            string owner = evidence.Pending.Owner;
            string ownerAccount = call.Name == "purchase_kredits" ? "owner" : "owner_authority";
            if (call.Accounts[ownerAccount] != owner || call.Accounts["player_state"] != Pda("player", SolanaAddress.Bytes(owner))) return false;
            bool succeeded = !evidence.Expired && evidence.Status.ErrorJson == null;
            var playerEnvelope = Observed(evidence, call.Accounts["player_state"]).Envelope;
            if (succeeded && playerEnvelope == null) return false;
            if (playerEnvelope != null) accounts.PlayerState(playerEnvelope, owner);
            if (call.Name == "set_featured_emblem")
            {
                if ((byte)call.Arguments["emblem_id"] > PlanningConstants.MaxEmblemId ||
                    (byte)call.Arguments["frame_tier"] > PlanningConstants.MaxFrameTier) return false;
                return true;
            }
            if (call.Name == "purchase_kredits")
            {
                if ((uint)call.Arguments["kredit_count"] == 0 ||
                    call.Accounts["protocol"] != Pda("protocol") ||
                    call.Accounts["credit_vault"] != Pda("credit_vault")) return false;
                var credit = Observed(evidence, call.Accounts["credit_vault"]).Envelope;
                var team = Observed(evidence, call.Accounts["team_destination"]).Envelope;
                if (succeeded && (credit == null || team == null)) return false;
                if (credit != null) accounts.CreditVault(credit);
                if (team != null && (team.Owner != PlanningConstants.SystemProgram || team.Executable || team.Data.Length != 0)) return false;

                var configs = await rpc.HistoricalAccounts(evidence.Pending.Endpoint, true,
                    new[] { call.Accounts["protocol"] }, minContextSlot: evidence.MinimumSlot, cancellation: cancellation).ConfigureAwait(false);
                if (succeeded && configs.Accounts.Any(a => a.Envelope == null)) return false;
                if (configs.Accounts[0].Envelope != null &&
                    (string)accounts.ProtocolConfig(configs.Accounts[0].Envelope)["team_destination"] != call.Accounts["team_destination"]) return false;
                return true;
            }
            var args = call.Arguments;
            string kind = ((JObject)args["board"]).Properties().Single().Name.ToLowerInvariant();
            uint position = (uint)args["position"];
            if ((kind != "score" && kind != "theme") || position >= Protocol.ArenaBoardCapacity ||
                call.Accounts["arena_board"] != Pda("arena_board", SolanaAddress.Bytes(call.Accounts["arena_daily"]), Encoding.UTF8.GetBytes(kind))) return false;
            var dailyEnvelope = Observed(evidence, call.Accounts["arena_daily"]).Envelope;
            var boardEnvelope = Observed(evidence, call.Accounts["arena_board"]).Envelope;
            if (dailyEnvelope == null)
            {
                if (boardEnvelope != null) return false;
                return true;
            }
            uint day = (uint)accounts.ArenaDaily(dailyEnvelope)["day_id"];
            var reward = accounts.BoardRewards(boardEnvelope, day, kind, owner).SingleOrDefault(row => row.Position == position);
            if (succeeded && boardEnvelope != null && reward == null) return false;
            return true;
        }
        private string Pda(string seed, params byte[][] parts) => SolanaAddress.Derive(protocol.ProgramId,
            new[] { Encoding.UTF8.GetBytes(seed) }.Concat(parts), out _);
    }
}
