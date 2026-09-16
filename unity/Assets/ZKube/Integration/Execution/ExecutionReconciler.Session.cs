using System;
using System.IO;
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
        private async Task<bool> ReconcileSession(ExecutionReconciliation evidence, SolanaInstruction[] calls)
        {
            if (!evidence.Pending.IsBase || calls.Length < 2 || calls.Length > 4) return false;
            var create = calls[calls.Length - 1];
            if (create.ProgramId != tokens.ProgramId || create.Accounts.Count != 6 || create.Data.Length != 28) return false;
            string owner = evidence.Pending.Owner;
            // The signed create instruction is the durable renewal intent.
            // Public metadata stays on the previous expiry until confirmation.
            using var reader = new BinaryReader(new MemoryStream(create.Data, false));
            reader.BaseStream.Position = 11;
            long expiry = reader.ReadInt64();
            if (expiry < PlanningConstants.SessionLifetimeSeconds || expiry > 9007199254740991L) return false;
            string device = create.Accounts[1].Address;
            var expected = new SessionRecord(owner, device, tokens.Derive(owner, device, protocol.ProgramId), expiry);
            var enable = planner.EnableSession(owner, device, expiry - PlanningConstants.SessionLifetimeSeconds);
            if (!Matches(calls[calls.Length - 2], enable.Instructions[0]) || !Matches(create, enable.Instructions[1])) return false;
            bool revoked = false, reclaimed = false;
            for (int i = 0; i < calls.Length - 2; i++)
            {
                var instruction = calls[i];
                if (instruction.ProgramId == tokens.ProgramId && !revoked && !reclaimed)
                {
                    if (!instruction.Data.SequenceEqual(PlanningConstants.RevokeSessionDiscriminator) || instruction.Accounts.Count != 4 ||
                        instruction.Accounts[0].Address != expected.Token || !instruction.Accounts[0].Writable ||
                        instruction.Accounts[1].Address != owner || !instruction.Accounts[1].Writable ||
                        instruction.Accounts[2].Address != owner || !instruction.Accounts[2].Signer ||
                        instruction.Accounts[3].Address != PlanningConstants.SystemProgram) return false;
                    revoked = true;
                }
                else if (instruction.ProgramId == PlanningConstants.SystemProgram && !reclaimed)
                {
                    var data = instruction.Data;
                    if (instruction.Accounts.Count != 2 || data.Length != 12 || data[0] != 2 || data[1] != 0 || data[2] != 0 || data[3] != 0 ||
                        !data.Skip(4).Any(value => value != 0) || instruction.Accounts[0].Address != device ||
                        !instruction.Accounts[0].Signer || !instruction.Accounts[0].Writable ||
                        !instruction.Accounts[1].Writable || instruction.Accounts[1].Address != owner) return false;
                    reclaimed = true;
                }
                else return false;
            }
            bool succeeded = !evidence.Expired && evidence.Status.ErrorJson == null;
            var player = Observed(evidence, planner.Player(owner)).Envelope;
            if (player != null) accounts.PlayerState(player, owner);
            if (succeeded && player == null) return false;
            var fresh = Observed(evidence, expected.Token).Envelope;
            if (fresh != null)
            {
                var token = tokens.Decode(fresh);
                if (token.Authority != owner || token.FeePayer != owner || token.TargetProgram != protocol.ProgramId ||
                    token.SessionSigner != device || (succeeded && token.ValidUntil != expiry)) return false;
            }
            var signer = Observed(evidence, device);
            if (signer.Envelope != null) SessionReadiness.Funding(signer.Envelope, signer.Lamports, 0);
            if (succeeded && fresh != null)
            {
                var current = await records.Load(owner).ConfigureAwait(false);
                await records.Replace(current, new SessionRecords(owner, expected)).ConfigureAwait(false);
            }
            return true;
        }
        private static bool Matches(SolanaInstruction actual, SolanaInstruction expected) => actual.ProgramId == expected.ProgramId &&
            actual.Data.SequenceEqual(expected.Data) && actual.Accounts.Count == expected.Accounts.Count &&
            actual.Accounts.Zip(expected.Accounts, (a, b) => a.Address == b.Address && (!b.Signer || a.Signer) && (!b.Writable || a.Writable)).All(value => value);
    }
}
