using System;
using ZKube.Core.Generated;
using ZKube.Integration.Planning;
using ZKube.Integration.Transport;

namespace ZKube.Integration.Client
{
    public sealed class SessionAssessment
    {
        public string Status { get; }
        public string Funding { get; }
        public long ValidUntil { get; }
        public ulong Balance { get; }
        public bool Current => Status == "live" || Status == "expiring";
        public bool TokenMayClose { get; }
        internal SessionAssessment(string status, string funding, long validUntil, ulong balance, bool tokenMayClose)
        { Status = status; Funding = funding; ValidUntil = validUntil; Balance = balance; TokenMayClose = tokenMayClose; }
    }
    public static class SessionReadiness
    {
        public static string Status(long validUntil, long now)
        {
            if (now < 0 || now > 9007199254740991L || validUntil < 0 || validUntil > 9007199254740991L)
                throw new FormatException("Invalid session time");
            long remaining = validUntil - now;
            return remaining <= ClientPolicy.SessionReadySkewSeconds ? "expired" : remaining <= SessionViewPolicy.ExpiringSeconds ? "expiring" : "live";
        }
        public static string Funding(AccountEnvelope signer, ulong lamports, ulong rent)
        {
            if (signer == null) return "needsRenewal";
            if (signer.Owner != PlanningConstants.SystemProgram || signer.Executable || signer.Data.Length != 0 ||
                lamports > 9007199254740991UL || rent > 9007199254740991UL)
                throw new FormatException("Stored device signer has an invalid account layout or balance");
            ulong required = checked(rent + SessionViewPolicy.ReadyReserveLamports);
            if (required > 9007199254740991UL) throw new FormatException("Unsafe device funding requirement");
            return lamports >= required ? "ready" : "needsRenewal";
        }
        public static SessionAssessment Inspect(SessionRecord record, string localSigner, AccountEnvelope tokenEnvelope,
            RpcAccount signerAccount, ulong rent, long now, SessionTokenBindings tokens, string program)
        {
            if (record == null || localSigner == null)
                return new SessionAssessment("none", "needsRenewal", 0, 0, false);
            if (localSigner != record.Signer || signerAccount == null ||
                (signerAccount.Envelope != null && signerAccount.Envelope.Address != localSigner)) throw new FormatException("Stored signer identity changed");
            // A missing/revoked token disables the session, but must not hide
            // malformed signer data or a local key that differs from its record.
            string funding = Funding(signerAccount.Envelope, signerAccount.Lamports, rent);
            if (tokenEnvelope == null)
                return new SessionAssessment("none", "needsRenewal", 0, 0, false);
            var token = tokens.Decode(tokenEnvelope);
            if (tokenEnvelope.Address != record.Token || token.Authority != record.Owner || token.FeePayer != record.Owner ||
                token.SessionSigner != localSigner || token.TargetProgram != program || token.ValidUntil != record.ValidUntil)
                throw new FormatException("Stored device session relationships are invalid");
            string status = Status(token.ValidUntil, now);
            return new SessionAssessment(status, funding, token.ValidUntil, signerAccount.Envelope == null ? 0 : signerAccount.Lamports, token.ValidUntil <= now);
        }
    }
}
