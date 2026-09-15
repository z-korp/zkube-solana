using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Execution;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class SessionMaintenanceReconciler : IExecutionReconciler
    {
        private readonly WalletClient wallet;
        private readonly SessionRecordStore records;
        public SessionMaintenanceReconciler(WalletClient wallet, SessionRecordStore records)
        { this.wallet = wallet; this.records = records; }
        public async Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation)
        {
            if (!evidence.Pending.IsBase || (!evidence.Expired && evidence.Status.Confirmation != RpcConfirmation.Confirmed &&
                evidence.Status.Confirmation != RpcConfirmation.Finalized)) return false;
            var calls = evidence.Transaction.Instructions.Where(i => i.ProgramId != PlanningConstants.ComputeBudgetProgram).ToArray();
            if (calls.Length < 1 || calls.Length > 2 || calls.Any(i => i.ProgramId != PlanningConstants.SystemProgram)) return false;
            string owner = evidence.Pending.Owner;
            bool refill = calls.Length == 2;
            string device = refill ? calls[0].Accounts.LastOrDefault()?.Address : calls[0].Accounts.FirstOrDefault()?.Address;
            if (device == null || device == owner || !Transfer(calls[0], refill ? owner : device, refill ? device : owner, false) ||
                (refill && !Transfer(calls[1], device, owner, true))) return false;
            var saved = await records.Load(owner).ConfigureAwait(false);
            if (saved.Active != null && saved.Active.Signer != device) return false;
            if (refill && saved.Active == null) return false;
            var observation = evidence.Accounts.SingleOrDefault(a => a.Address == device)?.Observation;
            if (observation == null || observation.Slot < evidence.MinimumSlot) return false;
            if (observation.Envelope != null) SessionReadiness.Funding(observation.Envelope, observation.Lamports, 0);
            if (!refill && !evidence.Expired && evidence.Status.ErrorJson == null)
            {
                using var key = await wallet.LoadDeviceSigner(owner).ConfigureAwait(false);
                if (key != null && key.Address != device) return false;
                await wallet.RemoveDeviceSigner(owner).ConfigureAwait(false);
                if (saved.Active != null) await records.Replace(saved, new SessionRecords(owner, null, saved.Candidate)).ConfigureAwait(false);
            }
            return true;
        }
        private static bool Transfer(SolanaInstruction instruction, string from, string to, bool zero)
        {
            var bytes = instruction.Data;
            return instruction.Accounts.Count == 2 && instruction.Accounts[0].Address == from && instruction.Accounts[1].Address == to &&
                instruction.Accounts[0].Signer && instruction.Accounts[0].Writable && instruction.Accounts[1].Writable && bytes.Length == 12 &&
                bytes[0] == 2 && bytes[1] == 0 && bytes[2] == 0 && bytes[3] == 0 && bytes.Skip(4).All(value => value == 0) == zero;
        }
    }
}
