import React, { StrictMode, useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { Effect, Stream } from "effect";

import { Identity } from "./services";
import { makeLocalBackendLive } from "./local/LocalBackendLive";
import { BackendProvider } from "./provider";
import { useBackendRuntime } from "./runtime";

describe("BackendProvider", () => {
  it("subscriptions_survive_strict_mode", async () => {
    let starts = 0;
    let stops = 0;
    const layer = makeLocalBackendLive({
      onRuntimeStart: () => {
        starts += 1;
      },
      onRuntimeStop: () => {
        stops += 1;
      },
    });

    const mounted = render(
      <StrictMode>
        <BackendProvider layer={layer}>
          <IdentitySubscriber />
        </BackendProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(starts).toBe(1));
    expect(stops).toBe(0);

    mounted.unmount();
    await waitFor(() => expect(stops).toBe(1));
    expect(starts).toBe(1);
  });
});

function IdentitySubscriber() {
  const runtime = useBackendRuntime();
  useEffect(() => {
    const cancel = runtime.runCallback(
      Effect.flatMap(Identity, (identity) =>
        identity.state.pipe(Stream.take(1), Stream.runDrain),
      ),
    );
    return () => cancel();
  }, [runtime]);
  return null;
}
