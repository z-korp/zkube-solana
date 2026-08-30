import {
  default as React,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { ManagedRuntime } from "effect";

import {
  BackendRuntimeContext,
  type BackendLayer,
  type BackendRuntime,
} from "./runtime";
import { BackendClientState } from "./client";

/** Owns exactly one scoped Effect runtime for the lifetime of this provider. */
export function BackendProvider({
  layer,
  children,
}: {
  layer: BackendLayer;
  children: ReactNode;
}) {
  const runtimeRef = useRef<BackendRuntime | null>(null);
  runtimeRef.current ??= ManagedRuntime.make(layer);
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    const mountedGeneration = generation.current;
    return () => {
      queueMicrotask(() => {
        if (generation.current !== mountedGeneration) return;
        const runtime = runtimeRef.current;
        runtimeRef.current = null;
        if (runtime) void runtime.dispose();
      });
    };
  }, []);

  return (
    <BackendRuntimeContext.Provider value={runtimeRef.current}>
      <BackendClientState>{children}</BackendClientState>
    </BackendRuntimeContext.Provider>
  );
}
