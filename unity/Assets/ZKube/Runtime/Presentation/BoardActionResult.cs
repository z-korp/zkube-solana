using System;
using System.Linq;
using ZKube.Core;

namespace ZKube.Presentation
{
    public sealed class BoardActionResult
    {
        public RunTransition Transition { get; }
        private readonly CoreRunToken accepted;
        public CoreRunToken Token => new CoreRunToken(accepted.Config, accepted.State);
        public bool IsSnapshot => Transition == null;
        private BoardActionResult(CoreRunToken token, RunTransition transition)
        { accepted = new CoreRunToken(token.Config, token.State); NativeEngine.Summary(accepted); Transition = transition; }
        public static BoardActionResult Snapshot(CoreRunToken token) => new BoardActionResult(token, null);
        public static BoardActionResult Verified(CoreRunToken accepted, RunTransition candidate) =>
            candidate != null && candidate.Token.Config.SequenceEqual(accepted.Config) && candidate.Token.State.SequenceEqual(accepted.State)
                ? new BoardActionResult(accepted, candidate) : Snapshot(accepted);
        public static implicit operator BoardActionResult(RunTransition transition) =>
            new BoardActionResult(transition.Token, transition);
    }
}
