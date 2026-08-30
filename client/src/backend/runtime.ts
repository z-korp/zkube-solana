import { createContext, useContext } from "react";
import { ManagedRuntime, type Layer } from "effect";

import type { BackendServices } from "./services";

export type BackendLayer = Layer.Layer<BackendServices, never, never>;
export type BackendRuntime = ManagedRuntime.ManagedRuntime<BackendServices, never>;

export const BackendRuntimeContext = createContext<BackendRuntime | null>(null);

export function useBackendRuntime(): BackendRuntime {
  const runtime = useContext(BackendRuntimeContext);
  if (!runtime) throw new Error("BackendProvider is missing");
  return runtime;
}
