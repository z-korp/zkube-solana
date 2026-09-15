using System;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace ZKube.Integration.Client
{
    public sealed class SessionRecord
    {
        public string Owner { get; }
        public string Signer { get; }
        public string Token { get; }
        public long ValidUntil { get; }
        public SessionRecord(string owner, string signer, string token, long validUntil)
        {
            SolanaAddress.Bytes(owner); SolanaAddress.Bytes(signer); SolanaAddress.Bytes(token);
            if (validUntil < 0 || validUntil > 9007199254740991L) throw new FormatException("Invalid session expiry");
            Owner = owner; Signer = signer; Token = token; ValidUntil = validUntil;
        }
    }
    public sealed class SessionRecords
    {
        public string Owner { get; }
        public SessionRecord Active { get; }
        public SessionRecord Candidate { get; }
        public SessionRecords(string owner, SessionRecord active, SessionRecord candidate)
        {
            SolanaAddress.Bytes(owner);
            if ((active != null && active.Owner != owner) || (candidate != null && candidate.Owner != owner) ||
                (active != null && candidate != null && active.Signer == candidate.Signer)) throw new FormatException("Invalid session record identities");
            Owner = owner; Active = active; Candidate = candidate;
        }
    }
    public sealed class SessionRecordStore
    {
        private readonly IPublicClientStore storage;
        private readonly SessionTokenBindings bindings;
        private readonly string program;
        public SessionRecordStore(IPublicClientStore storage, SessionTokenBindings bindings, string program)
        { this.storage = storage; this.bindings = bindings; this.program = program; }
        public async Task<SessionRecords> Load(string owner)
        {
            SolanaAddress.Bytes(owner);
            string json = await storage.Read(owner, "session").ConfigureAwait(false);
            if (json == null) return new SessionRecords(owner, null, null);
            if (json.Length > 4096) throw new FormatException("Session records are too large");
            var fields = JObject.Parse(json);
            if ((int?)fields["version"] != 1 || (string)fields["owner"] != owner) throw new FormatException("Invalid session records");
            SessionRecord Read(JToken value)
            {
                if (value == null || value.Type == JTokenType.Null) return null;
                var record = new SessionRecord(owner, (string)value["signer"], (string)value["token"], (long)value["validUntil"]);
                Validate(record); return record;
            }
            return new SessionRecords(owner, Read(fields["active"]), Read(fields["candidate"]));
        }
        public async Task Replace(SessionRecords expected, SessionRecords next)
        {
            if (expected.Owner != next.Owner) throw new FormatException("Session owner changed");
            Validate(next.Active); Validate(next.Candidate);
            string current = await storage.Read(expected.Owner, "session").ConfigureAwait(false);
            // Compare the exact serialized identities supplied by the caller with
            // the captured bytes; never validate a second storage observation.
            string canonical = Serialize(expected);
            if (current != canonical && !(current == null && expected.Active == null && expected.Candidate == null))
                throw new InvalidOperationException("Session records changed");
            if (!await storage.CompareExchange(expected.Owner, "session", current, Serialize(next)).ConfigureAwait(false))
                throw new InvalidOperationException("Session records changed while saving");
        }
        private void Validate(SessionRecord record)
        {
            if (record != null && record.Token != bindings.Derive(record.Owner, record.Signer, program)) throw new FormatException("Session token PDA is invalid");
        }
        private static string Serialize(SessionRecords records)
        {
            JToken Entry(SessionRecord record) => record == null ? JValue.CreateNull() : new JObject {
                ["signer"] = record.Signer, ["token"] = record.Token, ["validUntil"] = record.ValidUntil };
            return new JObject { ["version"] = 1, ["owner"] = records.Owner, ["active"] = Entry(records.Active), ["candidate"] = Entry(records.Candidate) }.ToString(Formatting.None);
        }
    }
}
