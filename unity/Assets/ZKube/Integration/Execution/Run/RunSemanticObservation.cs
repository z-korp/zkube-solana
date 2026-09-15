using ZKube.Core;

namespace ZKube.Integration.Execution
{
    public enum RunSemanticPhase { Prepared, AwaitingRow, Ready, Terminal, Consumed, Absent }

    public sealed class RunSemanticObservation
    {
        private readonly CoreRunToken token;
        public string Owner { get; }
        public string Address { get; }
        public string Mode { get; }
        public ulong? RunId { get; }
        public string Endpoint { get; }
        public ulong ContextSlot { get; }
        public RunSemanticPhase Phase { get; }
        public CoreRunToken Token => token == null ? null : new CoreRunToken(token.Config, token.State);
        public bool ActionAccepted { get; }
        public AccountEnvelope PlayerAfter { get; }
        internal RunSemanticObservation(string owner, string address, string mode, ulong? runId,
            string endpoint, ulong slot, RunSemanticPhase phase, CoreRunToken token, bool actionAccepted, AccountEnvelope playerAfter = null)
        {
            Owner = owner; Address = address; Mode = mode; RunId = runId; Endpoint = endpoint;
            ContextSlot = slot; Phase = phase; ActionAccepted = actionAccepted;
            PlayerAfter = playerAfter;
            this.token = token == null ? null : new CoreRunToken(token.Config, token.State);
        }
    }
}

