import { Capacitor } from "@capacitor/core";
import { Effect } from "effect";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { PublicKey } from "@solana/web3.js";

import { subscribeNativeUrl } from "../../../platform/nativeShell";
import {
  SolanaWalletDriverError,
  type SolanaWalletBinding,
  type SolanaWalletDriverService,
} from "./SolanaWalletDriver";
import {
  nativeDriverWallet,
  type SolanaIdentityConnector,
} from "./nativeWallet";
import {
  verifyNativeMessageSignature,
  verifyNativeSignedTransaction,
} from "./nativeSigning";

const APP_URL = "https://zkube-solana.vercel.app";
const CALLBACK_SCHEME = "zkube";
const CALLBACK_HOST = "wallet";
const REQUEST_TIMEOUT_MS = 120_000;

type IosWalletProvider = "phantom" | "solflare";

export interface ProviderConfig {
  readonly id: IosWalletProvider;
  readonly name: string;
  readonly baseUrl: string;
  readonly encryptionPublicKey: string;
}

const PROVIDERS: readonly ProviderConfig[] = [
  {
    id: "phantom",
    name: "Phantom",
    baseUrl: "https://phantom.app/ul/v1",
    encryptionPublicKey: "phantom_encryption_public_key",
  },
  {
    id: "solflare",
    name: "Solflare",
    baseUrl: "https://solflare.com/ul/v1",
    encryptionPublicKey: "solflare_encryption_public_key",
  },
];

export interface DeepLinkSession {
  readonly provider: ProviderConfig;
  readonly publicKey: PublicKey;
  readonly dappKeyPair: nacl.BoxKeyPair;
  readonly sharedSecret: Uint8Array;
  readonly walletSession: string;
}

export interface IosDeepLinkTransport {
  readonly connect: (provider: ProviderConfig) => Promise<DeepLinkSession>;
  readonly signTransaction: (
    session: DeepLinkSession,
    transaction: Uint8Array,
  ) => Promise<Uint8Array>;
  readonly signMessage: (
    session: DeepLinkSession,
    message: Uint8Array,
  ) => Promise<Readonly<{ signedMessage: Uint8Array; signature: Uint8Array }>>;
  readonly disconnect: (session: DeepLinkSession) => Promise<void>;
}

const activeSessions = new Map<IosWalletProvider, DeepLinkSession>();
const productionTransport = encryptedDeepLinkTransport();

export function iosDeepLinkIdentityConnectors(
  transport: IosDeepLinkTransport = productionTransport,
): readonly SolanaIdentityConnector[] {
  if (Capacitor.getPlatform() !== "ios") return [];
  return PROVIDERS.map((provider) => ({
    choice: { id: `ios-${provider.id}`, name: provider.name, platform: "ios" },
    connect: async (options) => {
      let session = activeSessions.get(provider.id);
      if (!session && options?.silent) return null;
      if (!session) {
        session = await transport.connect(provider);
        activeSessions.set(provider.id, session);
      }
      return iosBinding(transport, session);
    },
  }));
}

function iosBinding(
  transport: IosDeepLinkTransport,
  session: DeepLinkSession,
): SolanaWalletBinding {
  const driver = iosDeepLinkDriver(transport, session);
  return {
    choice: {
      id: `ios-${session.provider.id}`,
      name: session.provider.name,
      platform: "ios",
    },
    wallet: nativeDriverWallet(session.publicKey, driver),
    driver,
    disconnect: async () => {
      try {
        await transport.disconnect(session);
      } finally {
        activeSessions.delete(session.provider.id);
      }
    },
    subscribeDisconnected: () => () => undefined,
  };
}

export function iosDeepLinkDriver(
  transport: IosDeepLinkTransport,
  session: DeepLinkSession,
): SolanaWalletDriverService {
  return {
    signTransaction: (transaction) =>
      Effect.tryPromise({
        try: async () => {
          if (transaction.message.version !== 0) {
            throw new Error("iOS wallet links accept v0 transactions only");
          }
          const signed = await transport.signTransaction(
            session,
            transaction.serialize(),
          );
          return verifyNativeSignedTransaction(
            transaction,
            signed,
            session.publicKey,
            session.provider.name,
          );
        },
        catch: nativeWalletError,
      }),
    signMessage: (message) =>
      Effect.tryPromise({
        try: async () => {
          const signed = await transport.signMessage(session, message);
          return verifyNativeMessageSignature({
            message,
            signedMessage: signed.signedMessage,
            signature: signed.signature,
            publicKey: session.publicKey,
          });
        },
        catch: nativeWalletError,
      }),
  };
}

