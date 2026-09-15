using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class SessionInstructionReconciler : IExecutionReconciler
    {
        private readonly ProtocolBindings protocol;
        private readonly AccountBindings accounts;
        private readonly SessionTokenBindings tokens;
        private readonly SessionRecordStore records;
        private readonly SessionHandoff handoff;
        private readonly TransactionPlanner planner;
        public SessionInstructionReconciler(ProtocolBindings protocol, AccountBindings accounts, SessionTokenBindings tokens,
            SessionRecordStore records, SessionHandoff handoff, TransactionPlanner planner)
        { this.protocol = protocol; this.accounts = accounts; this.tokens = tokens; this.records = records; this.handoff = handoff; this.planner = planner; }

        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            if (!evidence.Pending.IsBase || (!evidence.Expired && evidence.Status.Confirmation != RpcConfirmation.Confirmed &&
                evidence.Status.Confirmation != RpcConfirmation.Finalized)) return false;
            var calls = evidence.Transaction.Instructions.Where(i => i.ProgramId != PlanningConstants.ComputeBudgetProgram).ToArray();
            if (calls.Length < 2 || calls.Length > 4) return false;
            if (calls[calls.Length - 1].ProgramId != tokens.ProgramId || calls[calls.Length - 2].ProgramId != protocol.ProgramId) return false;
            string owner = evidence.Pending.Owner;
            var current = await records.Load(owner).ConfigureAwait(false);
            // Following native and public promotion, a restart has only Active.
            // Its exact create bytes must still match the persisted transaction.
            var expected = current.Candidate ?? current.Active;
            if (expected == null || expected.ValidUntil < PlanningConstants.SessionLifetimeSeconds) return false;
            var enable = planner.EnableSession(owner, expected.Signer, expected.ValidUntil - PlanningConstants.SessionLifetimeSeconds);
            if (!Matches(calls[calls.Length - 2], enable.Instructions[0]) || !Matches(calls[calls.Length - 1], enable.Instructions[1])) return false;
            bool succeeded = !evidence.Expired && evidence.Status.ErrorJson == null;
            bool revoked = false, reclaimed = false;
            for (int i = 0; i < calls.Length - 2; i++)
            {
                var instruction = calls[i];
                if (instruction.ProgramId == tokens.ProgramId && !revoked && !reclaimed)
                {
                    if (!instruction.Data.SequenceEqual(PlanningConstants.RevokeSessionDiscriminator) || instruction.Accounts.Count != 4 ||
                        instruction.Accounts[1].Address != owner || instruction.Accounts[2].Address != owner ||
                        instruction.Accounts[3].Address != PlanningConstants.SystemProgram || !instruction.Accounts[0].Writable || !instruction.Accounts[1].Writable ||
                        instruction.Accounts[0].Address == expected.Token) return false;
                    var previous = Observed(evidence, instruction.Accounts[0].Address).Envelope;
                    if (previous != null)
                    {
                        var token = tokens.Decode(previous);
                        if (token.Authority != owner || token.FeePayer != owner || token.TargetProgram != protocol.ProgramId) return false;
                        if (succeeded) return false;
                    }
                    revoked = true;
                }
                else if (instruction.ProgramId == PlanningConstants.SystemProgram && !reclaimed)
                {
                    var data = instruction.Data;
                    if (instruction.Accounts.Count != 2 || data.Length != 12 || data[0] != 2 || data[1] != 0 || data[2] != 0 || data[3] != 0 ||
                        !data.Skip(4).Any(value => value != 0) || !instruction.Accounts[0].Signer || !instruction.Accounts[0].Writable ||
                        !instruction.Accounts[1].Writable || instruction.Accounts[1].Address != owner ||
                        instruction.Accounts[0].Address == owner || instruction.Accounts[0].Address == expected.Signer) return false;
                    var old = Observed(evidence, instruction.Accounts[0].Address);
                    if (old.Envelope != null) SessionReadiness.Funding(old.Envelope, old.Lamports, 0);
                    // A later transfer can fund the old address again. Confirmation,
                    // rather than a zero-balance assumption, proves this reclaim.
                    reclaimed = true;
                }
                else return false;
            }
            var player = Observed(evidence, planner.Player(owner)).Envelope;
            if (player != null) accounts.PlayerState(player, owner);
            if (succeeded && player == null) return false;
            var freshToken = Observed(evidence, expected.Token).Envelope;
            if (freshToken != null)
            {
                var token = tokens.Decode(freshToken);
                if (token.Authority != owner || token.FeePayer != owner || token.TargetProgram != protocol.ProgramId ||
                    token.SessionSigner != expected.Signer || token.ValidUntil != expected.ValidUntil) return false;
            }
            var signer = Observed(evidence, expected.Signer);
            if (signer.Envelope != null) SessionReadiness.Funding(signer.Envelope, signer.Lamports, 0);
            if (succeeded && freshToken != null)
                await handoff.Accept(expected, freshToken).ConfigureAwait(false);
            // Failed/expired transactions retain both identities. A successful
            // token already removed by later cleanup also cannot authorize play.
            return true;
        }
        private static RpcAccount Observed(ExecutionReconciliation evidence, string address)
        {
            var row = evidence.Accounts.SingleOrDefault(value => value.Address == address);
            if (row?.Observation == null || row.Observation.Slot < evidence.MinimumSlot) throw new FormatException("Missing fresh session observation");
            return row.Observation;
        }
        private static bool Matches(SolanaInstruction actual, SolanaInstruction expected) => actual.ProgramId == expected.ProgramId &&
            actual.Data.SequenceEqual(expected.Data) && actual.Accounts.Count == expected.Accounts.Count &&
            actual.Accounts.Zip(expected.Accounts, (a, b) => a.Address == b.Address && (!b.Signer || a.Signer) && (!b.Writable || a.Writable)).All(value => value);
    }
}
