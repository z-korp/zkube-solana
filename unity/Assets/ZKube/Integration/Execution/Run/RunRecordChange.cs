namespace ZKube.Integration.Execution
{
    public enum RunRecordState { Present, Consumed, Absent }
    public sealed class RunRecordChange
    {
        public string Owner { get; }
        public string Address { get; }
        public ulong? RunId { get; }
        public RunRecordState State { get; }
        public AccountEnvelope PlayerAfter { get; }
        internal RunRecordChange(string owner, string address, ulong? runId, RunRecordState state, AccountEnvelope playerAfter = null)
        { Owner = owner; Address = address; RunId = runId; State = state; PlayerAfter = playerAfter; }
    }
}
