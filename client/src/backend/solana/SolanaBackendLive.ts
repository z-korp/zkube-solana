import { Context, Effect, Layer, Stream } from "effect";
import { Connection } from "@solana/web3.js";

import { SOLANA_ENDPOINT } from "./constants";
import type { BackendLayer } from "../runtime";
import {
  Boards,
  Content,
  Economy,
  Identity,
  Runs,
  Session,
  StoreEconomy,
  type StoreEconomyService,
} from "../services";
import { makeSolanaContentBoardsLive } from "./content/SolanaContentBoardsLive";
import { makeSolanaEconomyLive } from "./economy/SolanaEconomyLive";
import { makeSolanaIdentitySessionLive } from "./SolanaIdentitySessionLive";
import { makeSolanaRunsLive } from "./runs/SolanaRunsLive";

export const SOLANA_BACKEND_SENTINEL = "zkube_solana_backend_v1";

export interface SolanaBackendOptions {
  readonly connection?: Connection;
}

export function makeSolanaBackendLive(
  options: SolanaBackendOptions = {},
): BackendLayer {
  const connection =
    options.connection ?? new Connection(SOLANA_ENDPOINT, "confirmed");
  const identity = makeSolanaIdentitySessionLive({ connection });
  const campaignState = { campaignOwned: true, price: null } as const;
  const storeEconomy: StoreEconomyService = {
    unlockCampaign: () => Effect.succeed(campaignState),
    restorePurchases: () => Effect.succeed(campaignState),
    state: Stream.succeed(campaignState),
  };
  const complete = Layer.mergeAll(
    identity,
    makeSolanaRunsLive({ connection }).pipe(Layer.provide(identity)),
    makeSolanaContentBoardsLive({ connection }).pipe(Layer.provide(identity)),
    makeSolanaEconomyLive({ connection }).pipe(Layer.provide(identity)),
    Layer.succeed(StoreEconomy, storeEconomy),
  );
  return Layer.scopedContext(
    complete.pipe(
      Layer.build,
      // Keep the private wallet and identity-session tags inside the Solana
      // implementation; BackendProvider exposes only the public tags.
      Effect.map((context) =>
        Context.pick(
          Identity,
          Session,
          Runs,
          Content,
          Boards,
          Economy,
          StoreEconomy,
        )(context),
      ),
    ),
  );
}