function encryptedDeepLinkTransport(): IosDeepLinkTransport {
  return {
    connect: async (provider) => {
      const dappKeyPair = nacl.box.keyPair();
      const response = await walletRequest(provider, "connect", (redirect) => ({
        app_url: APP_URL,
        dapp_encryption_public_key: bs58.encode(dappKeyPair.publicKey),
        redirect_link: redirect,
        cluster: "devnet",
      }));
      const walletEncryptionKey = requiredParameter(
        response,
        provider.encryptionPublicKey,
      );
      const sharedSecret = nacl.box.before(
        bs58.decode(walletEncryptionKey),
        dappKeyPair.secretKey,
      );
      const payload = decryptPayload(response, sharedSecret);
      return {
        provider,
        publicKey: new PublicKey(requiredString(payload, "public_key")),
        dappKeyPair,
        sharedSecret,
        walletSession: requiredString(payload, "session"),
      };
    },
    signTransaction: async (session, transaction) => {
      const response = await encryptedWalletRequest(
        session,
        "signTransaction",
        {
          transaction: bs58.encode(transaction),
          session: session.walletSession,
        },
      );
      return bs58.decode(requiredString(response, "transaction"));
    },
    signMessage: async (session, message) => {
      const response = await encryptedWalletRequest(session, "signMessage", {
        message: bs58.encode(message),
        session: session.walletSession,
        display: "utf8",
      });
      return {
        signedMessage: message,
        signature: bs58.decode(requiredString(response, "signature")),
      };
    },
    disconnect: async (session) => {
      await encryptedWalletRequest(session, "disconnect", {
        session: session.walletSession,
      });
    },
  };
}

async function encryptedWalletRequest(
  session: DeepLinkSession,
  method: "signTransaction" | "signMessage" | "disconnect",
  payload: Readonly<Record<string, string>>,
): Promise<Record<string, unknown>> {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const encrypted = nacl.box.after(
    new TextEncoder().encode(JSON.stringify(payload)),
    nonce,
    session.sharedSecret,
  );
  const response = await walletRequest(
    session.provider,
    method,
    (redirect) => ({
      dapp_encryption_public_key: bs58.encode(session.dappKeyPair.publicKey),
      nonce: bs58.encode(nonce),
      redirect_link: redirect,
      payload: bs58.encode(encrypted),
    }),
  );
  if (method === "disconnect" && !response.has("data")) return {};
  return decryptPayload(response, session.sharedSecret);
}

async function walletRequest(
  provider: ProviderConfig,
  method: string,
  parameters: (redirect: string) => Readonly<Record<string, string>>,
): Promise<URLSearchParams> {
  const requestId = crypto.randomUUID();
  const redirect = `${CALLBACK_SCHEME}://${CALLBACK_HOST}/${provider.id}/${requestId}`;
  const url = new URL(`${provider.baseUrl}/${method}`);
  for (const [key, value] of Object.entries(parameters(redirect))) {
    url.searchParams.set(key, value);
  }
  const response = waitForWalletCallback(provider.id, requestId);
  openWalletUniversalLink(url.toString());
  return response;
}

function waitForWalletCallback(
  provider: IosWalletProvider,
  requestId: string,
): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribeNativeUrl((value) => {
      let callback: URL;
      try {
        callback = new URL(value);
      } catch {
        return;
      }
      const [callbackProvider, callbackRequest] = callback.pathname
        .split("/")
        .filter(Boolean);
      if (
        callback.protocol !== `${CALLBACK_SCHEME}:` ||
        callback.host !== CALLBACK_HOST ||
        callbackProvider !== provider ||
        callbackRequest !== requestId
      ) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      const error = callback.searchParams.get("errorMessage");
      if (error) {
        reject(new Error(error));
        return;
      }
      resolve(callback.searchParams);
    });
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error(`${provider} did not return to zKube`));
    }, REQUEST_TIMEOUT_MS);
  });
}

export function openWalletUniversalLink(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "external noopener";
  link.click();
}

function decryptPayload(
  parameters: URLSearchParams,
  sharedSecret: Uint8Array,
): Record<string, unknown> {
  const opened = nacl.box.open.after(
    bs58.decode(requiredParameter(parameters, "data")),
    bs58.decode(requiredParameter(parameters, "nonce")),
    sharedSecret,
  );
  if (!opened) throw new Error("Wallet response authentication failed");
  const parsed: unknown = JSON.parse(new TextDecoder().decode(opened));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Wallet returned an invalid response payload");
  }
  return parsed as Record<string, unknown>;
}

function requiredParameter(parameters: URLSearchParams, name: string): string {
  const value = parameters.get(name);
  if (!value) throw new Error(`Wallet response is missing ${name}`);
  return value;
}

function requiredString(
  payload: Readonly<Record<string, unknown>>,
  name: string,
): string {
  const value = payload[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Wallet response is missing ${name}`);
  }
  return value;
}

function nativeWalletError(cause: unknown): SolanaWalletDriverError {
  return new SolanaWalletDriverError({
    message: cause instanceof Error ? cause.message : String(cause),
  });
}
