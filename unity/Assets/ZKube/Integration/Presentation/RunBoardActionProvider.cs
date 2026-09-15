using System;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using ZKube.Core;
using ZKube.Integration;
using ZKube.Integration.Client.Runs;

namespace ZKube.Presentation
{
    public sealed class RunBoardActionProvider : IBoardActionProvider, IBoardRecoveryProvider
    {
        private readonly RunPresentationBinding binding;
        private readonly Func<CoreRunToken, RunClientAction, byte, byte, byte, CancellationToken, Task<RunClientState>> submit;
        private readonly Func<CancellationToken, Task<RunClientState>> resolve, recover, settle;
        public RunBoardActionProvider(RunClient client, RunClientState initial, ActiveRunReconciler native)
        {
            binding = new RunPresentationBinding(initial, native); string mode = initial.Marker.Mode;
            submit = (accepted, action, row, start, destination, cancellation) => client.Apply(mode, accepted, binding, action, row, start, destination, cancellation);
            resolve = cancellation => client.ResolveVrf(mode, binding, cancellation);
            recover = cancellation => client.Recover(mode, binding, cancellation);
            settle = cancellation => client.FinishAndSettle(mode, binding, cancellation);
        }
        // Money hosts supply tracked operations; projection and native trace
        // agreement remain identical to the direct RunClient adapter above.
        public RunBoardActionProvider(RunPresentationBinding binding,
            Func<CoreRunToken, RunClientAction, byte, byte, byte, CancellationToken, Task<RunClientState>> submit,
            Func<CancellationToken, Task<RunClientState>> resolve,
            Func<CancellationToken, Task<RunClientState>> recover,
            Func<CancellationToken, Task<RunClientState>> settle)
        {
            this.binding = binding ?? throw new ArgumentNullException(nameof(binding));
            this.submit = submit ?? throw new ArgumentNullException(nameof(submit));
            this.resolve = resolve ?? throw new ArgumentNullException(nameof(resolve));
            this.recover = recover ?? throw new ArgumentNullException(nameof(recover));
            this.settle = settle ?? throw new ArgumentNullException(nameof(settle));
        }
        public BoardSession Bind(RunClientState state, string title) =>
            new BoardSession(binding.Accept(state), binding.Rules, this, title, binding.RealmId);
        // The host uses this for terminal Continue; recovery navigation only leaves the view.
        public Task<RunClientState> FinishAndSettle(CancellationToken cancellation) =>
            settle(cancellation);
        public async Task<BoardActionResult> Recover(CancellationToken cancellation)
        {
            var observed = await recover(cancellation);
            return observed.Token == null ? null : BoardActionResult.Snapshot(binding.Accept(observed));
        }
        public async Task<BoardActionResult> Submit(CoreRunToken accepted, BoardAction action, CancellationToken cancellation)
        {
            var kind = Convert(action.Kind);
            var candidate = RunClient.NativeCandidate(accepted, kind, action.Row, action.Start, action.Destination);
            var observed = await submit(accepted, kind, action.Row, action.Start, action.Destination, cancellation);
            return BoardActionResult.Verified(binding.Accept(observed), candidate);
        }
        public async Task<BoardActionResult> ResolveVrf(CoreRunToken accepted, CancellationToken cancellation)
        {
            var observed = await resolve(cancellation);
            var token = binding.Accept(observed);
            if (token.State.SequenceEqual(accepted.State)) throw new InvalidOperationException("The next row has not arrived yet");
            // The chain stores the resulting grid/replay, not raw VRF output.
            // Do not fabricate ordered cascade events for an unseen callback.
            return BoardActionResult.Snapshot(token);
        }
        private static RunClientAction Convert(BoardActionKind kind)
        {
            switch (kind)
            {
                case BoardActionKind.Move: return RunClientAction.Move;
                case BoardActionKind.Guardian: return RunClientAction.Guardian;
                case BoardActionKind.Reroll: return RunClientAction.Reroll;
                case BoardActionKind.Abandon: return RunClientAction.Abandon;
                default: throw new ArgumentOutOfRangeException(nameof(kind));
            }
        }
    }
}
