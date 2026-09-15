using System;
using System.IO;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using ZKube.Core.Generated;

namespace ZKube.Integration
{
    public sealed class RunStateStore
    {
        private readonly IPublicClientStore storage;
        private readonly AccountBindings accounts;
        private readonly SessionTokenBindings sessions;
        public RunStateStore(IPublicClientStore storage, AccountBindings accounts, SessionTokenBindings sessions)
        { this.storage = storage; this.accounts = accounts; this.sessions = sessions; }
        public async Task<RunMarker> Load(string owner, string mode)
        {
            ValidateMode(mode); SolanaAddress.Bytes(owner);
            string json = await storage.Read(owner, mode);
            return Parse(owner, mode, json);
        }
        private RunMarker Parse(string owner, string mode, string json)
        {
            if (json == null) return null;
            if (json.Length > 4096) throw new FormatException("Run marker is too large");
            var fields = JObject.Parse(json);
            if ((int?)fields["version"] != 1 || (string)fields["owner"] != owner || (string)fields["mode"] != mode)
                throw new FormatException("Run marker identity is invalid");
            var marker = new RunMarker(owner, (ulong)fields["runId"], mode, (string)fields["activeRun"],
                (string)fields["sessionSigner"], (string)fields["sessionToken"], (long)fields["validUntil"]);
            Validate(marker);
            return marker;
        }
        public async Task Save(RunMarker marker)
        {
            Validate(marker);
            string priorJson = await storage.Read(marker.Owner, marker.Mode);
            var prior = Parse(marker.Owner, marker.Mode, priorJson);
            if (prior != null && prior.RunId != marker.RunId) throw new InvalidOperationException("An unresolved run already occupies this slot");
            string json = new JObject {
                ["version"] = 1, ["owner"] = marker.Owner, ["runId"] = marker.RunId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                ["mode"] = marker.Mode, ["activeRun"] = marker.ActiveRun, ["sessionSigner"] = marker.SessionSigner,
                ["sessionToken"] = marker.SessionToken, ["validUntil"] = marker.ValidUntil,
            }.ToString(Newtonsoft.Json.Formatting.None);
            if (!await storage.CompareExchange(marker.Owner, marker.Mode, priorJson, json))
                throw new InvalidOperationException("Run marker changed while saving");
        }
        public async Task<RunMarker> AttachCurrentDevice(RunMarker marker, DeviceSigner signer, AccountEnvelope tokenEnvelope, long nowUnix)
        {
            Validate(marker);
            var token = sessions.Decode(tokenEnvelope);
            if (signer == null || token.Authority != marker.Owner || token.FeePayer != marker.Owner ||
                token.TargetProgram != accounts.ProgramId || token.SessionSigner != signer.Address ||
                nowUnix < 0 || nowUnix > 9007199254740991L || token.ValidUntil - nowUnix <= ClientPolicy.SessionReadySkewSeconds)
                throw new InvalidOperationException("Device session is not currently authorized");
            var attached = new RunMarker(marker.Owner, marker.RunId, marker.Mode, marker.ActiveRun, signer.Address, tokenEnvelope.Address, token.ValidUntil);
            await Save(attached);
            return attached;
        }
        public async Task<RunRecoveryResult> ResolveOrDiscover(string owner, string mode, RunRecovery recovery,
            IRecoveryTransport transport, long nowUnix)
        {
            ValidateMode(mode); SolanaAddress.Bytes(owner);
            var marker = await Load(owner, mode);
            if (marker == null)
            {
                string playerAddress = SolanaAddress.Derive(accounts.ProgramId,
                    new[] { Encoding.UTF8.GetBytes("player"), SolanaAddress.Bytes(owner) }, out _);
                var envelope = await transport.ReadBase(playerAddress);
                if (envelope == null) return new RunRecoveryResult { Phase = "none" };
                var player = accounts.PlayerState(envelope, owner);
                ulong runId = (ulong)player[mode == "campaign" ? "campaign_active_run_id" : "active_run_id"];
                if (runId == 0) return new RunRecoveryResult { Phase = "none" };
                marker = new RunMarker(owner, runId, mode, ActiveAddress(owner, runId), null, null, 0);
                // The chain's validated slot is sufficient to retain the locator
                // while ER cloning lags or this device has lost its signing key.
                await Save(marker);
            }
            return await recovery.Resolve(marker, transport, nowUnix);
        }
        public async Task ClearAfterConsumption(RunMarker marker, AccountEnvelope playerAfter, AccountEnvelope activeBaseAfter,
            DelegationPlacement placementAfter)
        {
            Validate(marker);
            var player = accounts.PlayerState(playerAfter, marker.Owner);
            if (activeBaseAfter != null || placementAfter == null || placementAfter.IsDelegated ||
                (ulong)player[marker.Mode == "campaign" ? "campaign_active_run_id" : "active_run_id"] == marker.RunId)
                throw new InvalidOperationException("Run consumption is not confirmed");
            string savedJson = await storage.Read(marker.Owner, marker.Mode);
            var saved = Parse(marker.Owner, marker.Mode, savedJson);
            if (saved != null && saved.RunId == marker.RunId &&
                !await storage.CompareExchange(marker.Owner, marker.Mode, savedJson, null))
                throw new InvalidOperationException("Run marker changed while consuming");
        }
        private void Validate(RunMarker marker)
        {
            if (marker == null) throw new ArgumentNullException(nameof(marker));
            if (marker.ActiveRun != ActiveAddress(marker.Owner, marker.RunId)) throw new FormatException("Run marker PDA is invalid");
            if (marker.SessionSigner != null && marker.SessionToken != sessions.Derive(marker.Owner, marker.SessionSigner, accounts.ProgramId))
                throw new FormatException("Run marker session PDA is invalid");
        }
        private string ActiveAddress(string owner, ulong runId)
        {
            using var bytes = new MemoryStream();
            using (var writer = new BinaryWriter(bytes, Encoding.UTF8, true)) writer.Write(runId);
            return SolanaAddress.Derive(accounts.ProgramId, new[] { Encoding.UTF8.GetBytes("run"), Encoding.UTF8.GetBytes("active"),
                SolanaAddress.Bytes(owner), bytes.ToArray() }, out _);
        }
        private static void ValidateMode(string mode)
        { if (mode != "campaign" && mode != "daily") throw new ArgumentException("Invalid run mode"); }
    }
}
