// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { SOLANA_DEVNET_GENESIS_HASH, SOLANA_ENDPOINT } from "../../shared/chain.js";
import { MAGICBLOCK_DEVNET_ROUTER_RPC } from "../src/router.js";

// The Arena client's cluster has one place, the money identity in unity/toolchain.json,
// which the build copies into its scene. It names the same Devnet as the operator tools
// and the keeper: the same genesis, Base endpoint and Router.
it("the_arena_clients_network_is_the_devnet_the_services_use", () => {
  const toolchain = JSON.parse(readFileSync(new URL("../../unity/toolchain.json", import.meta.url), "utf8")) as {
    androidIdentities: { name: string; network?: Record<string, string> }[];
  };
  const network = toolchain.androidIdentities.find((identity) => identity.name === "money")!.network!;
  expect(network.expectedGenesis).toBe(SOLANA_DEVNET_GENESIS_HASH);
  expect(network.baseUri).toBe(SOLANA_ENDPOINT);
  expect(network.routerUri).toBe(MAGICBLOCK_DEVNET_ROUTER_RPC);
  expect(new URL(network.standingsUri!).protocol).toBe("https:");
  expect(toolchain.androidIdentities.find((identity) => identity.name === "store")!.network).toBeUndefined();
});
