using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Core.Generated;
using ZKube.Presentation;

namespace ZKube.Local
{
    public sealed class LocalBoardActionProvider : IBoardActionProvider, IBoardRecoveryProvider
    {
        private readonly object gate = new object();
        private readonly LocalRunClient client;
        private readonly LocalRunView initial;
        private readonly Func<bool> identityCurrent;
        private readonly Action acceptedAction;
        private CoreRunToken delivered;
        private LocalRunUpdate retained;
        private int cursor;
        private bool recoveryRequired;
        // A snapshot proves native acceptance only. The app host must keep this
        // failure visible; recovering a board never retries or blesses its save.
        public Exception PersistenceFailure { get; private set; }

        public LocalBoardActionProvider(LocalRunClient client, LocalRunUpdate initial, Exception persistenceFailure = null)
            : this(client, initial?.View, persistenceFailure) { }
        public LocalBoardActionProvider(LocalRunClient client, LocalRunView initial, Exception persistenceFailure = null, Func<bool> identityCurrent = null, Action acceptedAction = null)
        {
            this.identityCurrent = identityCurrent; this.acceptedAction = acceptedAction;
            this.client = client ?? throw new ArgumentNullException(nameof(client));
            this.initial = initial ?? throw new ArgumentNullException(nameof(initial));
            delivered = initial.Token; PersistenceFailure = persistenceFailure;
            var observed = BoundObservation();
            if (observed == null || !Same(observed.Token, delivered)) throw new InvalidOperationException("The initial local board is stale");
        }
        public BoardSession Bind(string title) { lock (gate) return new BoardSession(new CoreRunToken(delivered.Config, delivered.State), initial.Rules, this, title, initial.Realm); }

        public Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
        {
            lock (gate)
            {
                cancellation.ThrowIfCancellationRequested(); RequireIdentity();
                RequireDelivered(accepted);
                if (recoveryRequired || retained != null) throw new InvalidOperationException("Observe the accepted local action before another gesture");
                LocalRunUpdate update;
                try { update = client.Act(initial.RunId, accepted, Convert(action)); }
                catch (Exception error)
                {
                    var observed = client.Observe(initial.RunId);
                    if (observed != null && !Same(observed.Token, accepted))
                    {
                        recoveryRequired = true;
                        if (error is LocalRunPersistenceException persistence) PersistenceFailure = persistence.InnerException;
                        // A failure after an accepted move must not be presented
                        // as a native rejection that allows the gesture to retry.
                        throw new InvalidOperationException("Local action was accepted, but completion failed; observe the run before continuing", error);
                    }
                    throw;
                }
                acceptedAction?.Invoke(); RequireIdentity();
                retained = update; cursor = 0;
                try { ValidateTraceChain(accepted, update); }
                catch { recoveryRequired = true; throw; }
                return Task.FromResult(Deliver());
            }
        }
        public Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation)
        {
            lock (gate)
            {
                cancellation.ThrowIfCancellationRequested(); RequireIdentity(); RequireDelivered(accepted);
                if (recoveryRequired || retained == null || NativeEngine.Summary(accepted).Phase != (byte)CorePhase.AwaitingVrf)
                    throw new InvalidOperationException("No accepted local row is awaiting delivery");
                var observed = BoundObservation();
                if (observed == null || !Same(observed.Token, retained.View.Token))
                { recoveryRequired = true; throw new InvalidOperationException("The local run changed while its row was being presented"); }
                return Task.FromResult(Deliver());
            }
        }
        public Task<BoardActionResult> Recover(CancellationToken cancellation)
        {
            lock (gate)
            {
                cancellation.ThrowIfCancellationRequested(); RequireIdentity();
                var observed = BoundObservation();
                retained = null; cursor = 0;
                if (observed == null) { recoveryRequired = true; return Task.FromResult<BoardActionResult>(null); }
                delivered = observed.Token; recoveryRequired = false;
                return Task.FromResult(BoardActionResult.Snapshot(delivered));
            }
        }
        private void RequireIdentity()
        { if (identityCurrent != null && !identityCurrent()) throw new OperationCanceledException("Campaign owner changed"); }
        private LocalRunView BoundObservation()
        {
            RequireIdentity();
            var observed = client.Observe(initial.RunId);
            if (observed == null || observed.Mode != initial.Mode || !observed.Token.Config.SequenceEqual(initial.Token.Config)) return null;
            var selected = client.Active(initial.Mode);
            if (selected != null && selected.RunId != initial.RunId) return null;
            if (selected == null && !Terminal(observed.Token)) return null;
            return observed;
        }
        private BoardActionResult Deliver()
        {
            var transition = retained.Transitions[cursor++]; delivered = new CoreRunToken(transition.Token.Config, transition.Token.State);
            if (cursor == retained.Transitions.Count) { retained = null; cursor = 0; }
            return BoardActionResult.Verified(delivered, transition);
        }
        private void RequireDelivered(CoreRunToken accepted)
        { if (accepted == null || !Same(accepted, delivered)) throw new InvalidOperationException("The board token does not match its accepted local run"); }
        private static void ValidateTraceChain(CoreRunToken before, LocalRunUpdate update)
        {
            var transitions = update.Transitions;
            if (transitions.Count == 0) throw new InvalidOperationException("Local action has no native transition");
            for (int i = 0; i < transitions.Count; i++)
            {
                var transition = transitions[i];
                if (!before.Config.SequenceEqual(transition.Token.Config) ||
                    (i > 0 && NativeEngine.Summary(before).Phase != (byte)CorePhase.AwaitingVrf) ||
                    !PresentationTrace.ProjectBoard(NativeEngine.Summary(before).Grid, transition.Events).SequenceEqual(NativeEngine.Summary(transition.Token).Grid))
                    throw new InvalidOperationException("Local native transition chain does not match accepted state");
                before = transition.Token;
            }
            if (!Same(before, update.View.Token)) throw new InvalidOperationException("Local transition chain omits the final accepted state");
        }
        private static bool Same(CoreRunToken left, CoreRunToken right) => left.Config.SequenceEqual(right.Config) && left.State.SequenceEqual(right.State);
        private static bool Terminal(CoreRunToken token)
        { byte phase = NativeEngine.Summary(token).Phase; return phase == (byte)CorePhase.Finished || phase == (byte)CorePhase.LevelComplete; }
        private static LocalRunAction Convert(BoardAction action)
        {
            switch (action.Kind)
            {
                case BoardActionKind.Move: return new LocalRunAction(LocalActionKind.Move, action.Row, action.Start, action.Destination);
                case BoardActionKind.Guardian: return new LocalRunAction(LocalActionKind.Bonus, action.Row, action.Start);
                case BoardActionKind.Reroll: return new LocalRunAction(LocalActionKind.Reroll);
                case BoardActionKind.Abandon: return new LocalRunAction(LocalActionKind.Finish);
                default: throw new ArgumentOutOfRangeException(nameof(action));
            }
        }
    }
}
