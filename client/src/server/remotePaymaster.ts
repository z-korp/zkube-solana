import { PublicKey } from "@solana/web3.js";

import type { PaymasterClient } from "../chain/paymasterClient.js";

interface PaymasterResponse {
  pubkey?: string;
  signature?: string;
  error?: string;
}

export interface RemotePaymasterOptions {
  endpoint: string;
  expectedPublicKey: PublicKey;
  fetch?: typeof fetch;
}

export function paymasterEndpointFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const endpoint = env.PAYMASTER_ENDPOINT;
  if (!endpoint) throw new Error("PAYMASTER_ENDPOINT is not configured");
  const parsed = new URL(endpoint);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) {
    throw new Error("PAYMASTER_ENDPOINT must use HTTPS, except for localhost");
  }
  if (parsed.pathname !== "/api/paymaster") {
    throw new Error("PAYMASTER_ENDPOINT must target /api/paymaster");
  }
  return parsed.toString();
}

export function paymasterPublicKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): PublicKey {
  const encoded = env.ZKUBE_PAYMASTER_PUBLIC_KEY;
  if (!encoded) throw new Error("ZKUBE_PAYMASTER_PUBLIC_KEY is not configured");
  try {
    return new PublicKey(encoded);
  } catch {
    throw new Error("ZKUBE_PAYMASTER_PUBLIC_KEY is invalid");
  }
}

export function createRemotePaymasterClient(
  options: RemotePaymasterOptions,
): PaymasterClient & { probe(): Promise<void> } {
  const fetchImpl = options.fetch ?? fetch;
  const request = async (init?: RequestInit): Promise<PaymasterResponse> => {
    let response: Response;
    try {
      response = await fetchImpl(options.endpoint, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
        headers: {
          accept: "application/json",
          ...init?.headers,
        },
      });
    } catch {
      throw new Error("paymaster is unavailable");
    }
    let body: PaymasterResponse;
    try {
      body = (await response.json()) as PaymasterResponse;
    } catch {
      throw new Error("paymaster returned an invalid response");
    }
    if (!response.ok) {
      throw new Error(body.error ?? `paymaster request failed (${response.status})`);
    }
    return body;
  };

  return {
    pubkey: options.expectedPublicKey,
    async probe() {
      const body = await request();
      if (!body.pubkey) throw new Error("paymaster did not advertise its identity");
      let advertised: PublicKey;
      try {
        advertised = new PublicKey(body.pubkey);
      } catch {
        throw new Error("paymaster advertised an invalid identity");
      }
      if (!advertised.equals(options.expectedPublicKey)) {
        throw new Error("paymaster endpoint identity does not match configuration");
      }
    },
    async submit(transaction: Uint8Array) {
      const body = await request({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transaction: Buffer.from(transaction).toString("base64"),
        }),
      });
      if (!body.signature) throw new Error("paymaster response did not include a signature");
      return body.signature;
    },
  };
}
