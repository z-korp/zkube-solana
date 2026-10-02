using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration.Transport
{
    // What an address's profile shows of its Seeker: its Seeker ID.
    public sealed class SeekerProfile
    {
        public string Name;
    }

    // An address's Seeker facts, read from mainnet for display only.
    // The Seeker ID is its .skr name, the Solana Mobile name every Seeker owner
    // receives, held by AllDomains' name service. It resolves as AllDomains'
    // parser does: the address's name accounts under .skr (getProgramAccounts
    // on the name service, the owner at byte 40 and the .skr parent at byte 8),
    // then the reverse record of each, whose bytes after its 200-byte header
    // are the name.
    // Nothing waits for it, a lookup that fails or finds nothing shows the
    // shortened address, each address resolves once per app run, and no money
    // path, entry, prize or ladder rule reads it.
    public sealed class SeekerNames
    {

        public const string NameService = "ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK", TldHouse = "TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S";
        public const string MainnetGenesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
        public const string Tld = ".skr";
        public const int HeaderBytes = 200, MaximumNames = 16;
        private static readonly byte[] Unset = new byte[32];
        private static readonly Regex Label = new Regex("^[a-z0-9_-]{1,63}$");
        public static readonly string Origin = NameAccount(Hashed("ANS"), null, null);
        public static readonly string Parent = NameAccount(Hashed(Tld), null, Origin);
        public static readonly string House = SolanaAddress.Derive(TldHouse, new[] { Encoding.UTF8.GetBytes("tld_house"), Encoding.UTF8.GetBytes(Tld) }, out _);

        private readonly IJsonRpcHttp http;
        private readonly Uri endpoint;
        private readonly Dictionary<string, Task<SeekerProfile>> resolved = new Dictionary<string, Task<SeekerProfile>>(StringComparer.Ordinal);
        private Task<bool> mainnet;
        private long requestId;

        // Without a mainnet endpoint no name resolves and every profile shows its address.
        public SeekerNames(IJsonRpcHttp http, string mainnetEndpoint)
        {
            this.http = http ?? throw new ArgumentNullException(nameof(http));
            // Anything but a plain HTTPS URL is no endpoint: the lookup is never worth failing a start for.
            if (!Uri.TryCreate(mainnetEndpoint, UriKind.Absolute, out endpoint) || endpoint.Scheme != Uri.UriSchemeHttps ||
                !string.IsNullOrEmpty(endpoint.UserInfo) || !string.IsNullOrEmpty(endpoint.Fragment))
                endpoint = null;
        }

        public static byte[] Hashed(string name)
        {
            using (var sha = SHA256.Create()) return sha.ComputeHash(Encoding.UTF8.GetBytes("ALT Name Service" + name));
        }
        public static string NameAccount(byte[] hashed, string nameClass, string parent) => SolanaAddress.Derive(NameService,
            new[] { hashed, nameClass == null ? Unset : SolanaAddress.Bytes(nameClass), parent == null ? Unset : SolanaAddress.Bytes(parent) }, out _);
        // Where a .skr name account's reverse record keeps its name.
        public static string ReverseRecord(string nameAccount) => NameAccount(Hashed(nameAccount), House, null);
        // A reverse record's name, or null when it holds no plain .skr label.
        public static string RecordName(byte[] record)
        {
            if (record == null || record.Length <= HeaderBytes) return null;
            string label = Encoding.UTF8.GetString(record, HeaderBytes, record.Length - HeaderBytes).TrimEnd('\0');
            return Label.IsMatch(label) ? label + Tld : null;
        }

        // What the address shows; an empty profile when nothing resolves. It never throws.
        public Task<SeekerProfile> Resolve(string owner)
        {
            if (endpoint == null || owner == null) return Task.FromResult(new SeekerProfile());
            lock (resolved)
            {
                if (!resolved.TryGetValue(owner, out var lookup)) resolved[owner] = lookup = Lookup(owner);
                return lookup;
            }
        }
        private async Task<SeekerProfile> Lookup(string owner)
        {
            return new SeekerProfile { Name = await Name(owner).ConfigureAwait(false) };
        }
        private async Task<string> Name(string owner)
        {
            try
            {
                SolanaAddress.Bytes(owner);
                if (!await (mainnet ??= Mainnet()).ConfigureAwait(false)) return null;
                var accounts = await Call("getProgramAccounts", new JArray(NameService, new JObject {
                    ["encoding"] = "base64", ["dataSlice"] = new JObject { ["offset"] = 0, ["length"] = 0 },
                    ["filters"] = new JArray(Filter(40, owner), Filter(8, Parent)) }), 65536).ConfigureAwait(false) as JArray;
                var names = accounts?.Select(entry => (string)entry["pubkey"]).Where(key => key != null).OrderBy(key => key, StringComparer.Ordinal)
                    .Take(MaximumNames).ToArray();
                if (names == null || names.Length == 0) return null;
                var records = await Call("getMultipleAccounts", new JArray(new JArray(names.Select(ReverseRecord)), new JObject { ["encoding"] = "base64" }),
                    names.Length * 4096).ConfigureAwait(false) as JObject;
                return (records?["value"] as JArray)?.Select(value => value?.Type == JTokenType.Object && value["owner"]?.ToString() == NameService
                        ? RecordName(Convert.FromBase64String((string)value["data"][0])) : null)
                    .Where(name => name != null).OrderBy(name => name, StringComparer.Ordinal).FirstOrDefault();
            }
            catch (Exception) { return null; }
        }
        private async Task<bool> Mainnet()
        {
            try { return (string)await Call("getGenesisHash", new JArray(), 4096).ConfigureAwait(false) == MainnetGenesis; }
            catch (Exception) { mainnet = null; return false; }
        }
        private static JObject Filter(int offset, string bytes) => new JObject { ["memcmp"] = new JObject { ["offset"] = offset, ["bytes"] = bytes } };
        private async Task<JToken> Call(string method, JArray parameters, int maximumBytes)
        {
            var request = new JObject { ["jsonrpc"] = "2.0", ["id"] = Interlocked.Increment(ref requestId), ["method"] = method, ["params"] = parameters };
            using (var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
            {
                var response = JObject.Parse(await http.Post(endpoint, request.ToString(Newtonsoft.Json.Formatting.None), maximumBytes, timeout.Token).ConfigureAwait(false));
                if (response["error"] != null) throw new FormatException("Name lookup failed");
                return response["result"];
            }
        }
    }
}
