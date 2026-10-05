using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Execution
{
    public enum ExecutionOutcome { Rejected, FeeShortage, Pending, ConfirmedFailure, ConfirmedSuccess, ExpiredReconciled, CompletedLocally }

    public sealed class ExecutionResult
    {
        public ExecutionOutcome Outcome { get; }
        public string Intent { get; }
        public string Signature { get; }
        public string Code { get; }
        public string ChainError { get; }
        // What stopped the request, when an error did and not the wallet or the chain's own refusal.
        public Transport.RequestFailure Failure { get; }
        // What a wallet changed in the message it was given, when it changed one.
        public string WalletChange { get; }
        internal ExecutionResult(ExecutionOutcome outcome, string intent, string signature = null, string code = null,
            string chainError = null, Transport.RequestFailure failure = null, string walletChange = null)
        {
            Outcome = outcome; Intent = intent; Signature = signature; Code = code; ChainError = chainError; Failure = failure; WalletChange = walletChange;
            // Every outcome that is not a success or still pending leaves its one
            // line in the device log where it is made, so no path can drop its cause.
            // Finding nothing waiting is an observation, not an outcome.
            if (outcome != ExecutionOutcome.ConfirmedSuccess && outcome != ExecutionOutcome.Pending && outcome != ExecutionOutcome.CompletedLocally &&
                code != "no-pending-transaction") Transport.ClientLog.Result(intent, outcome.ToString(), code, failure, chainError, walletChange);
        }
        public static ExecutionResult CompletedLocally(string intent) => new ExecutionResult(ExecutionOutcome.CompletedLocally, intent);
        public static ExecutionResult Rejected(string intent, string code) => new ExecutionResult(ExecutionOutcome.Rejected, intent, code: code);
    }

    public sealed class AffectedAccountObservation
    {
        public string Address { get; }
        public RpcAccount Observation { get; }
        internal AffectedAccountObservation(string address, RpcAccount observation)
        { Address = address; Observation = observation; }
    }

    public sealed class ExecutionReconciliation
    {
        public PendingTransaction Pending { get; }
        public TransactionDescription Transaction { get; }
        public ulong MinimumSlot { get; }
        public RpcSignatureStatus Status { get; }
        public bool Expired { get; }
        public IReadOnlyList<AffectedAccountObservation> Accounts { get; }
        internal ExecutionReconciliation(PendingTransaction pending, TransactionDescription transaction, ulong minimumSlot,
            AffectedAccountObservation[] accounts, RpcSignatureStatus status, bool expired)
        { Pending = pending; Transaction = transaction; MinimumSlot = minimumSlot; Accounts = Array.AsReadOnly(accounts); Status = status; Expired = expired; }
    }

    public interface IExecutionReconciler
    {
        // Interpret the persisted instruction envelopes and validate fresh account
        // state through the existing decoders/native engine. No in-memory plan is
        // required after restart. Every supplied account context belongs only to
        // Pending.Endpoint's ledger. Additional Base copy-back/current-placement
        // observations use their own ledger's freshness floor, never an ER slot.
        Task<bool> Reconcile(ExecutionReconciliation evidence, CancellationToken cancellation);
    }
}
