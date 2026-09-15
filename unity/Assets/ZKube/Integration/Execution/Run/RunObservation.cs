using ZKube.Core.Generated;

namespace ZKube.Integration.Execution
{
    // Inputs come from the account snapshot validated through the native core.
    public static class RunObservation
    {
        public static bool HasAcceptedAction(RunSummary run, uint expectedAction) => run.ActionCounter >= expectedAction;
        public static bool IsAcceptedActionReady(RunSummary run, uint pendingVrf, uint expectedAction) =>
            HasAcceptedAction(run, expectedAction) && (IsTerminal(run) || (run.Phase == (byte)CorePhase.Playing && pendingVrf == 0));
        public static bool HasResolvedVrf(uint requestCounter, uint pendingCounter, uint expectedCounter) =>
            requestCounter >= expectedCounter && pendingCounter == 0;
        public static bool IsTerminal(RunSummary run) => run.Phase == (byte)CorePhase.Finished || run.Phase == (byte)CorePhase.LevelComplete;
    }
}
