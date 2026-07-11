// @vitest-environment node

import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { ZKUBE_PROGRAM_ID } from "../constants";
import { waitForDelegation } from "./router";

describe("MagicBlock Router resolution", () => {
  it("accepts only a Router-resolved ER account owned by zKube", async () => {
    const account = Keypair.generate().publicKey;
    const fetcher = vi.fn(async () =>
      response({
        isDelegated: true,
        fqdn: "https://eu.magicblock.example",
        delegationRecord: {
          authority: Keypair.generate().publicKey.toBase58(),
          owner: ZKUBE_PROGRAM_ID.toBase58(),
          delegationSlot: 42,
          lamports: 1,
        },
      }),
    );
    const getAccountInfo = vi.fn(async () => ({ owner: ZKUBE_PROGRAM_ID }));

    const status = await waitForDelegation(account, {
      endpoint: "https://router.magicblock.example",
      attempts: 1,
      fetcher: fetcher as typeof fetch,
      erConnectionFactory: () => ({ getAccountInfo }),
    });

    expect(status.fqdn).toBe("https://eu.magicblock.example/");
    expect(getAccountInfo).toHaveBeenCalledWith(account, "confirmed");
  });

  it("rejects a substituted delegation owner", async () => {
    const account = Keypair.generate().publicKey;
    const fetcher = vi.fn(async () =>
      response({
        isDelegated: true,
        fqdn: "https://eu.magicblock.example",
        delegationRecord: {
          authority: Keypair.generate().publicKey.toBase58(),
          owner: Keypair.generate().publicKey.toBase58(),
          delegationSlot: 42,
          lamports: 1,
        },
      }),
    );

    await expect(
      waitForDelegation(account, {
        endpoint: "https://router.magicblock.example",
        attempts: 1,
        fetcher: fetcher as typeof fetch,
        erConnectionFactory: () => ({
          getAccountInfo: vi.fn(async () => ({ owner: ZKUBE_PROGRAM_ID })),
        }),
      }),
    ).rejects.toThrow("Delegation record owner");
  });

  it("rejects an ER account with a substituted program owner", async () => {
    const account = Keypair.generate().publicKey;
    const fetcher = vi.fn(async () =>
      response({
        isDelegated: true,
        fqdn: "https://eu.magicblock.example",
        delegationRecord: {
          authority: Keypair.generate().publicKey.toBase58(),
          owner: ZKUBE_PROGRAM_ID.toBase58(),
          delegationSlot: 42,
          lamports: 1,
        },
      }),
    );

    await expect(
      waitForDelegation(account, {
        endpoint: "https://router.magicblock.example",
        attempts: 1,
        fetcher: fetcher as typeof fetch,
        erConnectionFactory: () => ({
          getAccountInfo: vi.fn(async () => ({
            owner: new PublicKey("11111111111111111111111111111111"),
          })),
        }),
      }),
    ).rejects.toThrow("is not owned by");
  });
});

function response(result: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ jsonrpc: "2.0", id: 1, result }),
  } as Response;
}
