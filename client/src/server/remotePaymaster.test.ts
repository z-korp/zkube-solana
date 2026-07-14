// @vitest-environment node

import { Keypair } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";

import {
  createRemotePaymasterClient,
  paymasterEndpointFromEnv,
  paymasterPublicKeyFromEnv,
} from "./remotePaymaster";

describe("remote paymaster client", () => {
  it("requires an HTTPS paymaster route outside local development", () => {
    expect(() =>
      paymasterEndpointFromEnv({ PAYMASTER_ENDPOINT: "http://relay.example/api/paymaster" }),
    ).toThrow("must use HTTPS");
    expect(
      paymasterEndpointFromEnv({
        PAYMASTER_ENDPOINT: "http://127.0.0.1:8080/api/paymaster",
      }),
    ).toBe("http://127.0.0.1:8080/api/paymaster");
    expect(() =>
      paymasterEndpointFromEnv({ PAYMASTER_ENDPOINT: "https://relay.example/wrong" }),
    ).toThrow("must target /api/paymaster");
  });

  it("pins both the configured and advertised public identity", async () => {
    const expectedPublicKey = Keypair.generate().publicKey;
    expect(
      paymasterPublicKeyFromEnv({
        ZKUBE_PAYMASTER_PUBLIC_KEY: expectedPublicKey.toBase58(),
      }).equals(expectedPublicKey),
    ).toBe(true);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ pubkey: Keypair.generate().publicKey.toBase58() }),
    );
    const client = createRemotePaymasterClient({
      endpoint: "https://relay.example/api/paymaster",
      expectedPublicKey,
      fetch: fetchMock,
    });
    await expect(client.probe()).rejects.toThrow("identity does not match");
  });

  it("submits only serialized transactions and returns the relay signature", async () => {
    const expectedPublicKey = Keypair.generate().publicKey;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ pubkey: expectedPublicKey.toBase58() }))
      .mockResolvedValueOnce(Response.json({ signature: "signed-transaction" }));
    const client = createRemotePaymasterClient({
      endpoint: "https://relay.example/api/paymaster",
      expectedPublicKey,
      fetch: fetchMock,
    });
    await client.probe();
    await expect(client.submit(Uint8Array.from([1, 2, 3]))).resolves.toBe(
      "signed-transaction",
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://relay.example/api/paymaster",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ transaction: "AQID" }),
      }),
    );
  });
});
