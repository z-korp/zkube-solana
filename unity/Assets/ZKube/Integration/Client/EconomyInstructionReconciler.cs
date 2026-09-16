using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class EconomyObservation
    {
        private readonly JObject player;
        public string Owner { get; }
        public string Instruction { get; }
        public JObject Player => player == null ? null : (JObject)player.DeepClone();
        public ulong Kredits => player == null ? 0 : (ulong)player["kredit_balance"];
        public string ClaimState { get; }
        public uint? DayId { get; }
        public string BoardKind { get; }
        public uint? Position { get; }
        internal EconomyObservation(string owner, string instruction, JObject player, string claimState = null,
            uint? dayId = null, string boardKind = null, uint? position = null)
        { Owner = owner; Instruction = instruction; this.player = player == null ? null : (JObject)player.DeepClone(); ClaimState = claimState; DayId = dayId; BoardKind = boardKind; Position = position; }
    }

    public sealed class EconomyInstructionReconciler : IExecutionReconciler
    {
        private readonly ProtocolBindings protocol;
        private readonly AccountBindings accounts;
        private readonly SolanaRpcTransport rpc;
        private readonly Func<EconomyObservation, Task> accepted;
        public EconomyInstructionReconciler(ProtocolBindings protocol, AccountBindings accounts, SolanaRpcTransport rpc, Func<EconomyObservation, Task> accepted)
        { this.protocol = protocol; this.accounts = accounts; this.rpc = rpc; this.accepted = accepted; }

        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            if (!evidence.Pending.IsBase) return false;
            if (!evidence.Expired && evidence.Status.Confirmation != RpcConfirmation.Confirmed &&
                evidence.Status.Confirmation != RpcConfirmation.Finalized) return false;
            var calls = evidence.Transaction.Instructions.Where(i => i.ProgramId != PlanningConstants.ComputeBudgetProgram).ToArray();
            if (calls.Length != 1 || calls[0].ProgramId != protocol.ProgramId) return false;
            var call = protocol.DecodeInstruction(calls[0]);
            if (call.Remaining.Count != 0 || (call.Name != "purchase_kredits" && call.Name != "claim_daily_prize" && call.Name != "set_featured_emblem")) return false;
            string owner = evidence.Pending.Owner;
            string ownerAccount = call.Name == "purchase_kredits" ? "owner" : "owner_authority";
            if (call.Accounts[ownerAccount] != owner || call.Accounts["player_state"] != Pda("player", SolanaAddress.Bytes(owner))) return false;
            bool succeeded = !evidence.Expired && evidence.Status.ErrorJson == null;
            var playerEnvelope = Observed(evidence, call.Accounts["player_state"]);
            if (succeeded && playerEnvelope == null) return false;
            var player = playerEnvelope == null ? null : accounts.PlayerState(playerEnvelope, owner);
            if (call.Name == "set_featured_emblem")
            {
                if ((byte)call.Arguments["emblem_id"] > PlanningConstants.MaxEmblemId ||
                    (byte)call.Arguments["frame_tier"] > PlanningConstants.MaxFrameTier) return false;
                // Confirmation proves the earlier write. The latest profile may
                // already reflect another authorized choice; publish that read.
                await accepted(new EconomyObservation(owner, call.Name, player)).ConfigureAwait(false);
                return true;
            }
            if (call.Name == "purchase_kredits")
            {
                if ((uint)call.Arguments["kredit_count"] == 0 ||
                    call.Accounts["protocol"] != Pda("protocol") ||
                    call.Accounts["credit_vault"] != Pda("credit_vault")) return false;
                var credit = Observed(evidence, call.Accounts["credit_vault"]);
                var team = Observed(evidence, call.Accounts["team_destination"]);
                if (succeeded && (credit == null || team == null)) return false;
                if (credit != null) accounts.CreditVault(credit);
                if (team != null && (team.Owner != PlanningConstants.SystemProgram || team.Executable || team.Data.Length != 0)) return false;

                var configs = await rpc.HistoricalAccounts(evidence.Pending.Endpoint, true,
                    new[] { call.Accounts["protocol"] }, minContextSlot: evidence.MinimumSlot, cancellation: cancellation).ConfigureAwait(false);
                if (succeeded && configs.Accounts.Any(a => a.Envelope == null)) return false;
                if (configs.Accounts[0].Envelope != null &&
                    (string)accounts.ProtocolConfig(configs.Accounts[0].Envelope)["team_destination"] != call.Accounts["team_destination"]) return false;
                // Confirmation establishes the instruction outcome. The current
                // decoded balance is authoritative; never invent oldBalance+pack.
                await accepted(new EconomyObservation(owner, call.Name, player)).ConfigureAwait(false);
                return true;
            }
            var args = call.Arguments;
            string kind = ((JObject)args["board"]).Properties().Single().Name.ToLowerInvariant();
            uint position = (uint)args["position"];
            if ((kind != "score" && kind != "theme") || position >= Protocol.ArenaBoardCapacity ||
                call.Accounts["arena_board"] != Pda("arena_board", SolanaAddress.Bytes(call.Accounts["arena_daily"]), Encoding.UTF8.GetBytes(kind))) return false;
            var dailyEnvelope = Observed(evidence, call.Accounts["arena_daily"]);
            var boardEnvelope = Observed(evidence, call.Accounts["arena_board"]);
            if (dailyEnvelope == null)
            {
                if (boardEnvelope != null) return false;
                await accepted(new EconomyObservation(owner, call.Name, player, "removed", boardKind: kind, position: position)).ConfigureAwait(false);
                return true;
            }
            uint day = (uint)accounts.ArenaDaily(dailyEnvelope)["day_id"];
            var reward = accounts.BoardRewards(boardEnvelope, day, kind, owner).SingleOrDefault(row => row.Position == position);
            if (succeeded && boardEnvelope != null && reward == null) return false;
            await accepted(new EconomyObservation(owner, call.Name, player, boardEnvelope == null ? "removed" : reward == null ? "absent" : reward.Claimed ? "claimed" : succeeded ? "expired" : "unclaimed", day, kind, position)).ConfigureAwait(false);
            return true;
        }
        private static AccountEnvelope Observed(ExecutionReconciliation evidence, string address)
        {
            var row = evidence.Accounts.SingleOrDefault(a => a.Address == address);
            if (row == null || row.Observation == null || row.Observation.Slot < evidence.MinimumSlot) throw new FormatException("Missing fresh affected-account evidence");
            return row.Observation.Envelope;
        }
        private string Pda(string seed, params byte[][] parts) => SolanaAddress.Derive(protocol.ProgramId,
            new[] { Encoding.UTF8.GetBytes(seed) }.Concat(parts), out _);
    }
}
