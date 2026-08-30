import { Capacitor, registerPlugin } from "@capacitor/core";
import { Effect } from "effect";
import { PublicKey } from "@solana/web3.js";

import { appStorage } from "../../../platform/storage";
import {
  SolanaWalletDriverError,
  type SolanaWalletBinding,
  type SolanaWalletDriverService,
} from "./SolanaWalletDriver";
import {
  decodeBase64,
  encodeBase64,
  nativeDriverWallet,
  type SolanaIdentityConnector,
} from "./nativeWallet";
import {
  verifyNativeMessageSignature,
  verifyNativeSignedTransaction,
} from "./nativeSigning";

interface MwaAuthorization {
  readonly authToken: string;
  readonly publicKey: string;
  readonly walletLabel?: string;
}

interface MwaSignedTransactions extends MwaAuthorization {
  readonly signedTransactions: readonly string[];
}

interface MwaSignedMessages extends MwaAuthorization {
  readonly signedMessages: ReadonlyArray<{
    readonly message: string;
    readonly signature: string;
  }>;
}

export interface MwaBridgePlugin {
  readonly authorize: (options: {
    readonly authToken?: string;
  }) => Promise<MwaAuthorization>;
  readonly signTransactions: (options: {
    readonly authToken: string;
    readonly transactions: readonly string[];
  }) => Promise<MwaSignedTransactions>;
  readonly signMessages: (options: {
    readonly authToken: string;
    readonly messages: readonly string[];
  }) => Promise<MwaSignedMessages>;
  readonly disconnect: (options: {
    readonly authToken: string;
  }) => Promise<void>;
}

const NativeMwaBridge = registerPlugin<MwaBridgePlugin>("MwaBridge");
const ANDROID_MWA_SESSION_KEY = "zkube:android-mwa:v1";

export interface AndroidMwaSession {
  authToken: string;
  readonly publicKey: PublicKey;
  readonly label?: string;
}

let activeSession: AndroidMwaSession | null = null;

export function androidMwaIdentityConnectors(
  bridge: MwaBridgePlugin = NativeMwaBridge,
): readonly SolanaIdentityConnector[] {
  if (Capacitor.getPlatform() !== "android") return [];
  return [
    {
      choice: {
        id: "native-mwa",
        name: "Use Installed Wallet",
        platform: "android",
      },
      connect: async (options) => {
        activeSession ??= loadSession();
        if (options?.silent && !activeSession) return null;
        if (!activeSession) {
          const authorization = await bridge.authorize({});
          activeSession = sessionFromAuthorization(authorization);
          saveSession(activeSession);
        }
        return androidBinding(bridge, activeSession);
      },
    },
  ];
}

function androidBinding(
  bridge: MwaBridgePlugin,
  session: AndroidMwaSession,
): SolanaWalletBinding {
  const driver = androidMwaDriver(bridge, session);
  return {
    choice: {
      id: "native-mwa",
      name: session.label || "Use Installed Wallet",
      platform: "android",
    },
    wallet: nativeDriverWallet(session.publicKey, driver),
    driver,
    disconnect: async () => {
      try {
        await bridge.disconnect({ authToken: session.authToken });
      } finally {
        activeSession = null;
        appStorage()?.removeItem(ANDROID_MWA_SESSION_KEY);
      }
    },
    subscribeDisconnected: () => () => undefined,
  };
}

export function androidMwaDriver(
  bridge: MwaBridgePlugin,
  session: AndroidMwaSession,
): SolanaWalletDriverService {
  return {
    signTransaction: (transaction) =>
      Effect.tryPromise({
        try: async () => {
          if (transaction.message.version !== 0) {
            throw new Error("Android MWA accepts v0 transactions only");
          }
          const output = await bridge.signTransactions({
            authToken: session.authToken,
            transactions: [encodeBase64(transaction.serialize())],
          });
          updateSession(session, output);
          if (output.signedTransactions.length !== 1) {
            throw new Error(
              "Android MWA returned an unexpected transaction count",
            );
          }
          return verifyNativeSignedTransaction(
            transaction,
            decodeBase64(output.signedTransactions[0]!),
            session.publicKey,
            "Android MWA",
          );
        },
        catch: nativeWalletError,
      }),
    signMessage: (message) =>
      Effect.tryPromise({
        try: async () => {
          const output = await bridge.signMessages({
            authToken: session.authToken,
            messages: [encodeBase64(message)],
          });
          updateSession(session, output);
          const signed = output.signedMessages[0];
          if (output.signedMessages.length !== 1 || !signed) {
            throw new Error("Android MWA returned an unexpected message count");
          }
          return verifyNativeMessageSignature({
            message,
            signedMessage: decodeBase64(signed.message),
            signature: decodeBase64(signed.signature),
            publicKey: session.publicKey,
          });
        },
        catch: nativeWalletError,
      }),
  };
}

function sessionFromAuthorization(
  authorization: MwaAuthorization,
): AndroidMwaSession {
  return {
    authToken: authorization.authToken,
    publicKey: new PublicKey(decodeBase64(authorization.publicKey)),
    ...(authorization.walletLabel ? { label: authorization.walletLabel } : {}),
  };
}

function updateSession(
  session: AndroidMwaSession,
  authorization: MwaAuthorization,
): void {
  const publicKey = new PublicKey(decodeBase64(authorization.publicKey));
  if (!publicKey.equals(session.publicKey)) {
    throw new Error("Android MWA changed the authorized account");
  }
  session.authToken = authorization.authToken;
  saveSession(session);
}

function saveSession(session: AndroidMwaSession): void {
  appStorage()?.setItem(
    ANDROID_MWA_SESSION_KEY,
    JSON.stringify({
      authToken: session.authToken,
      publicKey: encodeBase64(session.publicKey.toBytes()),
      ...(session.label ? { label: session.label } : {}),
    }),
  );
}

function loadSession(): AndroidMwaSession | null {
  try {
    const encoded = appStorage()?.getItem(ANDROID_MWA_SESSION_KEY);
    if (!encoded) return null;
    const value: unknown = JSON.parse(encoded);
    if (!value || typeof value !== "object") return null;
    const fields = value as Record<string, unknown>;
    if (
      typeof fields.authToken !== "string" ||
      typeof fields.publicKey !== "string"
    ) {
      return null;
    }
    return {
      authToken: fields.authToken,
      publicKey: new PublicKey(decodeBase64(fields.publicKey)),
      ...(typeof fields.label === "string" ? { label: fields.label } : {}),
    };
  } catch {
    appStorage()?.removeItem(ANDROID_MWA_SESSION_KEY);
    return null;
  }
}

function nativeWalletError(cause: unknown): SolanaWalletDriverError {
  return new SolanaWalletDriverError({
    message: cause instanceof Error ? cause.message : String(cause),
  });
}
