using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;

namespace ZKube.Integration.Transport
{
    public interface IJsonRpcHttp
    {
        Task<string> Post(Uri endpoint, string json, int maximumResponseBytes, CancellationToken cancellation);
    }

    public sealed class RpcEndpoint
    {
        public Uri Address { get; }
        public bool IsBase { get; }
        internal object Transport { get; }
        internal string ActiveRun { get; }
        internal RpcEndpoint(Uri address, bool isBase, object transport, string activeRun = null)
        { Address = address; IsBase = isBase; Transport = transport; ActiveRun = activeRun; }
    }

    public sealed class RpcAccount
    {
        public ulong Slot { get; }
        public ulong Lamports { get; }
        public AccountEnvelope Envelope { get; }
        internal RpcAccount(ulong slot, ulong lamports, AccountEnvelope envelope) { Slot = slot; Lamports = lamports; Envelope = envelope; }
    }

    public sealed class RpcBlockhash
    {
        public string Blockhash { get; }
        public ulong LastValidBlockHeight { get; }
        internal RpcEndpoint Endpoint { get; }
        internal RpcBlockhash(string blockhash, ulong height, RpcEndpoint endpoint) { Blockhash = blockhash; LastValidBlockHeight = height; Endpoint = endpoint; }
    }

    public sealed class RpcAccountBatch
    {
        public ulong Slot { get; }
        public IReadOnlyList<RpcAccount> Accounts { get; }
        internal RpcAccountBatch(ulong slot, RpcAccount[] accounts) { Slot = slot; Accounts = Array.AsReadOnly(accounts); }
    }

    public sealed class RpcValidator
    {
        public string Identity { get; }
        public string Endpoint { get; }
        internal RpcValidator(string identity, string endpoint) { Identity = identity; Endpoint = endpoint; }
    }

    public sealed class RpcSimulation
    {
        public bool Succeeded => ErrorJson == null;
        public string ErrorJson { get; }
        public IReadOnlyList<string> Logs { get; }
        public ulong? UnitsConsumed { get; }
        internal RpcSimulation(string error, string[] logs, ulong? units) { ErrorJson = error; Logs = Array.AsReadOnly(logs); UnitsConsumed = units; }
    }

    public enum RpcSubmissionPolicy { Wallet, ErSession }
    public enum RpcConfirmation { Missing, Unknown, Processed, Confirmed, Finalized }
    public sealed class RpcSignatureStatus
    {
        public RpcConfirmation Confirmation { get; }
        public ulong? Slot { get; }
        public ulong ContextSlot { get; }
        public string ErrorJson { get; }
        internal RpcSignatureStatus(RpcConfirmation confirmation, ulong? slot, string error, ulong contextSlot)
        { Confirmation = confirmation; Slot = slot; ErrorJson = error; ContextSlot = contextSlot; }
    }

    public sealed class RpcFailure : Exception
    {
        public long Code { get; }
        public string DataJson { get; }
        internal RpcFailure(long code, string message, string data) : base(message) { Code = code; DataJson = data; }
    }
}
