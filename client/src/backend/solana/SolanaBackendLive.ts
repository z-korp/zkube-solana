import { Context, Effect, Layer } from "effect";
import { Connection } from "@solana/web3.js";

import { SOLANA_ENDPOINT } from "./constants";
import type { BackendLayer } from "../runtime";
import { Boards, Content, Economy, Identity, Runs, Session } from "../services";
import { makeSolanaContentBoardsLive } from "./content/SolanaContentBoardsLive";
import { makeSolanaEconomyLive } from "./economy/SolanaEconomyLive";
import { makeSolanaIdentitySessionLive } from "./SolanaIdentitySessionLive";
import { makeSolanaRunsLive } from "./runs/SolanaRunsLive";

export interface SolanaBackendOptions {
  readonly connection?: Connection;
}

export function makeSolanaBackendLive(
  options: SolanaBackendOptions = {},
): BackendLayer {
  const connection =
    options.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const identity = makeSolanaIdentitySessionLive({ connection });
  const complete = Layer.mergeAll(
    identity,
    makeSolanaRunsLive({ connection }).pipe(Layer.provide(identity)),
    makeSolanaContentBoardsLive({ connection }).pipe(Layer.provide(identity)),
    makeSolanaEconomyLive({ connection }).pipe(Layer.provide(identity)),
  );
  return Layer.scopedContext(
    complete.pipe(
      Layer.build,
      // Keep the private wallet and identity-session tags inside the Solana
      // implementation; BackendProvider exposes exactly the six public tags.
      Effect.map((context) =>
        Context.pick(
          Identity,
          Session,
          Runs,
          Content,
          Boards,
          Economy,
        )(context),
      ),
    ),
  );
}
