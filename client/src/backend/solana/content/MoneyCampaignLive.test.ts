// @vitest-environment node
import { readFileSync } from "node:fs";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { Keypair, type Connection } from "@solana/web3.js";
import { beforeEach, expect, it, vi } from "vitest";
import { initializeZkubeCoreSync } from "@/core/zkubeCore";
import { Identity, Session } from "../../services";
import { SolanaIdentitySessionState } from "../SolanaIdentitySessionLive";
import type { SolanaWalletBinding } from "../wallet/SolanaWalletDriver";
import { createReadOnlyWallet } from "../identity/readOnlyWallet";
import { MoneyCampaign, makeMoneyCampaignLive } from "./MoneyCampaignLive";

const mocks = vi.hoisted(() => ({ values: new Map<string, string>(), read: vi.fn(), inspect: vi.fn() }));
vi.mock("@/platform/storage", () => ({ appStorage: () => ({
  getItem: (key: string) => mocks.values.get(key) ?? null,
  setItem: (key: string, value: string) => { mocks.values.set(key, value); },
  removeItem: (key: string) => { mocks.values.delete(key); },
}) }));
vi.mock("../economy/playerStateClient", async importOriginal => ({
  ...await importOriginal<object>(), fetchPlayerStateView: mocks.read,
}));
vi.mock("../SolanaIdentitySessionLive", async importOriginal => ({
  ...await importOriginal<object>(), inspectSession: mocks.inspect,
}));
initializeZkubeCoreSync(readFileSync(new URL("../../../core/generated/zkube_core_bg.wasm", import.meta.url)));
beforeEach(() => { mocks.values.clear(); mocks.read.mockReset(); mocks.inspect.mockReset(); });

function setup() {
  let owner: ReturnType<typeof Keypair.generate>["publicKey"] | null = Keypair.generate().publicKey;
  const dependencies = Layer.mergeAll(
    Layer.succeed(SolanaIdentitySessionState, { binding: () => owner ? {
      wallet: createReadOnlyWallet(owner),
    } as SolanaWalletBinding : null, deviceSession: () => null }),
    Layer.succeed(Identity, { state: Stream.empty, wallets: () => Effect.succeed([]),
      connect: () => Effect.void, reconnect: () => Effect.void, disconnect: () => Effect.void,
      setLabel: () => Effect.void }),
    Layer.succeed(Session, { state: Stream.empty, ensure: () => Effect.die("Unexpected device enable"),
      fund: () => Effect.die("Unexpected funding"), revoke: () => Effect.void }),
  );
  const sendRawTransaction = vi.fn();
  const create = () => ManagedRuntime.make(makeMoneyCampaignLive({ sendRawTransaction } as unknown as Connection)
    .pipe(Layer.provide(dependencies)));
  return { create, sendRawTransaction, address: () => owner!.toBase58(),
    owner: (next: typeof owner) => { owner = next; } };
}

it("money Campaign plays and replays while its chain read is pending without a device", async () => {
  mocks.read.mockImplementation(() => new Promise(() => {}));
  const env = setup(); let runtime = env.create();
  try {
    const first = await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.start(1, 1)));
    expect(BigInt(first.runId)).toBeLessThan(0n);
    const accepted = await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.act(first.runId, { _tag: "Reroll" })));
    await runtime.dispose(); runtime = env.create();
    expect(await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.resume()))).toEqual(accepted);
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(env.sendRawTransaction).not.toHaveBeenCalled();
    env.owner(Keypair.generate().publicKey);
    expect(await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.resume()))).toBeNull();
    await expect(runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.act(first.runId, { _tag: "Reroll" })))).rejects.toThrow("another address");
    env.owner(null);
    await expect(runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.start(1, 1)))).rejects.toThrow("Connect an address");
  } finally { await runtime.dispose(); }
});

it("a pending maximum survives restart and the next start retries an unavailable device", async () => {
  mocks.read.mockResolvedValue(null); mocks.inspect.mockResolvedValue(null);
  const env = setup();
  const { emptyLocalProductState } = await import("../../local/localPersistence");
  const state = emptyLocalProductState(); state.stars[0] = 3;
  mocks.values.set(`zkube:local-product:v1:${env.address()}`, JSON.stringify({ ...state, campaignWritePending: true }));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const runtime = env.create();
    try {
      await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.resume()));
      await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(attempt));
      expect(JSON.parse(mocks.values.get(`zkube:local-product:v1:${env.address()}`)!).campaignWritePending).toBe(true);
    } finally { await runtime.dispose(); }
  }
  expect(env.sendRawTransaction).not.toHaveBeenCalled();
});

it("a retry requested during an existing attempt is retained", async () => {
  let release!: () => void;
  mocks.read.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(null); })).mockResolvedValue(null);
  mocks.inspect.mockResolvedValue(null);
  const env = setup();
  const { emptyLocalProductState } = await import("../../local/localPersistence");
  const state = emptyLocalProductState(); state.stars[0] = 1;
  mocks.values.set(`zkube:local-product:v1:${env.address()}`, JSON.stringify({ ...state, campaignWritePending: true }));
  const runtime = env.create();
  try {
    await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.resume()));
    await runtime.runPromise(Effect.flatMap(MoneyCampaign, c => c.resume()));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2));
    expect(env.sendRawTransaction).not.toHaveBeenCalled();
  } finally { await runtime.dispose(); }
});
