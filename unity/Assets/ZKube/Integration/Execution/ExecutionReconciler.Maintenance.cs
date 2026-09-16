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
        private async Task<bool> ReconcileMaintenance(ExecutionReconciliation evidence, SolanaInstruction[] calls)
        {
            if (!evidence.Pending.IsBase || calls.Length < 1 || calls.Length > 2) return false;
            string owner = evidence.Pending.Owner;
            var saved = await records.Load(owner).ConfigureAwait(false);
            bool refill = calls.Length == 2 && calls.All(i => i.ProgramId == PlanningConstants.SystemProgram);
            string device = null, tokenAddress = null;
            if (refill)
            {
                device = calls[0].Accounts.LastOrDefault()?.Address;
                if (device == null || device == owner || !Transfer(calls[0], owner, device, false) ||
                    !Transfer(calls[1], device, owner, true) || saved.Active?.Signer != device) return false;
            }
            else
            {
                int transfer = 0;
                if (calls[0].ProgramId == tokens.ProgramId)
                {
                    var call = calls[0]; var keys = call.Accounts;
                    if (!call.Data.SequenceEqual(PlanningConstants.RevokeSessionDiscriminator) || keys.Count != 4 ||
                        !keys[0].Writable || keys[1].Address != owner || !keys[1].Writable ||
                        keys[2].Address != owner || !keys[2].Signer || keys[3].Address != PlanningConstants.SystemProgram) return false;
                    tokenAddress = keys[0].Address;
                    if (saved.Active != null && saved.Active.Token != tokenAddress) return false;
                    var observation = Observed(evidence, tokenAddress);
                    if (observation.Envelope != null)
                    {
                        var token = tokens.Decode(observation.Envelope);
                        if (token.Authority != owner || token.FeePayer != owner || token.TargetProgram != protocol.ProgramId) return false;
                        if (!evidence.Expired && evidence.Status.ErrorJson == null) return false;
                    }
                    transfer = 1;
                }
                if (transfer < calls.Length)
                {
                    if (calls.Length != transfer + 1) return false;
                    device = calls[transfer].Accounts.FirstOrDefault()?.Address;
                    if (device == null || device == owner || !Transfer(calls[transfer], device, owner, false)) return false;
                    if (saved.Active != null && saved.Active.Signer != device) return false;
                    if (tokenAddress != null && tokenAddress != tokens.Derive(owner, device, protocol.ProgramId)) return false;
                }
            }
            if (device != null)
            {
                var observation = Observed(evidence, device);
                if (observation.Envelope != null) SessionReadiness.Funding(observation.Envelope, observation.Lamports, 0);
            }
            if (!refill && !evidence.Expired && evidence.Status.ErrorJson == null && saved.Active != null)
                await records.Replace(saved, new SessionRecords(owner, null)).ConfigureAwait(false);
            return true;
        }
        private static bool Transfer(SolanaInstruction instruction, string from, string to, bool zero)
        {
            var bytes = instruction.Data;
            return instruction.ProgramId == PlanningConstants.SystemProgram && instruction.Accounts.Count == 2 &&
                instruction.Accounts[0].Address == from && instruction.Accounts[1].Address == to &&
                instruction.Accounts[0].Signer && instruction.Accounts[0].Writable && instruction.Accounts[1].Writable && bytes.Length == 12 &&
                bytes[0] == 2 && bytes[1] == 0 && bytes[2] == 0 && bytes[3] == 0 && bytes.Skip(4).All(value => value == 0) == zero;
        }
    }
}
