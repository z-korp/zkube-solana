using System;
using System.Linq;
using ZKube.Core;
using ZKube.Core.Generated;

namespace ZKube.Integration.Client.Runs
{
    public enum RunClientAction { Move, Guardian, Reroll, Abandon }

    public sealed class RunClientState
    {
        public RunMarker Marker { get; }
        public string Phase { get; }
        public AccountEnvelope Account { get; }
        private readonly CoreRunToken token;
        public CoreRunToken Token => token == null ? null : new CoreRunToken(token.Config, token.State);
        internal RunClientState(string phase) { Phase = phase; }
        internal RunClientState(RunRecoveryResult observed, ActiveRunReconciler native)
        {
            Marker = observed.Marker; Phase = observed.Phase;
            Account = observed.Account;
            if (Account != null) token = native.Reconcile(Account, Marker.Owner);
        }
    }

    // A chain snapshot carries the current replay commitment, not its original
    // opening seed. This anchor exists only for one bound board presentation.
    // Every rules byte is checked before replacing that one replay anchor.
    public sealed class RunPresentationBinding
    {
        private readonly string owner, address;
        private readonly byte[] config, rulesRequest;
        private readonly ActiveRunReconciler native;
        public string Owner => owner;
        public string Address => address;
        public long DeadlineAt { get; }
        public byte RealmId { get; }
        public BuildConfigRequest Rules => BuildConfigRequest.Decode(rulesRequest);
        public RunPresentationBinding(RunClientState initial, ActiveRunReconciler native)
        {
            if (initial?.Account == null) throw new ArgumentException("No accepted run to bind");
            this.native = native; owner = initial.Marker.Owner; address = initial.Marker.ActiveRun;
            DeadlineAt = native.DeadlineAt(initial.Account, owner);
            RealmId = native.RealmId(initial.Account, owner);
            var rules = native.BuildConfiguration(initial.Account, owner);
            rulesRequest = rules.Encode(); config = NativeEngine.BuildConfig(rules);
            if (!initial.Token.Config.SequenceEqual(config)) throw new FormatException("Native configuration disagrees with chain rules");
        }
        public CoreRunToken Accept(RunClientState current)
        {
            RequireIdentity(current?.Marker?.Owner, current?.Marker?.ActiveRun);
            if (current.Account == null)
                throw new InvalidOperationException("The accepted run identity changed");
            if (native.DeadlineAt(current.Account, owner) != DeadlineAt)
                throw new InvalidOperationException("Run deadline changed while the board was bound");
            if (native.RealmId(current.Account, owner) != RealmId)
                throw new InvalidOperationException("Run realm changed while the board was bound");
            var rules = native.BuildConfiguration(current.Account, owner);
            var observed = current.Token;
            if (!NativeEngine.BuildConfig(rules).SequenceEqual(observed.Config))
                throw new FormatException("Native configuration disagrees with the current chain snapshot");
            rules.InitialReplay = Rules.InitialReplay;
            if (!NativeEngine.BuildConfig(rules).SequenceEqual(config))
                throw new InvalidOperationException("Run rules changed while the board was bound");
            var anchored = new CoreRunToken(config, observed.State);
            NativeEngine.Summary(anchored);
            return anchored;
        }
        public void RequireIdentity(string observedOwner, string observedAddress)
        {
            if (observedOwner != owner || observedAddress != address)
                throw new InvalidOperationException("The bound run identity changed; recover before continuing");
        }
    }
}
