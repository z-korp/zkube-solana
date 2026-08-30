// PARKED 2026-08-29 — owner ruling; not reachable from the product until unparked
/**
 * Registering this device for prize notifications.
 *
 * PARKED — nothing calls this, and the keeper serves no push route. Kept
 * finished rather than deleted; see the note in `hooks/useNotifications.ts`.
 *
 * The keeper is the only server this client talks to, and this is the only
 * thing it says: "notify this browser when that wallet is paid." No signature
 * is attached and none is needed — a board's contents are public on chain, so
 * a subscription discloses nothing, and demanding a wallet approval to receive
 * a reminder about money you already won would be the wrong trade.
 *
 * Everything here degrades to a no-op: a browser without push, a keeper that
 * is down, a service worker that never registered. None of it can stop a
 * player collecting, which is always available in the app.
 */

export interface PushEndpointConfig {
  /** Keeper origin, e.g. `https://zkube-solana-devnet-keeper.fly.dev`. */
  baseUrl: string;
}

function readConfig(): PushEndpointConfig | null {
  const baseUrl = import.meta.env.VITE_PUSH_BASE_URL;
  if (typeof baseUrl !== "string" || baseUrl.length === 0) return null;
  try {
    const url = new URL(baseUrl);
    // Anything but HTTPS would leak the subscription over the wire and is
    // refused rather than downgraded.
    if (url.protocol !== "https:") return null;
    return { baseUrl: url.origin };
  } catch {
    return null;
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    readConfig() !== null
  );
}

/** Base64url VAPID key → the byte buffer `pushManager.subscribe` wants. */
function decodeVapidKey(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function fetchVapidKey(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(`${baseUrl}/push/config`, {
      credentials: "omit",
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { vapidPublicKey?: unknown };
    return typeof body.vapidPublicKey === "string" ? body.vapidPublicKey : null;
  } catch {
    return null;
  }
}

/**
 * Subscribe this device for one wallet's prizes.
 *
 * Returns false rather than throwing for every expected failure — an
 * unsupported browser, a denied permission, an unreachable keeper — because
 * none of them is an error the player needs to see.
 */
export async function subscribeToPrizePush(owner: string): Promise<boolean> {
  const config = readConfig();
  if (!config || !pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!registration.pushManager) return false;
    const vapidPublicKey = await fetchVapidKey(config.baseUrl);
    if (!vapidPublicKey) return false;

    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(vapidPublicKey),
      }));

    const payload = subscription.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys.auth) {
      return false;
    }
    const response = await fetch(`${config.baseUrl}/push/subscribe`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner,
        endpoint: payload.endpoint,
        keys: payload.keys,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Stop notifications for this device, locally and on the keeper. */
export async function unsubscribeFromPrizePush(): Promise<void> {
  const config = readConfig();
  if (!config || !pushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await fetch(`${config.baseUrl}/push/unsubscribe`, {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint }),
    });
  } catch {
    // Local unsubscribe already happened; a stale keeper row prunes itself on
    // the first 410 from the push service.
  }
}
