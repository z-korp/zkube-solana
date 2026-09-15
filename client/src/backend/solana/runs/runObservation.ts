import type { ActiveRunView } from "./runPlan";

type Observation = Pick<ActiveRunView, "actionCounter" | "lifecycle" | "pendingVrfCounter" | "vrfRequestCounter">;

export function hasAcceptedRunAction(state: Pick<Observation, "actionCounter">, expectedAction: number): boolean {
  return state.actionCounter >= expectedAction;
}

export function isAcceptedRunActionReady(state: Observation, expectedAction: number): boolean {
  return hasAcceptedRunAction(state, expectedAction) &&
    (state.lifecycle === "levelComplete" || state.lifecycle === "finished" ||
      (state.lifecycle === "playing" && state.pendingVrfCounter === 0));
}

export function hasResolvedRunVrf(state: Pick<Observation, "vrfRequestCounter" | "pendingVrfCounter">, counter: number): boolean {
  return state.vrfRequestCounter >= counter && state.pendingVrfCounter === 0;
}

