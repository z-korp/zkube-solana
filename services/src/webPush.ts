import {
  createECDH,
  createCipheriv,
  createHmac,
  createPrivateKey,
  createSign,
  randomBytes,
} from "node:crypto";

/**
 * Web Push, written against RFC 8291 (aes128gcm payload encryption) and
 * RFC 8292 (VAPID), using only `node:crypto`.
 *
 * No dependency on purpose. The keeper holds a signing key, so every package
 * added to it is supply-chain surface on a process that can move money; the
 * primitives here — ECDH P-256, HKDF-SHA256, AES-128-GCM and ES256 — are all
 * in the standard library, and the construction is a fixed sequence of steps
 * rather than anything invented.
 *
 * The risk this trades for is interop rather than correctness: the round-trip
 * test proves the encryption is self-consistent, but only a real push service
 * can prove the framing is. Verify against one before enabling notifications
 * on a deployment.
 */

const AUTH_INFO = Buffer.from("WebPush: info\0", "utf8");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "utf8");
const RECORD_SIZE = 4_096;
/** Largest payload a push service is required to accept, minus our overhead. */
export const MAX_PUSH_PAYLOAD_BYTES = 3_800;

export interface VapidKeys {
  /** Base64url uncompressed P-256 public key (65 bytes). */
  publicKey: string;
  /** Base64url raw P-256 private scalar (32 bytes). */
  privateKey: string;
  /** Contact URI the push service can reach, e.g. `mailto:ops@example.com`. */
  subject: string;
}

export interface PushTarget {
  endpoint: string;
  /** Base64url client public key from the browser subscription. */
  p256dh: string;
  /** Base64url client auth secret from the browser subscription. */
  auth: string;
}

const b64url = (bytes: Buffer): string => bytes.toString("base64url");
const fromB64url = (value: string): Buffer => Buffer.from(value, "base64url");

/** HKDF-Expand with a single-block output, which is all Web Push needs. */
function hkdf(
  salt: Buffer,
  ikm: Buffer,
  info: Buffer,
  length: number,
): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  const block = createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest();
  return block.subarray(0, length);
}

/**
 * Encrypt one message to a subscription, returning an aes128gcm body.
 *
 * Layout: `salt(16) || record size(4) || key id length(1) || server key(65)`
 * followed by the AES-GCM ciphertext of `plaintext || 0x02`, where `0x02` is
 * the last-record delimiter.
 */
export function encryptPushPayload(
  target: Pick<PushTarget, "p256dh" | "auth">,
  plaintext: Buffer,
  salt: Buffer = randomBytes(16),
): Buffer {
  const clientPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  if (clientPublic.length !== 65 || clientPublic[0] !== 0x04) {
    throw new Error("push subscription key is not an uncompressed P-256 point");
  }
  if (authSecret.length !== 16) {
    throw new Error("push subscription auth secret must be 16 bytes");
  }
  if (plaintext.length > MAX_PUSH_PAYLOAD_BYTES) {
    throw new Error("push payload is too large");
  }

  const server = createECDH("prime256v1");
  const serverPublic = server.generateKeys();
  const sharedSecret = server.computeSecret(clientPublic);

  // The key derivation binds both public keys, so a ciphertext cannot be
  // replayed against a different subscription.
  const ikm = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([AUTH_INFO, clientPublic, serverPublic]),
    32,
  );
  const contentKey = hkdf(salt, ikm, CEK_INFO, 16);
  const nonce = hkdf(salt, ikm, NONCE_INFO, 12);

  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublic.length, 20);
  return Buffer.concat([header, serverPublic, ciphertext]);
}

/** PKCS#8 wrapper so `node:crypto` will sign with a raw P-256 scalar. */
function p256PrivateKey(raw: Buffer, publicKey: Buffer) {
  if (raw.length !== 32) throw new Error("VAPID private key must be 32 bytes");
  const prefix = Buffer.from(
    "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420",
    "hex",
  );
  const middle = Buffer.from("a144034200", "hex");
  return createPrivateKey({
    key: Buffer.concat([prefix, raw, middle, publicKey]),
    format: "der",
    type: "pkcs8",
  });
}

/**
 * The `Authorization: vapid …` header for one push endpoint.
 *
 * The audience is the endpoint's origin, not its full URL, and the signature
 * is raw `r || s` rather than DER — both are the usual ways an ES256 JWT is
 * built wrong.
 */
export function vapidAuthorization(
  keys: VapidKeys,
  endpoint: string,
  nowSeconds: number,
): string {
  const audience = new URL(endpoint).origin;
  const header = b64url(
    Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" }), "utf8"),
  );
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        aud: audience,
        exp: nowSeconds + 12 * 60 * 60,
        sub: keys.subject,
      }),
      "utf8",
    ),
  );
  const signingInput = `${header}.${payload}`;
  const publicKey = fromB64url(keys.publicKey);
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({
      key: p256PrivateKey(fromB64url(keys.privateKey), publicKey),
      dsaEncoding: "ieee-p1363",
    });
  return `vapid t=${signingInput}.${b64url(signature)}, k=${keys.publicKey}`;
}

export type PushOutcome = "sent" | "gone" | "failed";

/**
 * Deliver one notification.
 *
 * `gone` means the push service has retired the endpoint (404/410) and the
 * subscription should be dropped — the single most important signal here,
 * because a store that never prunes grows forever and re-sends into the void.
 */
export async function sendPush(args: {
  target: PushTarget;
  payload: Buffer;
  vapid: VapidKeys;
  ttlSeconds?: number;
  nowSeconds?: number;
  fetchImpl?: typeof fetch;
}): Promise<PushOutcome> {
  const body = encryptPushPayload(args.target, args.payload);
  const doFetch = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(args.target.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(
          args.vapid,
          args.target.endpoint,
          args.nowSeconds ?? Math.floor(Date.now() / 1_000),
        ),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: String(args.ttlSeconds ?? 24 * 60 * 60),
      },
      // A view over the same bytes: `fetch` takes BodyInit, not a Buffer.
      body: new Uint8Array(body),
    });
  } catch {
    return "failed";
  }
  if (response.status === 404 || response.status === 410) return "gone";
  return response.ok ? "sent" : "failed";
}
