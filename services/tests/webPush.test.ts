// @vitest-environment node
import {
  createDecipheriv,
  createECDH,
  createHmac,
  createPublicKey,
  createVerify,
  randomBytes,
} from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  encryptPushPayload,
  sendPush,
  vapidAuthorization,
  type VapidKeys,
} from "../src/webPush";

const AUTH_INFO = Buffer.from("WebPush: info\0", "utf8");
const CEK_INFO = Buffer.from("Content-Encoding: aes128gcm\0", "utf8");
const NONCE_INFO = Buffer.from("Content-Encoding: nonce\0", "utf8");

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  return createHmac("sha256", prk)
    .update(Buffer.concat([info, Buffer.from([1])]))
    .digest()
    .subarray(0, length);
}

/** The browser half of RFC 8291, so the round trip is proved end to end. */
function decrypt(
  body: Buffer,
  clientPrivate: Buffer,
  clientPublic: Buffer,
  authSecret: Buffer,
): Buffer {
  const salt = body.subarray(0, 16);
  const keyLength = body.readUInt8(20);
  const serverPublic = body.subarray(21, 21 + keyLength);
  const ciphertext = body.subarray(21 + keyLength);

  const client = createECDH("prime256v1");
  client.setPrivateKey(clientPrivate);
  const sharedSecret = client.computeSecret(serverPublic);
  const ikm = hkdf(
    authSecret,
    sharedSecret,
    Buffer.concat([AUTH_INFO, clientPublic, serverPublic]),
    32,
  );
  const decipher = createDecipheriv(
    "aes-128-gcm",
    hkdf(salt, ikm, CEK_INFO, 16),
    hkdf(salt, ikm, NONCE_INFO, 12),
  );
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  // The trailing byte is the record delimiter, not message content.
  expect(padded[padded.length - 1]).toBe(0x02);
  return padded.subarray(0, padded.length - 1);
}

function subscription() {
  const client = createECDH("prime256v1");
  const publicKey = client.generateKeys();
  return {
    privateKey: client.getPrivateKey(),
    publicKey,
    auth: randomBytes(16),
    target: {
      endpoint: "https://push.example.com/send/abc123",
      p256dh: publicKey.toString("base64url"),
      auth: "",
    },
  };
}

function vapidKeys(): VapidKeys {
  const key = createECDH("prime256v1");
  const publicKey = key.generateKeys();
  return {
    publicKey: publicKey.toString("base64url"),
    privateKey: key.getPrivateKey().toString("base64url"),
    subject: "mailto:ops@zkube.test",
  };
}

describe("Web Push payload encryption", () => {
  it("round-trips through the browser's own decryption steps", () => {
    const sub = subscription();
    const target = { p256dh: sub.target.p256dh, auth: sub.auth.toString("base64url") };
    const message = Buffer.from(
      JSON.stringify({ title: "You won 0.653 SOL", dayId: 20_651 }),
      "utf8",
    );

    const body = encryptPushPayload(target, message);

    expect(body.readUInt32BE(16)).toBe(4_096);
    expect(body.readUInt8(20)).toBe(65);
    expect(decrypt(body, sub.privateKey, sub.publicKey, sub.auth)).toEqual(message);
  });

  it("binds a ciphertext to the subscription it was written for", () => {
    const first = subscription();
    const second = subscription();
    const body = encryptPushPayload(
      { p256dh: first.target.p256dh, auth: first.auth.toString("base64url") },
      Buffer.from("secret", "utf8"),
    );
    // A different device cannot open it, which is what the key derivation over
    // both public keys and the auth secret is there for.
    expect(() =>
      decrypt(body, second.privateKey, second.publicKey, second.auth),
    ).toThrow();
  });

  it("refuses a malformed subscription rather than sending to it", () => {
    const auth = randomBytes(16).toString("base64url");
    expect(() =>
      encryptPushPayload({ p256dh: randomBytes(65).toString("base64url"), auth },
        Buffer.from("x")),
    ).toThrow(/uncompressed P-256/);
    expect(() =>
      encryptPushPayload(
        { p256dh: subscription().target.p256dh, auth: randomBytes(8).toString("base64url") },
        Buffer.from("x"),
      ),
    ).toThrow(/16 bytes/);
  });
});

describe("VAPID authorization", () => {
  it("signs an ES256 JWT the push service can verify", () => {
    const keys = vapidKeys();
    const header = vapidAuthorization(
      keys,
      "https://push.example.com/send/abc123",
      1_700_000_000,
    );

    const [, token] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
    expect(token).toBeDefined();
    const [encodedHeader, encodedPayload, signature] = token!.split(".");
    expect(JSON.parse(Buffer.from(encodedHeader!, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "ES256",
    });
    const payload = JSON.parse(
      Buffer.from(encodedPayload!, "base64url").toString(),
    );
    // The audience is the ORIGIN, not the endpoint — the usual way this is
    // built wrong, and push services reject it silently.
    expect(payload.aud).toBe("https://push.example.com");
    expect(payload.exp).toBe(1_700_000_000 + 12 * 60 * 60);
    expect(payload.sub).toBe(keys.subject);

    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex"),
        Buffer.from(keys.publicKey, "base64url"),
      ]),
      format: "der",
      type: "spki",
    });
    const verified = createVerify("SHA256")
      .update(`${encodedHeader}.${encodedPayload}`)
      .verify(
        { key: publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature!, "base64url"),
      );
    expect(verified).toBe(true);
  });
});

describe("delivery outcomes", () => {
  const sub = subscription();
  const target = {
    endpoint: sub.target.endpoint,
    p256dh: sub.target.p256dh,
    auth: sub.auth.toString("base64url"),
  };

  it("reports a retired endpoint so the store can prune it", async () => {
    for (const status of [404, 410]) {
      const outcome = await sendPush({
        target,
        payload: Buffer.from("x"),
        vapid: vapidKeys(),
        fetchImpl: async () => new Response(null, { status }),
      });
      expect(outcome).toBe("gone");
    }
  });

  it("never throws on a transport failure", async () => {
    const outcome = await sendPush({
      target,
      payload: Buffer.from("x"),
      vapid: vapidKeys(),
      fetchImpl: async () => {
        throw new Error("network down");
      },
    });
    // A push outage must never surface as a keeper pass failure.
    expect(outcome).toBe("failed");
  });

  it("sends with the aes128gcm framing the spec requires", async () => {
    let seen: RequestInit | undefined;
    const outcome = await sendPush({
      target,
      payload: Buffer.from("x"),
      vapid: vapidKeys(),
      fetchImpl: async (_url, init) => {
        seen = init;
        return new Response(null, { status: 201 });
      },
    });
    expect(outcome).toBe("sent");
    const headers = seen?.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers["Content-Type"]).toBe("application/octet-stream");
    expect(headers.Authorization).toMatch(/^vapid t=/);
  });
});
