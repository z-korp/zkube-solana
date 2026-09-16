using System;
using System.Globalization;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration
{
    public sealed class PendingTransaction
    {
        private readonly byte[] transaction;
        public string Owner { get; }
        public string Intent { get; }
        public string Endpoint { get; }
        public bool IsBase { get; }
        public string Signature { get; }
        public string Blockhash { get; }
        public ulong LastValidBlockHeight { get; }
        public byte[] Transaction => (byte[])transaction.Clone();
        public PendingTransaction(string owner, string intent, string endpoint, bool isBase, byte[] transaction, string blockhash, ulong lastValidBlockHeight)
        {
            SolanaAddress.Bytes(owner); SolanaAddress.Bytes(blockhash);
            if (string.IsNullOrWhiteSpace(intent) || intent.Length > 64) throw new FormatException("Invalid transaction intent");
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
                !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Fragment))
                throw new FormatException("Invalid transaction endpoint");
            this.transaction = (byte[])transaction.Clone();
            Signature = TransactionSignatures.ValidateFullySigned(this.transaction);
            if (TransactionSignatures.ReadBlockhash(this.transaction) != blockhash) throw new FormatException("Journal blockhash differs from signed bytes");
            Owner = owner; Intent = intent; Endpoint = uri.AbsoluteUri; IsBase = isBase;
            Blockhash = blockhash; LastValidBlockHeight = lastValidBlockHeight;
        }
    }

    // One pending transaction per owner serializes submission of Arcade,
    // funding, claims and Campaign saves.
    // A pending record is written before Send; its presence never proves Send ran.
    public sealed class TransactionJournal
    {
        private readonly IPublicClientStore storage;
        public TransactionJournal(IPublicClientStore storage) { this.storage = storage; }
        public async Task<PendingTransaction> Load(string owner)
        {
            SolanaAddress.Bytes(owner);
            string json = await storage.Read(owner, "journal");
            return Parse(owner, json);
        }
        private static PendingTransaction Parse(string owner, string json)
        {
            if (json == null) return null;
            if (json.Length > 8192) throw new FormatException("Transaction journal is too large");
            var fields = JObject.Parse(json);
            if ((int?)fields["version"] != 1 || (string)fields["owner"] != owner || fields["isBase"]?.Type != JTokenType.Boolean)
                throw new FormatException("Transaction journal identity is invalid");
            string encoded = (string)fields["transaction"];
            if (encoded == null || encoded.Length > 1644) throw new FormatException("Invalid journal transaction");
            var entry = new PendingTransaction(owner, (string)fields["intent"], (string)fields["endpoint"], (bool)fields["isBase"],
                Convert.FromBase64String(encoded), (string)fields["blockhash"], (ulong)fields["lastValidBlockHeight"]);
            if ((string)fields["signature"] != entry.Signature) throw new FormatException("Journal signature differs from signed bytes");
            return entry;
        }
        public async Task Begin(PendingTransaction entry)
        {
            var json = new JObject {
                    ["version"] = 1, ["owner"] = entry.Owner, ["intent"] = entry.Intent, ["endpoint"] = entry.Endpoint,
                    ["isBase"] = entry.IsBase, ["transaction"] = Convert.ToBase64String(entry.Transaction),
                    ["signature"] = entry.Signature, ["blockhash"] = entry.Blockhash,
                    ["lastValidBlockHeight"] = entry.LastValidBlockHeight.ToString(CultureInfo.InvariantCulture),
                }.ToString(Newtonsoft.Json.Formatting.None);
            if (!await storage.CompareExchange(entry.Owner, "journal", null, json))
                throw new InvalidOperationException("Reconcile the pending transaction before submitting another intent");
        }
        // The coordinator must query this signature on this endpoint, inspect
        // confirmed/finalized status, and reconcile fresh affected accounts before
        // invoking completion. Mere send success, timeout, or elapsed wall time
        // cannot clear a record. Expiry also requires a history lookup after the
        // endpoint has passed the signed blockhash's last-valid height.
        public async Task Complete(PendingTransaction entry, string observedSignature, bool confirmedOrFinalized,
            bool historySearchedAfterExpiry, ulong observedBlockHeight, bool affectedAccountsReconciled)
        {
            if (observedSignature != entry.Signature || !affectedAccountsReconciled ||
                (!confirmedOrFinalized && (!historySearchedAfterExpiry || observedBlockHeight <= entry.LastValidBlockHeight)))
                throw new InvalidOperationException("Transaction outcome is still uncertain");
            string currentJson = await storage.Read(entry.Owner, "journal");
            var current = Parse(entry.Owner, currentJson);
            if (current == null || current.Signature != entry.Signature ||
                !await storage.CompareExchange(entry.Owner, "journal", currentJson, null))
                throw new InvalidOperationException("Pending transaction changed");
        }
    }
}
