using System;
using System.Threading.Tasks;

namespace ZKube.Integration.Client
{
    // Called only after the signed create instruction and a fresh token agree.
    // The send journal is owned by TransactionExecutor and clears after this task.
    public sealed class SessionHandoff
    {
        private readonly SessionRecordStore records;
        private readonly DeviceKeyLifecycle keys;
        private readonly SessionTokenBindings tokens;
        private readonly string program;
        public SessionHandoff(SessionRecordStore records, DeviceKeyLifecycle keys, SessionTokenBindings tokens, string program)
        { this.records = records; this.keys = keys; this.tokens = tokens; this.program = program; }

        public async Task Accept(SessionRecord expected, AccountEnvelope freshToken)
        {
            var token = tokens.Decode(freshToken);
            if (freshToken.Address != expected.Token || token.Authority != expected.Owner || token.FeePayer != expected.Owner ||
                token.TargetProgram != program || token.SessionSigner != expected.Signer || token.ValidUntil != expected.ValidUntil)
                throw new FormatException("Confirmed session differs from the durable candidate");
            var current = await records.Load(expected.Owner).ConfigureAwait(false);
            if (Same(current.Active, expected) && current.Candidate == null)
            {
                // A crash can leave native/public promotion complete while the
                // send journal still exists. Verify the native identity again.
                await keys.Promote(expected.Owner, null, expected.Signer).ConfigureAwait(false);
                return;
            }
            if (!Same(current.Candidate, expected)) throw new InvalidOperationException("Session candidate changed before handoff");
            await keys.Promote(expected.Owner, current.Active?.Signer, expected.Signer).ConfigureAwait(false);
            await records.Replace(current, new SessionRecords(expected.Owner, expected, null)).ConfigureAwait(false);
        }
        internal static bool Same(SessionRecord a, SessionRecord b) => a != null && b != null &&
            a.Owner == b.Owner && a.Signer == b.Signer && a.Token == b.Token && a.ValidUntil == b.ValidUntil;
    }
}
