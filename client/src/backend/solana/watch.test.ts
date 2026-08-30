// @vitest-environment node

import { Effect, Stream } from "effect";
import { Keypair, SystemProgram, type AccountInfo } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import { watchAccount } from "./watch";

describe("watchAccount", () => {
  it("closes the subscribe race and releases its one watcher", async () => {
    const info: AccountInfo<Buffer> = {
      data: Buffer.from([7]),
      executable: false,
      lamports: 3,
      owner: SystemProgram.programId,
      rentEpoch: 0,
    };
    let listener:
      | ((value: AccountInfo<Buffer>, context: { slot: number }) => void)
      | null = null;
    const connection = {
      onAccountChange: vi.fn((_address, next) => {
        listener = next;
        return 41;
      }),
      getAccountInfoAndContext: vi.fn(async () => ({
        context: { slot: 8 },
        value: info,
      })),
      removeAccountChangeListener: vi.fn(async () => undefined),
    };
    const stream = watchAccount({
      connection: connection as never,
      address: Keypair.generate().publicKey,
      decode: (account) => account?.data[0] ?? null,
      fallbackPollMs: 60_000,
    });
    const fiber = Effect.runFork(Stream.runCollect(Stream.take(stream, 2)));

    await vi.waitFor(() =>
      expect(connection.onAccountChange).toHaveBeenCalledOnce(),
    );
    listener!(info, { slot: 9 });
    const values = Array.from(await Effect.runPromise(Effect.fromFiber(fiber)));

    expect(values.map(({ source }) => source)).toEqual([
      "initial",
      "websocket",
    ]);
    expect(connection.removeAccountChangeListener).toHaveBeenCalledWith(41);
  });
});
