using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration.Transport
{
    public sealed partial class SolanaRpcTransport : IRecoveryTransport
    {
        public const int MaximumAccountBytes = 262144;
        public const int MaximumBatchAccounts = 16;
        private readonly IJsonRpcHttp http;
        private readonly Uri router;
        private readonly string expectedGenesis, program;
        private readonly Dictionary<string, string> placements = new Dictionary<string, string>(StringComparer.Ordinal);
        private readonly SemaphoreSlim verification = new SemaphoreSlim(1, 1);
        private bool verified;
        private long requestId;
        public RpcEndpoint Base { get; }
        public string BaseEndpoint => Base.Address.AbsoluteUri;
        public string RouterEndpoint => router.AbsoluteUri;

        public SolanaRpcTransport(IJsonRpcHttp http, string baseEndpoint, string routerEndpoint, string expectedGenesis, string program)
        {
            this.http = http ?? throw new ArgumentNullException(nameof(http));
            SolanaAddress.Bytes(expectedGenesis); SolanaAddress.Bytes(program);
            this.expectedGenesis = expectedGenesis; this.program = program;
            Base = new RpcEndpoint(Endpoint(baseEndpoint), true, this); router = Endpoint(routerEndpoint);
            if (Base.Address == router) throw new ArgumentException("Base and Router must be separate endpoints");
        }

        public async Task VerifyBase(CancellationToken cancellation = default)
        {
            await verification.WaitAsync(cancellation).ConfigureAwait(false);
            try
            {
                if (verified) return;
                string actual = String(await Call(Base.Address, "getGenesisHash", new JArray(), 4096, cancellation).ConfigureAwait(false));
                SolanaAddress.Bytes(actual);
                if (actual != expectedGenesis) throw new FormatException("Base RPC genesis does not match the configured cluster");
                verified = true;
            }
            finally { verification.Release(); }
        }

        public async Task<DelegationPlacement> Placement(string activeRun)
        {
            SolanaAddress.Bytes(activeRun); await VerifyBase().ConfigureAwait(false);
            var value = Object(await Call(router, "getDelegationStatus", new JArray(activeRun), 16384, default).ConfigureAwait(false));
            bool delegated = Boolean(value["isDelegated"]);
            string owner = null;
            if (value["delegationRecord"] is JObject record)
            {
                owner = String(record["owner"]); SolanaAddress.Bytes(owner); SolanaAddress.Bytes(String(record["authority"]));
                Unsigned(record["delegationSlot"]); Unsigned(record["lamports"]);
                if (owner != program) throw new FormatException("Delegation record owner does not match zKube");
            }
            string endpoint = value["fqdn"]?.Type == JTokenType.String ? Endpoint((string)value["fqdn"]).AbsoluteUri : null;
            if (endpoint != null && (endpoint == BaseEndpoint || endpoint == RouterEndpoint))
                throw new FormatException("Router returned a non-ER endpoint");
            lock (placements)
            {
                placements.Remove(activeRun);
                if (delegated && endpoint != null) placements.Add(activeRun, endpoint);
            }
            return new DelegationPlacement { IsDelegated = delegated, Endpoint = endpoint, RecordOwner = owner };
        }

        public async Task<RpcValidator> ClosestValidator(CancellationToken cancellation = default)
        {
            await VerifyBase(cancellation).ConfigureAwait(false);
            var value = Object(await Call(router, "getIdentity", new JArray(), 16384, cancellation).ConfigureAwait(false));
            string identity = String(value["identity"]); SolanaAddress.Bytes(identity);
            return new RpcValidator(identity);
        }

        public async Task<RpcEndpoint> ResolveEr(string activeRun)
        {
            var placement = await Placement(activeRun).ConfigureAwait(false);
            if (!placement.IsDelegated || placement.Endpoint == null) throw new InvalidOperationException("Run is awaiting delegation");
            var account = await ReadEr(placement.Endpoint, activeRun).ConfigureAwait(false);
            if (account == null) throw new InvalidOperationException("Run has not propagated to its resolved ER");
            return new RpcEndpoint(Endpoint(placement.Endpoint), false, this, activeRun);
        }

        public async Task<AccountEnvelope> ReadBase(string address) => (await ReadAccount(Base, address).ConfigureAwait(false))?.Envelope;
        public async Task<AccountEnvelope> ReadEr(string endpoint, string activeRun)
        {
            string canonical = Endpoint(endpoint).AbsoluteUri;
            lock (placements)
                if (!placements.TryGetValue(activeRun, out var resolved) || resolved != canonical)
                    throw new InvalidOperationException("ER account read requires current Router placement");
            var value = await ReadAccount(new RpcEndpoint(Endpoint(canonical), false, this, activeRun), activeRun).ConfigureAwait(false);
            if (value?.Envelope != null && (value.Envelope.Owner != program || value.Envelope.Executable))
                throw new FormatException("Resolved ER account is not owned by zKube");
            return value?.Envelope;
        }

        public async Task<RpcAccount> ReadAccount(RpcEndpoint endpoint, string address, int maximumBytes = MaximumAccountBytes,
            ulong? minContextSlot = null, CancellationToken cancellation = default)
        {
            SolanaAddress.Bytes(address); AccountBound(maximumBytes); await Ready(endpoint, cancellation).ConfigureAwait(false);
            var result = Object(await Call(endpoint.Address, "getAccountInfo", new JArray(address, AccountConfig(minContextSlot)), maximumBytes * 2 + 4096, cancellation).ConfigureAwait(false));
            return Account(address, result["value"], AccountSlot(result, minContextSlot), maximumBytes);
        }

        public async Task<RpcAccountBatch> ReadAccounts(RpcEndpoint endpoint, IReadOnlyList<string> addresses,
            int maximumBytes = MaximumAccountBytes, ulong? minContextSlot = null, CancellationToken cancellation = default)
        {
            addresses = SnapshotAddresses(addresses); AccountBound(maximumBytes);
            await Ready(endpoint, cancellation).ConfigureAwait(false);
            return await AccountBatch(endpoint.Address, addresses, maximumBytes, minContextSlot, cancellation).ConfigureAwait(false);
        }

        public async Task<RpcAccountBatch> HistoricalAccounts(string endpoint, bool isBase, IReadOnlyList<string> addresses,
            int maximumBytes = MaximumAccountBytes, ulong? minContextSlot = null, CancellationToken cancellation = default)
        {
            addresses = SnapshotAddresses(addresses); AccountBound(maximumBytes);
            await VerifyBase(cancellation).ConfigureAwait(false);
            return await AccountBatch(HistoricalEndpoint(endpoint, isBase), addresses, maximumBytes, minContextSlot, cancellation).ConfigureAwait(false);
        }

        private async Task<RpcAccountBatch> AccountBatch(Uri endpoint, IReadOnlyList<string> addresses, int maximumBytes,
            ulong? minContextSlot, CancellationToken cancellation)
        {
            var result = Object(await Call(endpoint, "getMultipleAccounts", new JArray(new JArray(addresses), AccountConfig(minContextSlot)), addresses.Count * (maximumBytes * 2 + 4096), cancellation).ConfigureAwait(false));
            if (!(result["value"] is JArray values) || values.Count != addresses.Count) throw new FormatException("Account response count does not match request");
            ulong slot = AccountSlot(result, minContextSlot);
            return new RpcAccountBatch(slot, values.Select((value, i) => Account(addresses[i], value, slot, maximumBytes)).ToArray());
        }

        public async Task<RpcBlockhash> LatestBlockhash(RpcEndpoint endpoint, CancellationToken cancellation = default)
        {
            await Ready(endpoint, cancellation).ConfigureAwait(false);
            var result = Object(await Call(endpoint.Address, "getLatestBlockhash", new JArray(Commitment()), 4096, cancellation).ConfigureAwait(false));
            Slot(result); var value = Object(result["value"]); string hash = String(value["blockhash"]); SolanaAddress.Bytes(hash);
            ulong height = Unsigned(value["lastValidBlockHeight"]);
            return new RpcBlockhash(hash, height, endpoint);
        }

        public async Task<ulong> FeeForMessage(RpcEndpoint endpoint, byte[] message, CancellationToken cancellation = default)
        {
            message = message == null ? throw new ArgumentNullException(nameof(message)) : (byte[])message.Clone();
            SolanaWire.UnsignedTransaction(message); await Ready(endpoint, cancellation).ConfigureAwait(false);
            var result = Object(await Call(endpoint.Address, "getFeeForMessage", new JArray(Convert.ToBase64String(message), Commitment()), 4096, cancellation).ConfigureAwait(false));
            Slot(result); if (result["value"]?.Type == JTokenType.Null) throw new InvalidOperationException("RPC cannot quote this exact message");
            return Unsigned(result["value"]);
        }

        public async Task<ulong> Balance(RpcEndpoint endpoint, string address, CancellationToken cancellation = default)
        {
            SolanaAddress.Bytes(address); await Ready(endpoint, cancellation).ConfigureAwait(false);
            var result = Object(await Call(endpoint.Address, "getBalance", new JArray(address, Commitment()), 4096, cancellation).ConfigureAwait(false));
            Slot(result); return Unsigned(result["value"]);
        }

        public async Task<ulong> RentFloor(RpcEndpoint endpoint, uint bytes = 0, CancellationToken cancellation = default)
        {
            if (bytes > MaximumAccountBytes) throw new ArgumentOutOfRangeException(nameof(bytes));
            await Ready(endpoint, cancellation).ConfigureAwait(false);
            return Unsigned(await Call(endpoint.Address, "getMinimumBalanceForRentExemption", new JArray(bytes, Commitment()), 4096, cancellation).ConfigureAwait(false));
        }

        public async Task<RpcSimulation> Simulate(RpcEndpoint endpoint, byte[] transaction, RpcBlockhash lease, CancellationToken cancellation = default)
        {
            transaction = transaction == null ? throw new ArgumentNullException(nameof(transaction)) : (byte[])transaction.Clone();
            Packet(transaction); await Ready(endpoint, cancellation).ConfigureAwait(false); RequireBlockhash(endpoint, transaction, lease);
            var config = EncodingConfig(); config["sigVerify"] = false; config["replaceRecentBlockhash"] = false;
            var result = Object(await Call(endpoint.Address, "simulateTransaction", new JArray(Convert.ToBase64String(transaction), config), 1048576, cancellation).ConfigureAwait(false));
            Slot(result); var value = Object(result["value"]);
            return new RpcSimulation(Error(value["err"]));
        }

        // Stateful operations journal these exact signed bytes. Cosmetic star
        // maxima instead retain their idempotent retry intent in the play record.
        // A thrown transport/protocol error after submission is an unknown outcome;
        // this method never retries, refreshes a blockhash, or re-signs an intent.
        public async Task<string> Send(RpcEndpoint endpoint, byte[] transaction, RpcSubmissionPolicy policy, RpcBlockhash lease, CancellationToken cancellation = default)
        {
            transaction = transaction == null ? throw new ArgumentNullException(nameof(transaction)) : (byte[])transaction.Clone();
            string expectedSignature = TransactionSignatures.ValidateFullySigned(transaction);
            if (policy != RpcSubmissionPolicy.Wallet && policy != RpcSubmissionPolicy.ErSession) throw new ArgumentOutOfRangeException(nameof(policy));
            if (policy == RpcSubmissionPolicy.ErSession && endpoint.IsBase) throw new InvalidOperationException("ER fast send cannot target Base");
            await Ready(endpoint, cancellation).ConfigureAwait(false);
            RequireBlockhash(endpoint, transaction, lease);
            var config = new JObject { ["encoding"] = "base64", ["maxRetries"] = policy == RpcSubmissionPolicy.ErSession ? 0 : 5,
                ["preflightCommitment"] = policy == RpcSubmissionPolicy.ErSession ? "processed" : "confirmed" };
            if (policy == RpcSubmissionPolicy.ErSession) config["skipPreflight"] = true;
            string signature = String(await Call(endpoint.Address, "sendTransaction", new JArray(Convert.ToBase64String(transaction), config), 65536, cancellation).ConfigureAwait(false));
            TransactionSignatures.ValidateSignature(signature);
            if (signature != expectedSignature) throw new FormatException("RPC returned a different transaction signature");
            return signature;
        }

        public async Task<RpcSignatureStatus> SignatureStatus(RpcEndpoint endpoint, string signature, CancellationToken cancellation = default)
        {
            TransactionSignatures.ValidateSignature(signature); await Ready(endpoint, cancellation).ConfigureAwait(false);
            return await Status(endpoint.Address, signature, cancellation).ConfigureAwait(false);
        }

        // These read-only probes accept a validated durable journal endpoint.
        // They cannot create an RpcEndpoint or a blockhash lease for sending.
        public async Task<RpcSignatureStatus> HistoricalSignatureStatus(string endpoint, bool isBase, string signature, CancellationToken cancellation = default)
        {
            TransactionSignatures.ValidateSignature(signature); await VerifyBase(cancellation).ConfigureAwait(false);
            return await Status(HistoricalEndpoint(endpoint, isBase), signature, cancellation, true).ConfigureAwait(false);
        }
        public async Task<ulong> HistoricalBlockHeight(string endpoint, bool isBase, CancellationToken cancellation = default)
        {
            await VerifyBase(cancellation).ConfigureAwait(false);
            return Unsigned(await Call(HistoricalEndpoint(endpoint, isBase), "getBlockHeight", new JArray(Commitment()), 4096, cancellation).ConfigureAwait(false));
        }
        private Uri HistoricalEndpoint(string endpoint, bool isBase)
        {
            var uri = Endpoint(endpoint);
            if (uri == router || (isBase ? uri != Base.Address : uri == Base.Address)) throw new ArgumentException("Historical endpoint has the wrong route");
            return uri;
        }
        private async Task<RpcSignatureStatus> Status(Uri endpoint, string signature, CancellationToken cancellation, bool searchHistory = false)
        {
            // A single JArray argument selects Newtonsoft's copy constructor,
            // flattening the required signature-list parameter. Add it as a child.
            var parameters = new JArray { new JArray(signature) };
            if (searchHistory) parameters.Add(new JObject { ["searchTransactionHistory"] = true });
            var result = Object(await Call(endpoint, "getSignatureStatuses", parameters, 16384, cancellation).ConfigureAwait(false));
            ulong contextSlot = Slot(result);
            if (!(result["value"] is JArray values) || values.Count != 1) throw new FormatException("Status response count does not match request");
            if (values[0].Type == JTokenType.Null) return new RpcSignatureStatus(RpcConfirmation.Missing, null, null, contextSlot);
            var value = Object(values[0]); ulong slot = Unsigned(value["slot"]); string error = Error(value["err"]);
            if (value["confirmationStatus"] == null || value["confirmationStatus"].Type == JTokenType.Null)
                return new RpcSignatureStatus(RpcConfirmation.Unknown, slot, error, contextSlot);
            string status = String(value["confirmationStatus"]);
            var confirmation = status == "processed" ? RpcConfirmation.Processed : status == "confirmed" ? RpcConfirmation.Confirmed :
                status == "finalized" ? RpcConfirmation.Finalized : throw new FormatException("Unknown confirmation status");
            return new RpcSignatureStatus(confirmation, slot, error, contextSlot);
        }

        private async Task Ready(RpcEndpoint endpoint, CancellationToken cancellation)
        {
            if (endpoint == null || !ReferenceEquals(endpoint.Transport, this)) throw new ArgumentException("Endpoint belongs to another transport");
            await VerifyBase(cancellation).ConfigureAwait(false);
            if (!endpoint.IsBase)
                lock (placements)
                    if (endpoint.ActiveRun == null || !placements.TryGetValue(endpoint.ActiveRun, out var current) || current != endpoint.Address.AbsoluteUri)
                        throw new InvalidOperationException("ER endpoint no longer matches Router placement");
        }
        private static void RequireBlockhash(RpcEndpoint endpoint, byte[] transaction, RpcBlockhash lease)
        {
            string actual = TransactionSignatures.ReadBlockhash(transaction);
            if (lease == null || !ReferenceEquals(lease.Endpoint, endpoint) || actual != lease.Blockhash)
                throw new InvalidOperationException("Transaction blockhash was not fetched from this endpoint");
        }
        private async Task<JToken> Call(Uri endpoint, string method, JArray parameters, int bound, CancellationToken cancellation)
        {
            long id = Interlocked.Increment(ref requestId);
            var request = new JObject { ["jsonrpc"] = "2.0", ["id"] = id, ["method"] = method, ["params"] = parameters };
            string json = await http.Post(endpoint, request.ToString(Formatting.None), bound, cancellation).ConfigureAwait(false);
            if (json == null || System.Text.Encoding.UTF8.GetByteCount(json) > bound) throw new FormatException("RPC response exceeds its bound");
            using var reader = new JsonTextReader(new StringReader(json)) { MaxDepth = 32, DateParseHandling = DateParseHandling.None };
            var response = JObject.Load(reader, new JsonLoadSettings { DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error });
            if (reader.Read() || (string)response["jsonrpc"] != "2.0" || response["id"]?.Type != JTokenType.Integer || (long)response["id"] != id)
                throw new FormatException("Malformed or mismatched JSON-RPC response");
            if (response["error"] is JObject error)
            {
                if (response["result"] != null || error["code"]?.Type != JTokenType.Integer) throw new FormatException("Malformed JSON-RPC error");
                throw new RpcFailure((long)error["code"], String(error["message"]), error["data"]?.ToString(Formatting.None));
            }
            if (response["error"] != null || response["result"] == null) throw new FormatException("Missing JSON-RPC result");
            return response["result"];
        }
        private static Uri Endpoint(string value)
        {
            if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "http" && uri.Scheme != "https") ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment)) throw new FormatException("Invalid RPC endpoint");
            return uri;
        }
        private static JObject Commitment() => new JObject { ["commitment"] = "confirmed" };
        private static JObject EncodingConfig() { var result = Commitment(); result["encoding"] = "base64"; return result; }
        private static JObject AccountConfig(ulong? minimum)
        {
            var result = EncodingConfig(); if (minimum.HasValue) result["minContextSlot"] = minimum.Value; return result;
        }
        private static ulong AccountSlot(JObject result, ulong? minimum)
        {
            ulong slot = Slot(result);
            if (minimum.HasValue && slot < minimum.Value) throw new FormatException("RPC account observation is older than the required slot");
            return slot;
        }
        private static JObject Object(JToken value) => value as JObject ?? throw new FormatException("Expected JSON object");
        private static string String(JToken value) => value?.Type == JTokenType.String ? (string)value : throw new FormatException("Expected JSON string");
        private static bool Boolean(JToken value) => value?.Type == JTokenType.Boolean ? (bool)value : throw new FormatException("Expected JSON boolean");
        private static ulong Unsigned(JToken value) => value?.Type == JTokenType.Integer && ulong.TryParse(value.ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out var number)
            ? number : throw new FormatException("Expected bounded unsigned integer");
        private static ulong Slot(JObject result) => Unsigned(Object(result["context"])["slot"]);
        private static string Error(JToken value) => value == null ? throw new FormatException("Missing RPC error field") : value.Type == JTokenType.Null ? null : value.ToString(Formatting.None);
        private static void AccountBound(int maximum) { if (maximum < 0 || maximum > MaximumAccountBytes) throw new ArgumentOutOfRangeException(nameof(maximum)); }
        private static string[] SnapshotAddresses(IReadOnlyList<string> addresses)
        {
            if (addresses == null || addresses.Count < 1 || addresses.Count > MaximumBatchAccounts) throw new ArgumentException("Account batch is out of bounds");
            var snapshot = addresses.ToArray();
            foreach (string address in snapshot) SolanaAddress.Bytes(address);
            return snapshot;
        }
        private static void Packet(byte[] transaction) { if (transaction == null || transaction.Length < 1 || transaction.Length > SolanaWire.PacketBytes) throw new FormatException("Transaction exceeds packet bounds"); }
        private static RpcAccount Account(string address, JToken token, ulong slot, int maximum)
        {
            if (token?.Type == JTokenType.Null) return new RpcAccount(slot, 0, null);
            var value = Object(token); string owner = String(value["owner"]); SolanaAddress.Bytes(owner);
            if (!(value["data"] is JArray data) || data.Count != 2 || String(data[1]) != "base64") throw new FormatException("Account must use base64 encoding");
            string encoded = String(data[0]);
            if (encoded.Length > ((maximum + 2) / 3) * 4) throw new FormatException("Encoded account exceeds its bound");
            byte[] bytes = Convert.FromBase64String(encoded);
            if (bytes.Length > maximum || Convert.ToBase64String(bytes) != encoded) throw new FormatException("Noncanonical account encoding");
            return new RpcAccount(slot, Unsigned(value["lamports"]), new AccountEnvelope(address, owner, Boolean(value["executable"]), bytes));
        }
    }
}
