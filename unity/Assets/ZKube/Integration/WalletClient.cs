using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Chaos.NaCl;
using Newtonsoft.Json.Linq;
using Solana.Unity.Wallet;

namespace ZKube.Integration
{
    public interface INativeWalletTransport
    {
        Task<string> Request(string requestJson);
        Task<byte[]> LoadDeviceSeed(string owner);
        Task RemoveDeviceSeed(string owner);
    }

    public sealed class WalletRequestException : Exception
    {
        public string Code { get; }
        public WalletRequestException(string code) : base("Wallet request failed: " + code) { Code = code; }
    }

    // Authorization credentials stay in the native vault. Only the selected
    // public identity and verified transaction bytes cross this boundary.
    public sealed class WalletClient
    {
        private readonly INativeWalletTransport native;
        private int pending;
        public WalletClient(INativeWalletTransport native) { this.native = native ?? throw new ArgumentNullException(nameof(native)); }
        public async Task<string> Authorize(string expectedOwner = null)
        {
            var response = await Request("authorize", expectedOwner, null);
            return ReadOwner(response, expectedOwner);
        }
        public async Task<byte[]> Sign(string owner, byte[] transaction)
        {
            var original = (byte[])transaction.Clone();
            WalletSignatureVerifier.VerifyBeforeWallet(original, owner);
            var response = await Request("signTransactions", owner, original);
            ReadOwner(response, owner);
            return WalletSignatureVerifier.VerifySignedTransaction(original, ReadBase64(response, "transaction", SolanaWire.PacketBytes), owner);
        }
        public async Task Disconnect(string owner) { await Request("disconnect", owner, null); }
        public async Task<DeviceSigner> LoadDeviceSigner(string owner)
        {
            SolanaAddress.Bytes(owner);
            var seed = await native.LoadDeviceSeed(owner);
            if (seed == null) return null;
            try { return new DeviceSigner(seed); }
            finally { Array.Clear(seed, 0, seed.Length); }
        }
        public Task RemoveDeviceSigner(string owner) { SolanaAddress.Bytes(owner); return native.RemoveDeviceSeed(owner); }
        private async Task<JObject> Request(string operation, string owner, byte[] transaction)
        {
            if (Interlocked.CompareExchange(ref pending, 1, 0) != 0) throw new WalletRequestException("wallet-busy");
            try
            {
                string id = Guid.NewGuid().ToString("N");
                var request = new JObject { ["requestId"] = id, ["operation"] = operation };
                if (owner != null) request["owner"] = Convert.ToBase64String(SolanaAddress.Bytes(owner));
                if (transaction != null) request["transaction"] = Convert.ToBase64String(transaction);
                string json = await native.Request(request.ToString(Newtonsoft.Json.Formatting.None));
                if (json == null || json.Length > 8192) throw new FormatException("Invalid native wallet response length");
                var response = JObject.Parse(json);
                if ((string)response["requestId"] != id || response["ok"]?.Type != JTokenType.Boolean)
                    throw new FormatException("Native wallet response does not match request");
                if (!(bool)response["ok"])
                {
                    string code = (string)response["error"];
                    if (code == null || code.Length > 80 || code.Any(c => !(c >= 'a' && c <= 'z') && c != '-'))
                        throw new FormatException("Invalid wallet error code");
                    throw new WalletRequestException(code);
                }
                return response;
            }
            finally { Volatile.Write(ref pending, 0); }
        }
        private static string ReadOwner(JObject response, string expected)
        {
            byte[] bytes = ReadBase64(response, "owner", 32);
            if (bytes.Length != 32) throw new FormatException("Invalid wallet identity");
            string owner = new PublicKey(bytes).Key;
            if (expected != null && owner != expected) throw new WalletRequestException("account-changed");
            return owner;
        }
        private static byte[] ReadBase64(JObject response, string field, int maximum)
        {
            string text = (string)response[field];
            if (text == null || text.Length > ((maximum + 2) / 3) * 4) throw new FormatException("Invalid native wallet byte field");
            var bytes = Convert.FromBase64String(text);
            if (bytes.Length > maximum || Convert.ToBase64String(bytes) != text) throw new FormatException("Noncanonical native wallet byte field");
            return bytes;
        }
    }

    public sealed class DeviceSigner : IDisposable
    {
        private readonly object gate = new object();
        private byte[] expanded;
        private readonly byte[] publicKey;
        public string Address { get; }
        public DeviceSigner(byte[] seed)
        {
            if (seed == null || seed.Length != 32) throw new FormatException("Invalid device seed length");
            expanded = Ed25519.ExpandedPrivateKeyFromSeed(seed);
            publicKey = Ed25519.PublicKeyFromSeed(seed);
            Address = new PublicKey(publicKey).Key;
        }
        public byte[] PartialSign(byte[] transaction)
        {
            lock (gate) return PartialSignLocked(transaction);
        }
        private byte[] PartialSignLocked(byte[] transaction)
        {
            if (expanded == null) throw new ObjectDisposedException(nameof(DeviceSigner));
            var parsed = TransactionSignatures.Parse(transaction);
            var signatures = parsed.Signatures;
            int count = signatures.Length;
            var message = parsed.Message;
            var header = parsed.Header;
            int index = Array.FindIndex(header.Signers, key => key.SequenceEqual(publicKey));
            if (index < 0) throw new FormatException("Device is not a required signer");
            for (int i = 0; i < count; i++)
                if (signatures[i].Any(value => value != 0) && !Ed25519.Verify(signatures[i], message, header.Signers[i]))
                    throw new FormatException("Existing partial signature is invalid");
            signatures[index] = Ed25519.Sign(message, expanded);
            using var stream = new System.IO.MemoryStream();
            SolanaWire.WriteLength(stream, count);
            foreach (var signature in signatures) SolanaWire.Write(stream, signature);
            SolanaWire.Write(stream, message);
            return stream.ToArray();
        }
        public void Dispose()
        {
            lock (gate) { if (expanded == null) return; Array.Clear(expanded, 0, expanded.Length); expanded = null; }
        }
    }
}
